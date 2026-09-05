import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_entwurf');

/**
 * Vom Entwurf zum veröffentlichten Termin - und was die Teilnahme auslöst.
 *
 * Zwei Dinge waren im Weg. Wer ein Event anlegte, landete auf dessen
 * Detailseite und fand dort keinen Weg, es live zu schalten: der Knopf stand
 * nur in der Verwaltungstabelle, und wer die nicht kannte, suchte vergeblich.
 *
 * Und die Rückmeldung auf den Teilnahme-Knopf darf niemanden ausser der
 * klickenden Person erreichen. Wer sich anmeldet, teilt das dem Kanal nicht
 * zwangsläufig mit - eine abgelehnte Anmeldung schon gar nicht.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const KANAL = '200000000000000020';

function attrappe() {
  const gesendet: Array<{ channelId: string; payload: Record<string, unknown> }> = [];
  const bearbeitet: Array<{ messageId: string }> = [];
  const gateway = {
    channels: {
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        gesendet.push({ channelId, payload });
        return { id: `msg-${gesendet.length}`, channelId };
      }),
      edit: vi.fn(async (_channelId: string, messageId: string) => {
        bearbeitet.push({ messageId });
      }),
    },
  } as unknown as Parameters<typeof calendar.refreshAnnouncement>[1];
  return { gateway, gesendet, bearbeitet };
}

const eingabe = (overrides: Record<string, unknown> = {}) =>
  calendar.eventInputSchema.parse({
    title: 'Community Gaming Night',
    description: 'Wir zocken zusammen.',
    startAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    ...overrides,
  });

const person = (n: number) => ({
  discordId: `90000000000000${String(n).padStart(4, '0')}`,
  username: `user${n}`,
});

describeWithDatabase('Kalender - Entwurf, Veröffentlichen und Teilnahme', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  // --- Entwurf ------------------------------------------------------------

  it('legt ein neues Event als Entwurf an', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());

    expect(event.status).toBe('DRAFT');
    expect(event.publishedAt).toBeNull();
  });

  it('zeigt einen Entwurf niemandem, der nur den Kalender liest', async () => {
    // Der Entwurf ist der Grund, weshalb es das Veröffentlichen gibt: bis
    // dahin ist der Termin für niemanden da. Die Verwaltung sieht ihn - über
    // ein Merkmal, das ausdrücklich danach fragt.
    const event = await calendar.createEvent(ADMIN, eingabe());

    const oeffentlich = await calendar.listUpcoming(20);
    const mitEntwuerfen = await calendar.listUpcoming(20, { includeDrafts: true });

    expect(oeffentlich.map((eintrag) => eintrag.id)).not.toContain(event.id);
    expect(mitEntwuerfen.map((eintrag) => eintrag.id)).toContain(event.id);
  });

  it('nimmt ihn nach dem Veröffentlichen in die öffentliche Liste auf', async () => {
    const entwurf = await calendar.createEvent(ADMIN, eingabe());
    await calendar.publishEvent(ADMIN, entwurf.id);

    const oeffentlich = await calendar.listUpcoming(20);

    expect(oeffentlich.map((eintrag) => eintrag.id)).toContain(entwurf.id);
  });

  it('macht aus dem Entwurf beim Veröffentlichen einen geplanten Termin', async () => {
    const entwurf = await calendar.createEvent(ADMIN, eingabe());

    const veroeffentlicht = await calendar.publishEvent(ADMIN, entwurf.id);

    expect(veroeffentlicht.status).toBe('SCHEDULED');
    expect(veroeffentlicht.publishedAt).not.toBeNull();
  });

  it('lässt sich nicht zweimal veröffentlichen', async () => {
    const entwurf = await calendar.createEvent(ADMIN, eingabe());
    await calendar.publishEvent(ADMIN, entwurf.id);

    await expect(calendar.publishEvent(ADMIN, entwurf.id)).rejects.toThrow();
  });

  // --- Teilnahme über Discord --------------------------------------------

  it('speichert die Teilnahme und schickt dabei nichts in den Kanal', async () => {
    // Der Knopf ruft `register` auf - dieselbe Funktion wie das Dashboard.
    // Sie schreibt in die Datenbank und sonst nirgendwohin.
    const entwurf = await calendar.createEvent(
      ADMIN,
      eingabe({ registrationEnabled: true, capacity: 5, announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet } = attrappe();
    await calendar.publishEvent(ADMIN, entwurf.id, new Date(), { gateway });
    const nachAnkuendigung = gesendet.length;

    const ergebnis = await calendar.register(person(1), entwurf.id);

    expect(ergebnis.registration.status).toBe('CONFIRMED');
    // Keine einzige zusätzliche Nachricht - die Ankündigung von vorhin zählt
    // nicht als Bestätigung der Anmeldung.
    expect(gesendet).toHaveLength(nachAnkuendigung);
  });

  it('meldet niemanden zweimal an', async () => {
    const entwurf = await calendar.createEvent(
      ADMIN,
      eingabe({ registrationEnabled: true, capacity: 5 }),
    );
    const event = await calendar.publishEvent(ADMIN, entwurf.id);
    await calendar.register(person(2), event.id);

    await expect(calendar.register(person(2), event.id)).rejects.toThrow();
    expect((await calendar.belegung(event.id)).confirmed).toBe(1);
  });

  it('setzt bei vollem Termin auf die Warteliste, statt abzuweisen', async () => {
    const entwurf = await calendar.createEvent(
      ADMIN,
      eingabe({ registrationEnabled: true, capacity: 1, waitlistEnabled: true }),
    );
    const event = await calendar.publishEvent(ADMIN, entwurf.id);
    await calendar.register(person(3), event.id);

    const zweite = await calendar.register(person(4), event.id);

    expect(zweite.registration.status).toBe('WAITLIST');
  });

  it('aktualisiert die bestehende Ankündigung, statt eine neue zu senden', async () => {
    const entwurf = await calendar.createEvent(
      ADMIN,
      eingabe({
        registrationEnabled: true,
        capacity: 5,
        announceOnDiscord: true,
        announcementChannelId: KANAL,
      }),
    );
    const { gateway, gesendet, bearbeitet } = attrappe();
    await calendar.publishEvent(ADMIN, entwurf.id, new Date(), { gateway });
    expect(gesendet).toHaveLength(1);

    await calendar.register(person(5), entwurf.id);
    await calendar.refreshAnnouncement(entwurf.id, gateway);

    expect(bearbeitet).toHaveLength(1);
    expect(gesendet).toHaveLength(1);
  });
});

/**
 * Der Knopf im Kanal ist Sache des Bots - hier lässt sich nur prüfen, dass
 * seine Antwort ausschliesslich an die klickende Person geht. Genau das war
 * die Sorge: eine für alle sichtbare Bestätigung unter jeder Ankündigung.
 */
const botQuelltext = readFileSync(
  fileURLToPath(new URL('../../apps/bot/src/calendar-interactions.ts', import.meta.url)),
  'utf8',
);

it('antwortet auf den Teilnahme-Knopf nur der klickenden Person', () => {
  expect(botQuelltext).toContain('await interaction.deferReply({ flags: MessageFlags.Ephemeral });');
  // Jede Antwort geht über `editReply` auf die zurückgehaltene Antwort - und
  // die ist ephemeral, weil das Zurückhalten es war.
  expect(botQuelltext).toMatch(/interaction\.editReply\(/u);
});

it('schickt aus dem Knopf heraus nichts in den Kanal', () => {
  // Kein `channels.send`, kein `interaction.channel.send`, kein
  // `followUp` ohne Ephemeral-Kennzeichnung.
  expect(botQuelltext).not.toMatch(/channels\.send/u);
  expect(botQuelltext).not.toMatch(/channel\?\.send|channel\.send/u);
  expect(botQuelltext).not.toMatch(/followUp\(/u);
  // `reply` ohne Flags wäre öffentlich - es kommt hier gar nicht vor.
  expect(botQuelltext).not.toMatch(/interaction\.reply\(/u);
});

it('zieht die Anzahl in der bestehenden Ankündigung nach', () => {
  // Ein Zähler, der sich ändert, ist kein neuer Beitrag: `scheduleRefresh`
  // bearbeitet die vorhandene Nachricht.
  expect(botQuelltext).toContain('calendar.scheduleRefresh(eventId)');
});

/**
 * Und die Oberfläche: der Weg vom Entwurf zum Veröffentlichen muss dort sein,
 * wo der Entwurf ist.
 */
const seite = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(`../../apps/web/src/${pfad}`, import.meta.url)), 'utf8');

it('führt nach dem Anlegen direkt auf die Entwurfsseite', () => {
  const formular = seite('modules/calendar/components/event-formular.tsx');

  expect(formular).toContain('router.push(`/kalender/${slug}/bearbeiten`)');
});

it('trägt den Veröffentlichen-Knopf im Kopf der Entwurfsseite', () => {
  const bearbeiten = seite('app/(app)/kalender/[slug]/bearbeiten/page.tsx');

  expect(bearbeiten).toContain('<VeroeffentlichenKnopf');
  // Im `actions`-Bereich der Kopfzeile, nicht irgendwo unten auf der Seite.
  const kopf = bearbeiten.slice(bearbeiten.indexOf('<PageHeader'), bearbeiten.indexOf('<EventFormular'));
  expect(kopf).toContain('<VeroeffentlichenKnopf');
});

it('zeigt ihn nur bei einem Entwurf und nur mit der Berechtigung', () => {
  for (const pfad of [
    'app/(app)/kalender/[slug]/bearbeiten/page.tsx',
    'app/(app)/kalender/[slug]/page.tsx',
  ]) {
    const quelle = seite(pfad);
    expect(quelle, pfad).toContain("event.status === 'DRAFT' && can(context, P.publish)");
  }
});

it('benutzt dafür dieselbe Server Action wie die Verwaltungstabelle', () => {
  const knopf = seite('modules/calendar/components/veroeffentlichen-knopf.tsx');
  const tabelle = seite('modules/calendar/components/verwaltungs-tabelle.tsx');

  expect(knopf).toContain("import { publishEventAction } from '@/modules/calendar/actions'");
  expect(tabelle).toContain('publishEventAction');
});
