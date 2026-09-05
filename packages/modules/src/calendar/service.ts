import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CalendarEvent, CalendarEventStatus, Prisma } from '@swisshub/database';
import { resolveGuildId, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict, notFound, validationFailed } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { slugify } from '../tournaments/events';
import { CALENDAR_MODULE_ID, type CalendarSettings } from './config';
import type { CalendarActor, EventInput } from './schemas';

const logger = createLogger('calendar:service');

/**
 * Der Lebenslauf eines Termins.
 *
 * Dies ist die einzige Stelle, an der ein Termin entsteht, seinen Zustand
 * wechselt oder endet. Kalenderseite, Verwaltung und der Bot rufen dieselben
 * Funktionen auf - es gibt keine zweite Fassung der Regeln je Oberflaeche.
 */

/** Aus welchem Zustand welcher Uebergang erlaubt ist. */
const ERLAUBTE_UEBERGAENGE: Record<CalendarEventStatus, readonly CalendarEventStatus[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['ONGOING', 'COMPLETED', 'CANCELLED'],
  ONGOING: ['COMPLETED', 'CANCELLED'],
  // Ein beendeter Termin bleibt beendet. Wer ihn wiederholen will, dupliziert
  // ihn - das erhaelt die Teilnehmerliste des gelaufenen Abends.
  COMPLETED: [],
  CANCELLED: [],
};

export function kannWechseln(von: CalendarEventStatus, nach: CalendarEventStatus): boolean {
  return ERLAUBTE_UEBERGAENGE[von].includes(nach);
}

const STATUS_LABEL: Record<CalendarEventStatus, string> = {
  DRAFT: 'Entwurf',
  SCHEDULED: 'Geplant',
  ONGOING: 'Läuft',
  COMPLETED: 'Beendet',
  CANCELLED: 'Abgesagt',
};

export const eventStatusLabel = (status: CalendarEventStatus): string => STATUS_LABEL[status];

/** Zustaende, in denen ein Termin fuer gewoehnliche Mitglieder sichtbar ist. */
export const OEFFENTLICHE_STATUS: readonly CalendarEventStatus[] = [
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
];

/** Zustaende, in denen ein Termin noch bevorsteht oder laeuft. */
export const AKTIVE_STATUS: readonly CalendarEventStatus[] = ['SCHEDULED', 'ONGOING'];

export async function calendarSettings(): Promise<CalendarSettings> {
  return getModuleSettings<CalendarSettings>(CALENDAR_MODULE_ID);
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  return prisma.calendarEvent.findUnique({ where: { id } });
}

export async function requireEvent(id: string): Promise<CalendarEvent> {
  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) {
    throw notFound('Termin nicht gefunden', 'Dieses Event existiert nicht.');
  }
  return event;
}

export async function getEventBySlug(slug: string): Promise<CalendarEvent | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.calendarEvent.findUnique({ where: { guildId_slug: { guildId, slug } } });
}

/**
 * Ein Termin, gefunden ueber Kennung **oder** Adressteil.
 *
 * Die Detailseite nimmt beides: Links aus Discord tragen den Adressteil, ein
 * Link aus der Verwaltung die Kennung. Zwei Routen dafuer waeren zwei Stellen,
 * die dieselbe Berechtigung pruefen muessten.
 */
export async function findEvent(idOrSlug: string): Promise<CalendarEvent | null> {
  const ueberSlug = await getEventBySlug(idOrSlug);
  return ueberSlug ?? (await getEvent(idOrSlug));
}

/**
 * Wann ein Termin fuer die Anzeige endet.
 *
 * Ohne Endzeit wird die eingestellte Vorgabedauer angenommen - fuer Kalender
 * und ICS-Export braucht es eine Ausdehnung. Erfunden wird dabei nichts: die
 * Detailseite zeigt weiterhin «offenes Ende», und `endAt` bleibt leer.
 */
export function anzeigeEnde(event: CalendarEvent, vorgabeMinuten: number): Date {
  if (event.endAt) {
    return event.endAt;
  }
  return new Date(event.startAt.getTime() + vorgabeMinuten * 60_000);
}

async function freierSlug(guildId: string, wunsch: string, eigeneId?: string): Promise<string> {
  const basis = slugify(wunsch) || 'event';
  for (let versuch = 0; versuch < 50; versuch += 1) {
    const kandidat = versuch === 0 ? basis : `${basis}-${versuch + 1}`;
    const belegt = await prisma.calendarEvent.findUnique({
      where: { guildId_slug: { guildId, slug: kandidat } },
      select: { id: true },
    });
    if (!belegt || belegt.id === eigeneId) {
      return kandidat;
    }
  }
  throw conflict('Zu diesem Namen gibt es bereits zu viele Events. Bitte einen anderen wählen.');
}

/**
 * Rollen-Erwaehnung pruefen.
 *
 * Erwaehnt wird nur, was in den Moduleinstellungen freigegeben ist. Ein
 * freies Feld am Termin waere ein Ping-Knopf fuer den ganzen Server -
 * dieselbe Regel wie im Turniermodul.
 */
export function erlaubteErwaehnung(
  roleId: string | null | undefined,
  settings: CalendarSettings,
): string | null {
  if (!roleId) {
    return null;
  }
  return settings.mentionableRoleIds.includes(roleId) ? roleId : null;
}

function felderAus(
  input: EventInput,
  settings: CalendarSettings,
): Omit<Prisma.CalendarEventUncheckedCreateInput, 'guildId' | 'slug' | 'createdByDiscordId'> {
  // Das Schema hat `startAt` bereits erzwungen; der abgeleitete Typ traegt
  // die Null trotzdem noch mit. Lieber hier laut scheitern als eine Null in
  // die Datenbank schreiben.
  if (!input.startAt) {
    throw validationFailed({ startAt: 'fehlt' }, 'Bitte ein gültiges Datum und eine Uhrzeit wählen.');
  }
  return {
    title: input.title,
    description: input.description,
    shortDescription: input.shortDescription,
    categoryId: input.categoryId,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    allDay: input.allDay,
    locationKind: input.locationKind,
    locationChannelId: input.locationChannelId || null,
    locationVoiceId: input.locationVoiceId || null,
    locationUrl: input.locationUrl,
    locationName: input.locationName,
    locationAddress: input.locationAddress,
    bannerUrl: input.bannerUrl,
    iconUrl: input.iconUrl,
    organizerDiscordIds: input.organizerDiscordIds,
    contactNote: input.contactNote,
    registrationEnabled: input.registrationEnabled,
    capacity: input.capacity,
    registrationClosesAt: input.registrationClosesAt,
    waitlistEnabled: input.waitlistEnabled,
    allowSelfCancel: input.allowSelfCancel,
    cancelDeadlineAt: input.cancelDeadlineAt,
    participantsPublic: input.participantsPublic,
    announceOnDiscord: input.announceOnDiscord,
    announcementChannelId: input.announcementChannelId || null,
    mentionRoleId: erlaubteErwaehnung(input.mentionRoleId, settings),
  };
}

/** Fragen und Erinnerungen eines Termins auf den Eingabestand bringen. */
async function schreibeAnhaenge(
  tx: Prisma.TransactionClient,
  eventId: string,
  input: EventInput,
  startAt: Date,
): Promise<void> {
  // --- Zusatzfragen ------------------------------------------------------
  //
  // Bestehende Fragen behalten ihre Kennung, damit bereits gegebene Antworten
  // zugeordnet bleiben. Nur was aus der Eingabe verschwunden ist, faellt weg -
  // und mit ihm, ueber die Kaskade, seine Antworten.
  const behalten = input.questions.map((frage) => frage.id).filter((id): id is string => Boolean(id));
  await tx.calendarQuestion.deleteMany({
    where: { eventId, ...(behalten.length > 0 ? { id: { notIn: behalten } } : {}) },
  });
  for (const [index, frage] of input.questions.entries()) {
    const daten = {
      label: frage.label,
      hint: frage.hint,
      required: frage.required,
      choices: frage.choices,
      position: index,
    };
    if (frage.id) {
      await tx.calendarQuestion.update({ where: { id: frage.id }, data: daten });
    } else {
      await tx.calendarQuestion.create({ data: { eventId, ...daten } });
    }
  }

  // --- Erinnerungen ------------------------------------------------------
  //
  // Bereits verschickte bleiben unangetastet: sie sind Verlauf, kein Plan.
  // Alles Ausstehende wird neu gesetzt - auch die Faelligkeit, denn ein
  // verschobener Termin verschiebt seine Erinnerungen mit.
  await tx.calendarReminder.deleteMany({
    where: { eventId, sentAt: null, minutesBefore: { notIn: input.reminderMinutes } },
  });
  for (const minuten of input.reminderMinutes) {
    const dueAt = new Date(startAt.getTime() - minuten * 60_000);
    const daten = {
      dueAt,
      channelId: input.reminderChannelId || null,
      mentionRoleId: input.reminderMentionRoleId || null,
      mentionRegistrants: input.reminderMentionRegistrants,
    };
    const vorhanden = await tx.calendarReminder.findUnique({
      where: { eventId_minutesBefore: { eventId, minutesBefore: minuten } },
    });
    if (!vorhanden) {
      await tx.calendarReminder.create({ data: { eventId, minutesBefore: minuten, ...daten } });
    } else if (!vorhanden.sentAt) {
      await tx.calendarReminder.update({ where: { id: vorhanden.id }, data: daten });
    }
  }
}

export async function createEvent(actor: CalendarActor, input: EventInput): Promise<CalendarEvent> {
  const guildId = await resolveGuildId();
  const settings = await calendarSettings();
  const slug = await freierSlug(guildId, input.title);

  const event = await prisma.$transaction(async (tx) => {
    const angelegt = await tx.calendarEvent.create({
      data: {
        guildId,
        slug,
        createdByDiscordId: actor.discordId,
        ...felderAus(input, settings),
      },
    });
    await schreibeAnhaenge(tx, angelegt.id, input, angelegt.startAt);
    return angelegt;
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_CREATED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: { eventId: event.id, slug, startAt: event.startAt, status: event.status },
  });
  logger.info('Event angelegt', { eventId: event.id, slug });
  return event;
}

/** Aenderungen, die Angemeldete etwas angehen. */
export interface WesentlicheAenderung {
  feld: 'startAt' | 'endAt' | 'ort';
  vorher: string | null;
  nachher: string | null;
}

export interface UpdateResult {
  event: CalendarEvent;
  /**
   * Was sich geaendert hat und Angemeldete betrifft.
   *
   * Grundlage fuer das Angebot «Teilnehmer über Änderung informieren» - der
   * Versand geschieht nicht selbsttaetig: ob eine um zehn Minuten verschobene
   * Startzeit eine Nachricht wert ist, entscheidet der Veranstalter.
   */
  wesentlich: WesentlicheAenderung[];
}

function ortsBeschreibung(event: CalendarEvent): string {
  return [
    event.locationKind,
    event.locationName,
    event.locationChannelId,
    event.locationVoiceId,
    event.locationUrl,
  ]
    .filter(Boolean)
    .join(' · ');
}

export async function updateEvent(
  actor: CalendarActor,
  id: string,
  input: EventInput,
): Promise<UpdateResult> {
  const vorher = await requireEvent(id);
  if (vorher.status === 'COMPLETED' || vorher.status === 'CANCELLED') {
    throw conflict('Ein beendetes oder abgesagtes Event lässt sich nicht mehr bearbeiten.');
  }
  const guildId = await resolveGuildId();
  const settings = await calendarSettings();
  const slug =
    slugify(input.title) === slugify(vorher.title)
      ? vorher.slug
      : await freierSlug(guildId, input.title, vorher.id);

  const event = await prisma.$transaction(async (tx) => {
    const aktualisiert = await tx.calendarEvent.update({
      where: { id },
      data: { slug, ...felderAus(input, settings) },
    });
    await schreibeAnhaenge(tx, id, input, aktualisiert.startAt);
    return aktualisiert;
  });

  const wesentlich: WesentlicheAenderung[] = [];
  if (vorher.startAt.getTime() !== event.startAt.getTime()) {
    wesentlich.push({
      feld: 'startAt',
      vorher: vorher.startAt.toISOString(),
      nachher: event.startAt.toISOString(),
    });
  }
  if ((vorher.endAt?.getTime() ?? null) !== (event.endAt?.getTime() ?? null)) {
    wesentlich.push({
      feld: 'endAt',
      vorher: vorher.endAt?.toISOString() ?? null,
      nachher: event.endAt?.toISOString() ?? null,
    });
  }
  if (ortsBeschreibung(vorher) !== ortsBeschreibung(event)) {
    wesentlich.push({
      feld: 'ort',
      vorher: ortsBeschreibung(vorher),
      nachher: ortsBeschreibung(event),
    });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_UPDATED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: { eventId: event.id, wesentlich },
  });
  return { event, wesentlich };
}

export async function publishEvent(
  actor: CalendarActor,
  id: string,
  now = new Date(),
  options: { gateway?: DiscordGateway } = {},
): Promise<CalendarEvent> {
  const event = await requireEvent(id);
  if (event.status !== 'DRAFT') {
    throw conflict('Dieses Event ist bereits veröffentlicht.');
  }
  // Ein Termin, der beim Veroeffentlichen schon laeuft, wird nicht als
  // «geplant» ausgewiesen - der naechste Lauf der Zeitsteuerung korrigierte
  // es zwar, aber bis dahin stuende etwas Falsches da.
  const status: CalendarEventStatus = event.startAt <= now ? 'ONGOING' : 'SCHEDULED';

  const aktualisiert = await prisma.calendarEvent.update({
    where: { id },
    data: { status, publishedAt: now, ...(status === 'ONGOING' ? { startedAt: now } : {}) },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_PUBLISHED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: { eventId: id, status },
  });
  const { meldeEreignis } = await import('../automation/emit');
  await meldeEreignis(
    'calendar.event_published',
    {
      eventId: id,
      titel: aktualisiert.title,
      beginntAm: aktualisiert.startAt.toISOString(),
      kategorie: aktualisiert.categoryId,
    },
    { guildId: aktualisiert.guildId, actorId: actor.discordId, entityId: id },
  );

  // Wer «Auf Discord ankündigen» angehakt hat, hat damit gesagt, was beim
  // Veröffentlichen geschehen soll. Bisher geschah es nicht: das Häkchen
  // stand da, der Termin ging live, und im Kanal blieb es still, bis jemand
  // in der Verwaltung zusätzlich «Ankündigen» drückte. Wer das nicht wusste,
  // hielt die Ankündigung für kaputt.
  //
  // `announceEvent` prüft selbst, ob angekündigt werden soll und ob es
  // bereits geschehen ist, und wirft nicht: ein Discord-Ausfall darf eine
  // Veröffentlichung nicht rückgängig machen. Der Weg über die Verwaltung
  // bleibt für den Fall, dass es beim ersten Mal nicht geklappt hat.
  const { announceEvent } = await import('./discord');
  await announceEvent(id, { actor, ...(options.gateway ? { gateway: options.gateway } : {}) }).catch(
    (error: unknown) =>
      logger.warn('Ankündigung nach dem Veröffentlichen fehlgeschlagen', { eventId: id, error }),
  );

  logger.info('Event veröffentlicht', { eventId: id, status });
  return aktualisiert;
}

export async function cancelEvent(
  actor: CalendarActor,
  id: string,
  reason: string,
  now = new Date(),
): Promise<CalendarEvent> {
  const event = await requireEvent(id);
  if (event.status === 'CANCELLED') {
    throw conflict('Dieses Event ist bereits abgesagt.');
  }
  if (event.status === 'COMPLETED') {
    throw conflict('Ein beendetes Event lässt sich nicht mehr absagen.');
  }

  // Der Termin bleibt stehen. Geloescht wird er nicht: Angemeldete sollen
  // sehen, dass der Abend abgesagt wurde, statt ihn spurlos zu vermissen.
  const aktualisiert = await prisma.calendarEvent.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
  });

  // Ausstehende Erinnerungen bleiben als Zeile stehen und gehen trotzdem
  // nicht raus: der Arbeitslauf verschickt nur fuer laufende und geplante
  // Termine. Sie zu loeschen waere die schlechtere Loesung - wird die Absage
  // zurueckgenommen, waere der Plan weg.

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_CANCELLED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: { eventId: id, reason },
  });
  logger.info('Event abgesagt', { eventId: id });
  return aktualisiert;
}

export interface DeleteSummary {
  title: string;
  status: CalendarEventStatus;
  registrations: number;
}

/**
 * Ein Event endgueltig entfernen.
 *
 * Der Regelweg ist die Absage - sie erhaelt den Verlauf. Geloescht wird nur,
 * was aufgeraeumt gehoert: ein Entwurf, der nie stattfand, oder ein alter
 * Termin, den niemand mehr braucht. Ein laufendes oder bevorstehendes Event
 * mit Angemeldeten laesst sich nicht loeschen; wer es beenden will, sagt es
 * ab, und die Angemeldeten erfahren davon.
 */
export async function deleteEvent(actor: CalendarActor, id: string, reason: string): Promise<DeleteSummary> {
  const event = await requireEvent(id);
  if (event.status === 'SCHEDULED' || event.status === 'ONGOING') {
    const angemeldet = await prisma.calendarRegistration.count({
      where: { eventId: id, status: { in: ['CONFIRMED', 'WAITLIST'] } },
    });
    if (angemeldet > 0) {
      throw conflict(
        `Für dieses Event sind ${angemeldet} Personen angemeldet. Bitte sage es ab - dabei werden sie informiert.`,
      );
    }
  }

  const registrations = await prisma.calendarRegistration.count({ where: { eventId: id } });
  await prisma.calendarEvent.delete({ where: { id } });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_DELETED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: {
      eventId: id,
      slug: event.slug,
      reason,
      status: event.status,
      startAt: event.startAt,
      registrations,
      discordChannelId: event.announcementChannelId,
      discordMessageId: event.discordMessageId,
    },
  });
  logger.info('Event gelöscht', { eventId: id, status: event.status });
  return { title: event.title, status: event.status, registrations };
}

/**
 * Ein Event als Vorlage fuer den naechsten Termin.
 *
 * Uebernommen wird alles, was die Ausrichtung beschreibt - Beschreibung, Ort,
 * Kategorie, Anmeldeeinstellungen, Zusatzfragen, Erinnerungsvorlauf und die
 * Discord-Konfiguration. Nicht uebernommen wird, was zum gelaufenen Abend
 * gehoert: Teilnehmer, Ankuendigung, Verlaufsdaten. Das Duplikat startet als
 * Entwurf.
 */
export async function duplicateEvent(
  actor: CalendarActor,
  id: string,
  startAt: Date,
  options: { endAt?: Date | null; title?: string | null } = {},
): Promise<CalendarEvent> {
  const vorlage = await prisma.calendarEvent.findUnique({
    where: { id },
    include: { questions: { orderBy: { position: 'asc' } }, reminders: true },
  });
  if (!vorlage) {
    throw notFound('Termin nicht gefunden', 'Dieses Event existiert nicht.');
  }
  const guildId = await resolveGuildId();
  const titel = options.title ?? vorlage.title;
  const slug = await freierSlug(guildId, titel);

  // Die Dauer der Vorlage beibehalten, wenn kein neues Ende angegeben wurde -
  // ein Community-Abend dauert beim naechsten Mal genauso lang.
  const dauer = vorlage.endAt ? vorlage.endAt.getTime() - vorlage.startAt.getTime() : null;
  const endAt =
    options.endAt !== undefined ? options.endAt : dauer !== null ? new Date(startAt.getTime() + dauer) : null;

  const kopie = await prisma.$transaction(async (tx) => {
    const angelegt = await tx.calendarEvent.create({
      data: {
        guildId,
        slug,
        title: titel,
        description: vorlage.description,
        shortDescription: vorlage.shortDescription,
        categoryId: vorlage.categoryId,
        status: 'DRAFT',
        startAt,
        endAt,
        timezone: vorlage.timezone,
        allDay: vorlage.allDay,
        locationKind: vorlage.locationKind,
        locationChannelId: vorlage.locationChannelId,
        locationVoiceId: vorlage.locationVoiceId,
        locationUrl: vorlage.locationUrl,
        locationName: vorlage.locationName,
        locationAddress: vorlage.locationAddress,
        bannerUrl: vorlage.bannerUrl,
        iconUrl: vorlage.iconUrl,
        createdByDiscordId: actor.discordId,
        organizerDiscordIds: vorlage.organizerDiscordIds,
        contactNote: vorlage.contactNote,
        registrationEnabled: vorlage.registrationEnabled,
        capacity: vorlage.capacity,
        // Fristen sind an den alten Termin gebunden und waeren fuer den neuen
        // falsch. Lieber leer als verschoben geraten.
        registrationClosesAt: null,
        waitlistEnabled: vorlage.waitlistEnabled,
        allowSelfCancel: vorlage.allowSelfCancel,
        cancelDeadlineAt: null,
        participantsPublic: vorlage.participantsPublic,
        announceOnDiscord: vorlage.announceOnDiscord,
        announcementChannelId: vorlage.announcementChannelId,
        mentionRoleId: vorlage.mentionRoleId,
      },
    });

    for (const frage of vorlage.questions) {
      await tx.calendarQuestion.create({
        data: {
          eventId: angelegt.id,
          label: frage.label,
          hint: frage.hint,
          required: frage.required,
          choices: frage.choices,
          position: frage.position,
        },
      });
    }
    // Vorlauf uebernehmen, Faelligkeit am neuen Termin rechnen.
    for (const erinnerung of vorlage.reminders) {
      await tx.calendarReminder.create({
        data: {
          eventId: angelegt.id,
          minutesBefore: erinnerung.minutesBefore,
          dueAt: new Date(startAt.getTime() - erinnerung.minutesBefore * 60_000),
          channelId: erinnerung.channelId,
          mentionRoleId: erinnerung.mentionRoleId,
          mentionRegistrants: erinnerung.mentionRegistrants,
        },
      });
    }
    return angelegt;
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_CREATED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: kopie.title,
    success: true,
    metadata: { eventId: kopie.id, slug, dupliziertVon: id },
  });
  logger.info('Event dupliziert', { eventId: kopie.id, vorlage: id });
  return kopie;
}

/**
 * Darf diese Person diesen Termin verwalten?
 *
 * Zwei Wege fuehren hin: die allgemeine Bearbeitungsberechtigung, oder
 * Zustaendigkeit fuer genau diesen Termin. Der zweite Weg ist der Grund,
 * weshalb es `calendar.manageOwn` gibt - wer einen Abend ausrichtet, soll
 * seinen Termin pflegen koennen, ohne Zugriff auf jeden fremden zu bekommen.
 *
 * Diese Funktion gewaehrt nichts. Sie beantwortet nur die Frage; der Aufrufer
 * prueft die Berechtigung weiterhin serverseitig.
 */
export function istZustaendig(event: CalendarEvent, discordId: string): boolean {
  return event.createdByDiscordId === discordId || event.organizerDiscordIds.includes(discordId);
}

export { AppError };
