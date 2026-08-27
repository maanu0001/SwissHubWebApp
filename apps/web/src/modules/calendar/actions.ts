'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { calendar } from '@swisshub/modules';
import { forbidden } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';

const MODULE_ID = calendar.CALENDAR_MODULE_ID;
const P = calendar.CALENDAR_PERMISSIONS;

/**
 * Server Actions des Community-Kalenders.
 *
 * Eine Server Action ist ein oeffentlicher Endpunkt - dass ein Knopf im
 * Browser fehlt, ist Bequemlichkeit und keine Absicherung. Jede Aktion prueft
 * deshalb serverseitig, und die Aktionen an einem bestimmten Termin pruefen
 * zusaetzlich die Zustaendigkeit fuer genau diesen Termin.
 */

function revalidateCalendar(slug?: string): void {
  revalidatePath('/kalender');
  revalidatePath('/kalender/verwaltung');
  revalidatePath('/dashboard');
  if (slug) {
    revalidatePath(`/kalender/${slug}`);
  }
}

const actorOf = (ctx: AuthContext) => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

/**
 * Darf diese Person diesen Termin verwalten?
 *
 * Zwei Wege: die allgemeine Bearbeitungsberechtigung fuer alle Termine, oder
 * `manageOwn` zusammen mit der Zustaendigkeit fuer genau diesen. Ohne beides
 * bricht die Aktion ab - auch dann, wenn der Aufrufer den Endpunkt direkt
 * kennt.
 */
async function requireEventZugriff(
  ctx: AuthContext,
  eventId: string,
): Promise<Awaited<ReturnType<typeof calendar.requireEvent>>> {
  const event = await calendar.requireEvent(eventId);
  if (can(ctx, P.edit)) {
    return event;
  }
  if (can(ctx, P.manageOwn) && calendar.istZustaendig(event, ctx.user.discordId)) {
    return event;
  }
  throw forbidden(
    `calendar: ${ctx.user.discordId} ist fuer Event ${eventId} nicht zustaendig`,
    'Du darfst dieses Event nicht bearbeiten.',
  );
}

// --- Events -------------------------------------------------------------

export const createEventAction = defineAction(
  {
    name: 'calendar.event.create',
    module: MODULE_ID,
    permission: P.create,
    schema: calendar.eventInputSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const event = await calendar.createEvent(actorOf(ctx), input);
    revalidateCalendar(event.slug);
    return { eventId: event.id, slug: event.slug };
  },
);

export const updateEventAction = defineAction(
  {
    name: 'calendar.event.update',
    module: MODULE_ID,
    // Keine feste Permission: die Pruefung geschieht im Rumpf ueber
    // `requireEventZugriff`. `edit` deckt alle Termine ab, `manageOwn` nur
    // die eigenen - das laesst sich nicht als ein Schluessel ausdruecken.
    schema: calendar.eventInputSchema.and(z.object({ eventId: z.string().min(1) })),
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const { eventId, ...rest } = input;
    await requireEventZugriff(ctx, eventId);
    const ergebnis = await calendar.updateEvent(actorOf(ctx), eventId, rest);
    await calendar.reberechneFaelligkeiten(eventId);
    await calendar.refreshAnnouncement(eventId).catch(() => undefined);
    revalidateCalendar(ergebnis.event.slug);
    return { slug: ergebnis.event.slug, wesentlich: ergebnis.wesentlich };
  },
);

export const publishEventAction = defineAction(
  {
    name: 'calendar.event.publish',
    module: MODULE_ID,
    permission: P.publish,
    schema: calendar.eventIdSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    await requireEventZugriff(ctx, input.eventId);
    const event = await calendar.publishEvent(actorOf(ctx), input.eventId);
    // Die Ankuendigung darf scheitern, ohne die Veroeffentlichung
    // zurueckzunehmen: der Termin steht, Discord ist die Zugabe.
    const gesendet = await calendar
      .announceEvent(input.eventId, { actor: actorOf(ctx) })
      .catch(() => null);
    revalidateCalendar(event.slug);
    return { slug: event.slug, status: event.status, announced: gesendet !== null };
  },
);

export const announceEventAction = defineAction(
  {
    name: 'calendar.event.announce',
    module: MODULE_ID,
    permission: P.publish,
    schema: calendar.eventIdSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const event = await requireEventZugriff(ctx, input.eventId);
    const gesendet = await calendar.announceEvent(input.eventId, {
      actor: actorOf(ctx),
      republish: true,
    });
    revalidateCalendar(event.slug);
    return { messageId: gesendet?.id ?? null };
  },
);

export const cancelEventAction = defineAction(
  {
    name: 'calendar.event.cancel',
    module: MODULE_ID,
    permission: P.cancel,
    schema: calendar.cancelEventSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    await requireEventZugriff(ctx, input.eventId);
    const event = await calendar.cancelEvent(actorOf(ctx), input.eventId, input.reason);

    // Erst die Ankuendigung als abgesagt kennzeichnen, dann die Angemeldeten
    // benachrichtigen - wer den Kanal liest, soll nicht auf einen Beitrag
    // stossen, der den Abend noch bewirbt.
    await calendar.refreshAnnouncement(input.eventId).catch(() => undefined);
    const benachrichtigt = input.notifyParticipants
      ? await calendar
          .notifyParticipants(input.eventId, 'CANCELLED', { actor: actorOf(ctx) })
          .catch(() => ({ gesendet: false, empfaenger: 0 }))
      : { gesendet: false, empfaenger: 0 };

    revalidateCalendar(event.slug);
    return { slug: event.slug, benachrichtigt: benachrichtigt.empfaenger };
  },
);

export const notifyChangeAction = defineAction(
  {
    name: 'calendar.event.notifyChange',
    module: MODULE_ID,
    // Zustaendigkeit statt fester Permission - siehe `updateEventAction`.
    schema: calendar.notifyChangeSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    await requireEventZugriff(ctx, input.eventId);
    const ergebnis = await calendar.notifyParticipants(input.eventId, 'UPDATE', {
      actor: actorOf(ctx),
      note: input.message,
    });
    return { empfaenger: ergebnis.empfaenger, gesendet: ergebnis.gesendet };
  },
);

export const deleteEventAction = defineAction(
  {
    name: 'calendar.event.delete',
    module: MODULE_ID,
    permission: P.delete,
    schema: calendar.deleteEventSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    await requireEventZugriff(ctx, input.eventId);
    const ergebnis = await calendar.deleteEvent(actorOf(ctx), input.eventId, input.reason);
    revalidateCalendar();
    return { title: ergebnis.title };
  },
);

export const duplicateEventAction = defineAction(
  {
    name: 'calendar.event.duplicate',
    module: MODULE_ID,
    permission: P.create,
    schema: calendar.duplicateEventSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    if (!input.startAt) {
      throw new Error('Bitte ein gültiges Datum und eine Uhrzeit wählen.');
    }
    const kopie = await calendar.duplicateEvent(actorOf(ctx), input.eventId, input.startAt, {
      endAt: input.endAt,
      title: input.title,
    });
    revalidateCalendar(kopie.slug);
    return { eventId: kopie.id, slug: kopie.slug };
  },
);

// --- Teilnahme ----------------------------------------------------------

export const registerAction = defineAction(
  {
    name: 'calendar.register',
    module: MODULE_ID,
    permission: P.participate,
    schema: calendar.registerSchema,
    rateLimit: 'calendarParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const ergebnis = await calendar.register(
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        displayName: ctx.user.displayName,
      },
      input.eventId,
      input.answers,
    );
    // Die Teilnehmerzahl im Discord-Embed nachziehen - gesammelt, damit ein
    // Ansturm nicht in ein Discord-Limit laeuft.
    await calendar.scheduleRefresh(input.eventId);
    const event = await calendar.requireEvent(input.eventId);
    revalidateCalendar(event.slug);
    return { waitlisted: ergebnis.waitlisted, position: ergebnis.position };
  },
);

export const unregisterAction = defineAction(
  {
    name: 'calendar.unregister',
    module: MODULE_ID,
    // Selbstbedienung: die Aktion wirkt ausschliesslich auf die eigene
    // Anmeldung. Wer teilnehmen darf, darf auch wieder gehen.
    permission: P.participate,
    schema: calendar.eventIdSchema,
    rateLimit: 'calendarParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const ergebnis = await calendar.unregister(ctx.user.discordId, input.eventId);
    await calendar.scheduleRefresh(input.eventId);
    const event = await calendar.requireEvent(input.eventId);
    revalidateCalendar(event.slug);
    return { nachgerueckt: ergebnis.nachgerueckt?.discordId ?? null };
  },
);

export const removeRegistrationAction = defineAction(
  {
    name: 'calendar.registration.remove',
    module: MODULE_ID,
    permission: P.manageRegistrations,
    schema: calendar.removeRegistrationSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const ergebnis = await calendar.removeRegistration(
      actorOf(ctx),
      input.registrationId,
      input.reason,
    );
    await calendar.scheduleRefresh(ergebnis.registration.eventId);
    const event = await calendar.requireEvent(ergebnis.registration.eventId);
    revalidateCalendar(event.slug);
    return { nachgerueckt: ergebnis.nachgerueckt?.discordId ?? null };
  },
);

// --- Kategorien ---------------------------------------------------------

export const saveCategoryAction = defineAction(
  {
    name: 'calendar.category.save',
    module: MODULE_ID,
    permission: P.categoriesManage,
    schema: calendar.categoryInputSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const kategorie = await calendar.saveCategory(actorOf(ctx), input);
    revalidateCalendar();
    revalidatePath('/kalender/kategorien');
    return { categoryId: kategorie.id };
  },
);

export const deleteCategoryAction = defineAction(
  {
    name: 'calendar.category.delete',
    module: MODULE_ID,
    permission: P.categoriesManage,
    schema: calendar.categoryIdSchema,
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    await calendar.deleteCategory(actorOf(ctx), input.categoryId);
    revalidateCalendar();
    revalidatePath('/kalender/kategorien');
    return { ok: true };
  },
);

export const seedCategoriesAction = defineAction(
  {
    name: 'calendar.category.seed',
    module: MODULE_ID,
    permission: P.categoriesManage,
    schema: z.object({}),
    rateLimit: 'calendarAdmin',
    freshness: 'critical',
  },
  async ({ ctx }) => {
    await assertModuleEnabled(MODULE_ID);
    const angelegt = await calendar.seedCategories(actorOf(ctx));
    revalidatePath('/kalender/kategorien');
    return { angelegt };
  },
);
