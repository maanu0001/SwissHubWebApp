import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_anmeldung');

/**
 * Anmeldungen gegen eine echte Datenbank.
 *
 * Der Kern ist eine einzige Zusage: der letzte Platz wird genau einmal
 * vergeben. Sie laesst sich nur hier pruefen - eine Nachbildung von Prisma
 * haette keine Zeilensperre und wuerde vor allem sich selbst bestaetigen.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };

function eingabe(overrides: Record<string, unknown> = {}) {
  return calendar.eventInputSchema.parse({
    title: 'Community Gaming Night',
    description: 'Wir zocken zusammen.',
    startAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    registrationEnabled: true,
    capacity: 2,
    ...overrides,
  });
}

/** Ein veroeffentlichtes Event mit Anmeldung. */
async function offenesEvent(overrides: Record<string, unknown> = {}) {
  const event = await calendar.createEvent(ADMIN, eingabe(overrides));
  return calendar.publishEvent(ADMIN, event.id);
}

const person = (n: number) => ({
  discordId: `90000000000000${String(n).padStart(4, '0')}`,
  username: `user${n}`,
});

describeWithDatabase('Kalender-Anmeldungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
    await prisma.guildConfig?.deleteMany?.({}).catch(() => undefined);
  });

  it('bestätigt eine Anmeldung, solange Plätze frei sind', async () => {
    const event = await offenesEvent();
    const ergebnis = await calendar.register(person(1), event.id);

    expect(ergebnis.waitlisted).toBe(false);
    expect(ergebnis.registration.status).toBe('CONFIRMED');
    expect((await calendar.belegung(event.id)).confirmed).toBe(1);
  });

  it('nimmt dieselbe Person nicht zweimal auf', async () => {
    const event = await offenesEvent();
    await calendar.register(person(1), event.id);
    await expect(calendar.register(person(1), event.id)).rejects.toThrow(/bereits angemeldet/u);
  });

  it('vergibt den letzten Platz auch bei gleichzeitiger Anmeldung nur einmal', async () => {
    // Der eigentliche Fall: zwei Anfragen, ein freier Platz. Ohne Zeilensperre
    // zaehlen beide "1 von 2 belegt" und beide kommen durch.
    const event = await offenesEvent({ capacity: 1 });

    const ergebnisse = await Promise.allSettled([
      calendar.register(person(1), event.id),
      calendar.register(person(2), event.id),
    ]);
    const erfolgreich = ergebnisse.filter((e) => e.status === 'fulfilled');
    expect(erfolgreich).toHaveLength(2);

    const belegung = await calendar.belegung(event.id);
    expect(belegung.confirmed).toBe(1);
    expect(belegung.waitlist).toBe(1);
  });

  it('hält auch bei zehn gleichzeitigen Anmeldungen die Platzzahl ein', async () => {
    const event = await offenesEvent({ capacity: 3 });

    await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => calendar.register(person(i + 1), event.id)),
    );

    const belegung = await calendar.belegung(event.id);
    expect(belegung.confirmed).toBe(3);
    expect(belegung.waitlist).toBe(7);
    // Die Warteliste ist eine Reihenfolge, keine Menge: 1..7 ohne Lücke.
    const wartende = await prisma.calendarRegistration.findMany({
      where: { eventId: event.id, status: 'WAITLIST' },
      orderBy: { waitlistPosition: 'asc' },
      select: { waitlistPosition: true },
    });
    expect(wartende.map((w) => w.waitlistPosition)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('setzt bei vollem Event auf die Warteliste', async () => {
    const event = await offenesEvent({ capacity: 1 });
    await calendar.register(person(1), event.id);
    const zweiter = await calendar.register(person(2), event.id);

    expect(zweiter.waitlisted).toBe(true);
    expect(zweiter.position).toBe(1);
  });

  it('weist ohne Warteliste ab, statt still zu warten', async () => {
    const event = await offenesEvent({ capacity: 1, waitlistEnabled: false });
    await calendar.register(person(1), event.id);
    await expect(calendar.register(person(2), event.id)).rejects.toThrow(/ausgebucht/u);
  });

  it('lässt die erste wartende Person nachrücken', async () => {
    const event = await offenesEvent({ capacity: 1 });
    await calendar.register(person(1), event.id);
    await calendar.register(person(2), event.id);
    await calendar.register(person(3), event.id);

    const ergebnis = await calendar.unregister(person(1).discordId, event.id);

    expect(ergebnis.nachgerueckt?.discordId).toBe(person(2).discordId);
    expect(ergebnis.nachgerueckt?.status).toBe('CONFIRMED');
    expect(ergebnis.nachgerueckt?.promotedAt).not.toBeNull();

    // Und die dahinter rückt auf Platz 1 auf.
    const rest = await prisma.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId: event.id, discordId: person(3).discordId } },
    });
    expect(rest?.waitlistPosition).toBe(1);
  });

  it('lässt niemanden nachrücken, wenn jemand von der Warteliste abspringt', async () => {
    const event = await offenesEvent({ capacity: 1 });
    await calendar.register(person(1), event.id);
    await calendar.register(person(2), event.id);
    await calendar.register(person(3), event.id);

    const ergebnis = await calendar.unregister(person(2).discordId, event.id);

    expect(ergebnis.nachgerueckt).toBeNull();
    expect((await calendar.belegung(event.id)).confirmed).toBe(1);
    const dritter = await prisma.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId: event.id, discordId: person(3).discordId } },
    });
    expect(dritter?.waitlistPosition).toBe(1);
  });

  it('füllt nach einer Erhöhung der Platzzahl mehrere Plätze auf einmal', async () => {
    const event = await offenesEvent({ capacity: 1 });
    for (let i = 1; i <= 4; i += 1) {
      await calendar.register(person(i), event.id);
    }
    await prisma.calendarEvent.update({ where: { id: event.id }, data: { capacity: 3 } });

    const nachgerueckt = await calendar.fuelleFreiePlaetze(event.id);

    expect(nachgerueckt).toHaveLength(2);
    expect((await calendar.belegung(event.id)).confirmed).toBe(3);
  });

  it('weist nach dem Anmeldeschluss ab', async () => {
    const event = await offenesEvent({
      registrationClosesAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(calendar.register(person(1), event.id)).rejects.toThrow(/Anmeldefrist/u);
  });

  it('nimmt für einen Entwurf niemanden auf', async () => {
    const entwurf = await calendar.createEvent(ADMIN, eingabe());
    await expect(calendar.register(person(1), entwurf.id)).rejects.toThrow(/nicht veröffentlicht/u);
  });

  it('nimmt für ein abgesagtes Event niemanden auf', async () => {
    const event = await offenesEvent();
    await calendar.cancelEvent(ADMIN, event.id, 'Referent krank');
    await expect(calendar.register(person(1), event.id)).rejects.toThrow(/abgesagt/u);
  });

  it('verweigert die Abmeldung, wenn sie nicht vorgesehen ist', async () => {
    const event = await offenesEvent({ allowSelfCancel: false });
    await calendar.register(person(1), event.id);
    await expect(calendar.unregister(person(1).discordId, event.id)).rejects.toThrow(
      /keine eigenständige Abmeldung/u,
    );
  });

  it('verweigert die Abmeldung nach dem Abmeldeschluss', async () => {
    const event = await offenesEvent({
      cancelDeadlineAt: new Date(Date.now() - 1000).toISOString(),
    });
    await calendar.register(person(1), event.id);
    await expect(calendar.unregister(person(1).discordId, event.id)).rejects.toThrow(/Frist/u);
  });

  it('erlaubt die erneute Anmeldung nach einer Abmeldung', async () => {
    const event = await offenesEvent();
    await calendar.register(person(1), event.id);
    await calendar.unregister(person(1).discordId, event.id);

    const erneut = await calendar.register(person(1), event.id);
    expect(erneut.registration.status).toBe('CONFIRMED');
    expect((await calendar.belegung(event.id)).confirmed).toBe(1);
  });

  it('zählt eine abgemeldete Person nicht mehr mit', async () => {
    const event = await offenesEvent({ capacity: 0 });
    await calendar.register(person(1), event.id);
    await calendar.register(person(2), event.id);
    await calendar.unregister(person(1).discordId, event.id);

    expect((await calendar.belegung(event.id)).confirmed).toBe(1);
    expect(await calendar.meineAnmeldung(event.id, person(1).discordId)).toBeNull();
  });

  it('verlangt Pflicht-Zusatzfragen und prüft die Auswahl', async () => {
    const event = await offenesEvent({
      capacity: 0,
      questions: [
        { label: 'Ingame-Name', required: true, choices: [] },
        { label: 'Rolle', required: false, choices: ['Tank', 'Heiler'] },
      ],
    });
    const fragen = await prisma.calendarQuestion.findMany({
      where: { eventId: event.id },
      orderBy: { position: 'asc' },
    });

    await expect(calendar.register(person(1), event.id, {})).rejects.toThrow(/Ingame-Name/u);
    await expect(
      calendar.register(person(1), event.id, {
        [fragen[0]!.id]: 'Nina',
        [fragen[1]!.id]: 'Magier',
      }),
    ).rejects.toThrow(/nicht zur Auswahl/u);

    const ok = await calendar.register(person(1), event.id, {
      [fragen[0]!.id]: 'Nina',
      [fragen[1]!.id]: 'Tank',
    });
    expect(ok.registration.status).toBe('CONFIRMED');

    const liste = await calendar.listRegistrations(event.id, { withAnswers: true });
    expect(liste[0]?.answers).toEqual([
      { question: 'Ingame-Name', value: 'Nina' },
      { question: 'Rolle', value: 'Tank' },
    ]);
  });

  it('gibt Antworten nur heraus, wenn sie angefordert werden', async () => {
    // Die Antworten gehen die Organisation etwas an, nicht die öffentliche
    // Liste. Deshalb kommen sie nicht standardmässig mit.
    const event = await offenesEvent({
      capacity: 0,
      questions: [{ label: 'Ingame-Name', required: true, choices: [] }],
    });
    const frage = await prisma.calendarQuestion.findFirstOrThrow({ where: { eventId: event.id } });
    await calendar.register(person(1), event.id, { [frage.id]: 'Nina' });

    const oeffentlich = await calendar.listRegistrations(event.id);
    expect(oeffentlich[0]?.answers).toEqual([]);
  });
});
