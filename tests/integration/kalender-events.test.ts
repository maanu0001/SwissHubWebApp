import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_events');

/**
 * Lebenslauf eines Events, Discord-Ankündigung und Sichtbarkeit.
 *
 * Die Zusagen: ein Entwurf ist für gewöhnliche Mitglieder nicht vorhanden,
 * eine Ankündigung wird fortgeschrieben statt erneut gepostet, eine Absage
 * löscht nichts, und die Zeitsteuerung zerstört keine historischen Daten.
 */
const { prisma } = await import('@swisshub/database');
const { calendar, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const KANAL = '900000000000000100';
const ROLLE = '900000000000000200';

function attrappe() {
  const gesendet: Array<{ channelId: string; payload: unknown }> = [];
  const bearbeitet: Array<{ messageId: string; payload: unknown }> = [];
  const gateway = {
    channels: {
      send: vi.fn(async (channelId: string, payload: unknown) => {
        gesendet.push({ channelId, payload });
        return { id: `msg-${gesendet.length}`, channelId };
      }),
      edit: vi.fn(async (_channelId: string, messageId: string, payload: unknown) => {
        bearbeitet.push({ messageId, payload });
      }),
    },
  } as unknown as Parameters<typeof calendar.refreshAnnouncement>[1];
  return { gateway, gesendet, bearbeitet };
}

const eingabe = (overrides: Record<string, unknown> = {}) =>
  calendar.eventInputSchema.parse({
    title: 'Community Gaming Night',
    description: 'Wir zocken zusammen.',
    startAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
    ...overrides,
  });

describeWithDatabase('Kalender-Events', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(calendar.CALENDAR_MODULE_ID, true, 'test');
    await setModuleSettings(
      calendar.CALENDAR_MODULE_ID,
      { defaultAnnouncementChannelId: KANAL, mentionableRoleIds: [ROLLE], remindersEnabled: true },
      'test',
    );
  });

  // --- Lebenslauf --------------------------------------------------------

  it('legt ein Event als Entwurf an', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    expect(event.status).toBe('DRAFT');
    expect(event.slug).toBe('community-gaming-night');
    expect(event.publishedAt).toBeNull();
  });

  it('vergibt bei gleichem Namen einen eigenen Adressteil', async () => {
    await calendar.createEvent(ADMIN, eingabe());
    const zweites = await calendar.createEvent(ADMIN, eingabe());
    expect(zweites.slug).toBe('community-gaming-night-2');
  });

  it('veröffentlicht einen Entwurf', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    const veroeffentlicht = await calendar.publishEvent(ADMIN, event.id);
    expect(veroeffentlicht.status).toBe('SCHEDULED');
    expect(veroeffentlicht.publishedAt).not.toBeNull();
  });

  it('führt ein Event, das beim Veröffentlichen schon läuft, als laufend', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ startAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    const veroeffentlicht = await calendar.publishEvent(ADMIN, event.id);
    expect(veroeffentlicht.status).toBe('ONGOING');
  });

  it('veröffentlicht nicht zweimal', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    await calendar.publishEvent(ADMIN, event.id);
    await expect(calendar.publishEvent(ADMIN, event.id)).rejects.toThrow(/bereits veröffentlicht/u);
  });

  it('behält ein abgesagtes Event, statt es zu löschen', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    await calendar.publishEvent(ADMIN, event.id);

    const abgesagt = await calendar.cancelEvent(ADMIN, event.id, 'Referent krank');

    expect(abgesagt.status).toBe('CANCELLED');
    expect(abgesagt.cancelReason).toBe('Referent krank');
    expect(await prisma.calendarEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
  });

  it('lässt ein beendetes Event nicht mehr bearbeiten', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    await prisma.calendarEvent.update({ where: { id: event.id }, data: { status: 'COMPLETED' } });
    await expect(calendar.updateEvent(ADMIN, event.id, eingabe())).rejects.toThrow(/beendetes/u);
  });

  it('meldet wesentliche Änderungen, damit man Teilnehmer informieren kann', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    await calendar.publishEvent(ADMIN, event.id);
    const neuerStart = new Date(event.startAt.getTime() + 3600_000);

    const ergebnis = await calendar.updateEvent(
      ADMIN,
      event.id,
      eingabe({ startAt: neuerStart.toISOString() }),
    );

    expect(ergebnis.wesentlich.map((a) => a.feld)).toContain('startAt');
  });

  it('meldet eine reine Textänderung nicht als wesentlich', async () => {
    // Ein korrigierter Tippfehler ist keine Nachricht an alle Angemeldeten
    // wert. Derselbe Startzeitpunkt in beiden Eingaben - sonst prüfte der
    // Fall eine Verschiebung statt einer Textänderung.
    const start = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    const event = await calendar.createEvent(ADMIN, eingabe({ startAt: start }));
    const ergebnis = await calendar.updateEvent(
      ADMIN,
      event.id,
      eingabe({ startAt: start, description: 'Wir zocken zusammen. Neue Fassung.' }),
    );
    expect(ergebnis.wesentlich).toEqual([]);
  });

  // --- Duplizieren -------------------------------------------------------

  it('dupliziert Einstellungen, aber keine Teilnehmer', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        registrationEnabled: true,
        capacity: 10,
        reminderMinutes: [60],
        questions: [{ label: 'Ingame-Name', required: true, choices: [] }],
      }),
    );
    await calendar.publishEvent(ADMIN, event.id);
    const frage = await prisma.calendarQuestion.findFirstOrThrow({ where: { eventId: event.id } });
    await calendar.register({ discordId: '900000000000001111' }, event.id, {
      [frage.id]: 'Nina',
    });

    const neuerStart = new Date(Date.now() + 14 * 24 * 3600_000);
    const kopie = await calendar.duplicateEvent(ADMIN, event.id, neuerStart);

    expect(kopie.status).toBe('DRAFT');
    expect(kopie.capacity).toBe(10);
    expect(kopie.registrationEnabled).toBe(true);
    expect(await prisma.calendarRegistration.count({ where: { eventId: kopie.id } })).toBe(0);
    expect(await prisma.calendarQuestion.count({ where: { eventId: kopie.id } })).toBe(1);
    // Erinnerungen kommen mit, ihre Fälligkeit hängt am neuen Termin.
    const erinnerung = await prisma.calendarReminder.findFirstOrThrow({
      where: { eventId: kopie.id },
    });
    expect(erinnerung.dueAt.getTime()).toBe(neuerStart.getTime() - 60 * 60_000);
    expect(erinnerung.sentAt).toBeNull();
  });

  it('übernimmt beim Duplizieren die Dauer der Vorlage', async () => {
    const start = new Date(Date.now() + 3 * 24 * 3600_000);
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + 3 * 3600_000).toISOString(),
      }),
    );
    const neuerStart = new Date(Date.now() + 14 * 24 * 3600_000);
    const kopie = await calendar.duplicateEvent(ADMIN, event.id, neuerStart);
    expect(kopie.endAt!.getTime() - kopie.startAt.getTime()).toBe(3 * 3600_000);
  });

  // --- Discord -----------------------------------------------------------

  it('kündigt beim Veröffentlichen an, ohne dass es ein zweiter Schritt wäre', async () => {
    // Das Häkchen «Auf Discord ankündigen» ist eine Ansage darüber, was beim
    // Veröffentlichen geschehen soll. Vorher geschah es nicht: der Termin ging
    // live, im Kanal blieb es still, und wer den zusätzlichen Knopf in der
    // Verwaltung nicht kannte, hielt die Ankündigung für kaputt.
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet } = attrappe();

    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    expect(gesendet).toHaveLength(1);
    const frisch = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(frisch.discordMessageId).toBe('msg-1');
    expect(frisch.discordMessageMissing).toBe(false);
  });

  it('kündigt dasselbe Event nicht zweimal an', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet } = attrappe();
    await calendar.announceEvent(event.id, { gateway });
    await calendar.announceEvent(event.id, { gateway });
    expect(gesendet).toHaveLength(1);
  });

  it('schreibt die bestehende Nachricht fort, statt eine neue zu posten', async () => {
    // Wer den Kanal liest, soll nicht fünf Fassungen desselben Abends sehen.
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet, bearbeitet } = attrappe();
    await calendar.announceEvent(event.id, { gateway });

    const erfolg = await calendar.refreshAnnouncement(event.id, gateway);

    expect(erfolg).toBe(true);
    expect(gesendet).toHaveLength(1);
    expect(bearbeitet).toHaveLength(1);
    expect(bearbeitet[0]?.messageId).toBe('msg-1');
  });

  it('vermerkt eine von Hand gelöschte Ankündigung, statt still neu zu posten', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway } = attrappe();
    await calendar.announceEvent(event.id, { gateway });

    const kaputt = {
      channels: {
        send: vi.fn(),
        edit: vi.fn(async () => {
          throw new Error('Unknown Message');
        }),
      },
    } as unknown as Parameters<typeof calendar.refreshAnnouncement>[1];

    expect(await calendar.refreshAnnouncement(event.id, kaputt)).toBe(false);
    const frisch = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(frisch.discordMessageMissing).toBe(true);
  });

  it('kennzeichnet ein abgesagtes Event im Embed', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    await calendar.publishEvent(ADMIN, event.id);
    const abgesagt = await calendar.cancelEvent(ADMIN, event.id, 'Referent krank');

    const embed = calendar.buildEventEmbed(abgesagt, { confirmed: 0, capacity: 0, waitlist: 0 });

    expect(embed.title).toContain('ABGESAGT');
    expect(embed.description).toContain('Referent krank');
  });

  it('erwähnt nur freigegebene Rollen in der Ankündigung', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        mentionRoleId: '900000000000000999',
      }),
    );
    // Die nicht freigegebene Rolle wird gar nicht erst gespeichert.
    expect(event.mentionRoleId).toBeNull();

    const erlaubt = await calendar.createEvent(
      ADMIN,
      eingabe({
        title: 'Mit erlaubtem Ping',
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        mentionRoleId: ROLLE,
      }),
    );
    expect(erlaubt.mentionRoleId).toBe(ROLLE);
  });

  it('benachrichtigt Angemeldete über eine Absage', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL, registrationEnabled: true }),
    );
    await calendar.publishEvent(ADMIN, event.id);
    await calendar.register({ discordId: '900000000000002001' }, event.id);
    await calendar.register({ discordId: '900000000000002002' }, event.id);
    await calendar.cancelEvent(ADMIN, event.id, 'Referent krank');
    const { gateway, gesendet } = attrappe();

    const ergebnis = await calendar.notifyParticipants(event.id, 'CANCELLED', { gateway });

    expect(ergebnis.empfaenger).toBe(2);
    expect(gesendet).toHaveLength(1);
    const payload = gesendet[0]?.payload as { content: string; allowedMentions: { users: string[] } };
    expect(payload.content).toContain('Abgesagt');
    expect(payload.allowedMentions.users).toHaveLength(2);
  });

  it('schickt keine Nachricht an niemanden', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet } = attrappe();
    const ergebnis = await calendar.notifyParticipants(event.id, 'CANCELLED', { gateway });
    expect(ergebnis.gesendet).toBe(false);
    expect(gesendet).toHaveLength(0);
  });

  // --- Zeitsteuerung -----------------------------------------------------

  it('schreibt Events auf laufend und beendet fort', async () => {
    const start = new Date(Date.now() - 60 * 60_000);
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      }),
    );
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { status: 'SCHEDULED', publishedAt: new Date() },
    });

    const ersterLauf = await calendar.runCalendarTick(new Date(start.getTime() + 60_000));
    expect(ersterLauf.gestartet).toContain(event.id);

    const zweiterLauf = await calendar.runCalendarTick(new Date());
    expect(zweiterLauf.beendet).toContain(event.id);

    const fertig = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(fertig.status).toBe('COMPLETED');
    expect(fertig.startedAt).not.toBeNull();
    expect(fertig.completedAt).not.toBeNull();
  });

  it('rührt ein abgesagtes Event nicht an', async () => {
    // Die Zeitsteuerung darf historische Daten nicht überschreiben.
    const start = new Date(Date.now() - 60 * 60_000);
    const event = await calendar.createEvent(ADMIN, eingabe({ startAt: start.toISOString() }));
    await calendar.publishEvent(ADMIN, event.id);
    await calendar.cancelEvent(ADMIN, event.id, 'Referent krank');

    await calendar.runCalendarTick(new Date());

    const frisch = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(frisch.status).toBe('CANCELLED');
  });

  it('lässt einen Entwurf unangetastet, auch wenn sein Termin vorbei ist', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ startAt: new Date(Date.now() - 3 * 3600_000).toISOString() }),
    );
    await calendar.runCalendarTick(new Date());
    const frisch = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(frisch.status).toBe('DRAFT');
  });

  // --- Löschen -----------------------------------------------------------

  it('verweigert das Löschen eines laufenden Events mit Angemeldeten', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe({ registrationEnabled: true, capacity: 0 }));
    await calendar.publishEvent(ADMIN, event.id);
    await calendar.register({ discordId: '900000000000003001' }, event.id);

    await expect(calendar.deleteEvent(ADMIN, event.id, 'Aufräumen')).rejects.toThrow(/sage es ab/u);
  });

  it('löscht einen Entwurf und schreibt es ins Audit Log', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe());
    await calendar.deleteEvent(ADMIN, event.id, 'Testeintrag aufräumen');

    expect(await prisma.calendarEvent.findUnique({ where: { id: event.id } })).toBeNull();
    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'CALENDAR_EVENT_DELETED' },
      orderBy: { sequence: 'desc' },
    });
    expect(eintrag?.targetLabel).toBe('Community Gaming Night');
  });

  // --- Sichtbarkeit ------------------------------------------------------

  it('zeigt einen Entwurf nur denen, die ihn verwalten dürfen', async () => {
    // Kein Anzeigeproblem: ein unveröffentlichtes Event soll auch über die
    // Kalenderabfrage nicht sichtbar werden.
    const event = await calendar.createEvent(ADMIN, eingabe());
    const von = new Date(Date.now() - 24 * 3600_000);
    const bis = new Date(Date.now() + 30 * 24 * 3600_000);

    const fuerMitglieder = await calendar.listEventsInRange(von, bis, {}, {});
    const fuerVerwaltung = await calendar.listEventsInRange(von, bis, {}, { includeDrafts: true });

    expect(fuerMitglieder.map((z) => z.id)).not.toContain(event.id);
    expect(fuerVerwaltung.map((z) => z.id)).toContain(event.id);
  });

  it('findet Events, die in den Zeitraum hineinragen', async () => {
    // Der über Mitternacht laufende Abend: er beginnt vor dem Ausschnitt und
    // endet darin. Nur nach dem Beginn zu filtern hiesse, ihn zu verlieren.
    const start = new Date('2026-09-04T20:00:00.000Z');
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        startAt: start.toISOString(),
        endAt: new Date('2026-09-05T02:00:00.000Z').toISOString(),
      }),
    );
    await calendar.publishEvent(ADMIN, event.id);

    const treffer = await calendar.listEventsInRange(
      new Date('2026-09-05T00:00:00.000Z'),
      new Date('2026-09-06T00:00:00.000Z'),
      {},
      {},
    );
    expect(treffer.map((z) => z.id)).toContain(event.id);
  });

  it('filtert nach Kategorie, Suche und freien Plätzen', async () => {
    const kategorie = await calendar.saveCategory(ADMIN, {
      name: 'Turnier',
      color: '#EA580C',
      active: true,
      position: 0,
      description: null,
      icon: null,
      defaultBannerUrl: null,
    });
    const mitKategorie = await calendar.createEvent(
      ADMIN,
      eingabe({ title: 'Turnierabend', categoryId: kategorie.id }),
    );
    await calendar.publishEvent(ADMIN, mitKategorie.id);
    const voll = await calendar.createEvent(
      ADMIN,
      eingabe({ title: 'Volles Event', registrationEnabled: true, capacity: 1 }),
    );
    await calendar.publishEvent(ADMIN, voll.id);
    await calendar.register({ discordId: '900000000000004001' }, voll.id);

    const von = new Date(Date.now() - 24 * 3600_000);
    const bis = new Date(Date.now() + 30 * 24 * 3600_000);

    const nachKategorie = await calendar.listEventsInRange(von, bis, {
      categoryId: kategorie.id,
    });
    expect(nachKategorie.map((z) => z.id)).toEqual([mitKategorie.id]);

    const nachSuche = await calendar.listEventsInRange(von, bis, { search: 'turnier' });
    expect(nachSuche.map((z) => z.id)).toEqual([mitKategorie.id]);

    const freiePlaetze = await calendar.listEventsInRange(von, bis, { withFreeSeats: true });
    expect(freiePlaetze.map((z) => z.id)).not.toContain(voll.id);
  });

  it('zeigt unter «Meine Events» nur die eigenen Anmeldungen', async () => {
    const meins = await calendar.createEvent(ADMIN, eingabe({ title: 'Meins', registrationEnabled: true }));
    await calendar.publishEvent(ADMIN, meins.id);
    const fremd = await calendar.createEvent(ADMIN, eingabe({ title: 'Fremd' }));
    await calendar.publishEvent(ADMIN, fremd.id);
    await calendar.register({ discordId: '900000000000005001' }, meins.id);

    const liste = await calendar.listMine('900000000000005001');
    expect(liste.map((z) => z.id)).toEqual([meins.id]);
  });
});
