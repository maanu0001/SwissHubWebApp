import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_raffle_nachlauf');

/**
 * Das Nachlauffenster des XP-Glücksrads.
 *
 * Nach der Bestätigung bleibt der Eintrag in der Seitenleiste noch
 * vierundzwanzig Stunden stehen, damit die Ziehung auch sehen kann, wer nicht
 * zufällig in der richtigen Minute online war. Die Grenze zieht die Datenbank
 * über `completedAt` - kein Browser-Timer, kein `localStorage`.
 *
 * Echte 24 Stunden ab dem Zeitpunkt, nicht «bis Ende des nächsten Tages».
 * Die Zeit wird injiziert, damit die Grenze prüfbar ist, ohne einen Tag zu
 * warten - die Wahrheit bleibt trotzdem der Server.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const STUNDE = 60 * 60 * 1000;

async function verlosung(
  status:
    | 'DRAFT'
    | 'SCHEDULED'
    | 'ENTRY_OPEN'
    | 'ENTRY_CLOSED'
    | 'DRAWING'
    | 'WINNER_PENDING'
    | 'COMPLETED'
    | 'CANCELLED',
  completedAt: Date | null = null,
): Promise<string> {
  const zeile = await prisma.xpRaffle.create({
    data: {
      title: 'Testverlosung',
      prizeDescription: 'Ein Preis',
      entryModel: 'FIXED',
      fixedEntryXp: 100,
      status,
      completedAt,
      createdByDiscordId: '100000000000000001',
    },
  });
  return zeile.id;
}

describeWithDatabase('XP-Glücksrad: Nachlauffenster', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "XpRaffle" RESTART IDENTITY CASCADE');
  });

  it('zeigt den Eintrag, solange eine Verlosung läuft', async () => {
    await verlosung('ENTRY_OPEN');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
  });

  it('zeigt den Eintrag, solange die Ziehung auf Bestätigung wartet', async () => {
    await verlosung('WINNER_PENDING');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
  });

  it('zeigt den Eintrag unmittelbar nach der Bestätigung', async () => {
    const gezogen = new Date('2026-09-09T20:00:00.000Z');
    await verlosung('COMPLETED', gezogen);

    expect(await level.raffle.hatLaufendeVerlosung(gezogen)).toBe(true);
  });

  it('zeigt den Eintrag 23 Stunden 59 Minuten nach der Bestätigung noch', async () => {
    const gezogen = new Date('2026-09-09T20:00:00.000Z');
    await verlosung('COMPLETED', gezogen);

    const kurzDavor = new Date(gezogen.getTime() + 23 * STUNDE + 59 * 60_000);
    expect(await level.raffle.hatLaufendeVerlosung(kurzDavor)).toBe(true);
  });

  it('zeigt den Eintrag exakt 24 Stunden nach der Bestätigung nicht mehr', async () => {
    // Die Grenze selbst gehört nicht mehr dazu: Ziehung um 20:00 heisst
    // sichtbar bis 20:00 am nächsten Tag - und dann nicht mehr.
    const gezogen = new Date('2026-09-09T20:00:00.000Z');
    await verlosung('COMPLETED', gezogen);

    const genau = new Date(gezogen.getTime() + 24 * STUNDE);
    expect(await level.raffle.hatLaufendeVerlosung(genau)).toBe(false);
  });

  it('zeigt den Eintrag eine Millisekunde vor der Grenze noch', async () => {
    const gezogen = new Date('2026-09-09T20:00:00.000Z');
    await verlosung('COMPLETED', gezogen);

    const knapp = new Date(gezogen.getTime() + 24 * STUNDE - 1);
    expect(await level.raffle.hatLaufendeVerlosung(knapp)).toBe(true);
  });

  it('zeigt den Eintrag 24 Stunden 1 Minute nach der Bestätigung nicht mehr', async () => {
    const gezogen = new Date('2026-09-09T20:00:00.000Z');
    await verlosung('COMPLETED', gezogen);

    const danach = new Date(gezogen.getTime() + 24 * STUNDE + 60_000);
    expect(await level.raffle.hatLaufendeVerlosung(danach)).toBe(false);
  });

  it('zeigt gar nichts, wenn es weder eine laufende noch eine frische Ziehung gibt', async () => {
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);
  });

  it('lässt einen Entwurf und eine abgebrochene Verlosung ausser Betracht', async () => {
    await verlosung('DRAFT');
    await verlosung('CANCELLED');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);
  });

  it('hebt eine frisch abgeschlossene Verlosung auf der Seite hervor', async () => {
    const id = await verlosung('COMPLETED', new Date(Date.now() - STUNDE));
    expect((await level.raffle.getFeaturedRaffle())?.id).toBe(id);
  });

  it('hebt eine alte Verlosung nicht mehr als aktuell hervor', async () => {
    // Sonst stünde eine Ziehung von vorletztem Monat noch immer oben auf der
    // Seite, ohne dass etwas darauf hinwiese.
    await verlosung('COMPLETED', new Date(Date.now() - 30 * 24 * STUNDE));
    expect(await level.raffle.getFeaturedRaffle()).toBeNull();
  });

  it('zieht die laufende Verlosung der frisch abgeschlossenen vor', async () => {
    await verlosung('COMPLETED', new Date(Date.now() - STUNDE));
    const laufend = await verlosung('ENTRY_OPEN');

    expect((await level.raffle.getFeaturedRaffle())?.id).toBe(laufend);
  });

  it('zeigt den Eintrag bei geschlossener, aber noch nicht gezogener Teilnahme', async () => {
    // Der Zustand zwischen Teilnahmeschluss und Ziehung - dort ist die
    // Verlosung besonders interessant, und genau dort wäre ein fehlender
    // Eintrag am ärgerlichsten.
    await verlosung('ENTRY_CLOSED');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
  });

  it('zeigt den Eintrag während der laufenden Ziehung', async () => {
    await verlosung('DRAWING');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
  });

  it('zeigt den Eintrag bei einer nur geplanten Verlosung noch nicht', async () => {
    // Veröffentlicht, aber die Teilnahme hat noch nicht begonnen. Es gibt
    // dort nichts zu tun ausser zu warten - der Eintrag erscheint, wenn die
    // Teilnahme tatsächlich offen ist.
    await verlosung('SCHEDULED');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);
  });

  it('zeigt den Eintrag, sobald aus geplant offen wird', async () => {
    const id = await verlosung('SCHEDULED');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);

    await prisma.xpRaffle.update({ where: { id }, data: { status: 'ENTRY_OPEN' } });
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
  });

  it('gibt einer abgebrochenen Verlosung kein Nachlauffenster', async () => {
    // Auch nicht, wenn sie einen `completedAt` trägt: abgebrochen ist kein
    // Ereignis, auf dessen Ergebnis jemand wartet.
    await verlosung('CANCELLED', new Date(Date.now() - STUNDE));
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);
  });

  it('lässt eine alte abgeschlossene neben einer laufenden ausser Betracht', async () => {
    // Mehrere Verlosungen nebeneinander: die laufende entscheidet, die alte
    // hält den Eintrag weder künstlich sichtbar noch verdeckt sie ihn.
    await verlosung('COMPLETED', new Date(Date.now() - 40 * STUNDE));
    await verlosung('ENTRY_OPEN');

    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
    expect((await level.raffle.getFeaturedRaffle())?.status).toBe('ENTRY_OPEN');
  });

  it('lässt mehrere alte abgeschlossene den Eintrag nicht sichtbar halten', async () => {
    for (const alter of [25, 48, 72, 240]) {
      await verlosung('COMPLETED', new Date(Date.now() - alter * STUNDE));
    }
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);
  });

  it('zeigt den Eintrag wieder, sobald nach einer alten eine neue startet', async () => {
    await verlosung('COMPLETED', new Date(Date.now() - 40 * STUNDE));
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);

    const neue = await verlosung('ENTRY_OPEN');
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
    expect((await level.raffle.getFeaturedRaffle())?.id).toBe(neue);
  });

  it('hebt von zwei frisch abgeschlossenen die jüngere hervor', async () => {
    await verlosung('COMPLETED', new Date(Date.now() - 6 * STUNDE));
    const juengere = await verlosung('COMPLETED', new Date(Date.now() - STUNDE));

    expect((await level.raffle.getFeaturedRaffle())?.id).toBe(juengere);
  });

  it('nennt zwölf Stunden für die Bühne und vierundzwanzig für die Seitenleiste', async () => {
    expect(level.raffle.RAFFLE_NACHLAUF_MS).toBe(12 * STUNDE);
    expect(level.raffle.RAFFLE_SEITENLEISTE_MS).toBe(24 * STUNDE);
  });

  it('lässt die Seitenleiste nie vor der Bühne abräumen', async () => {
    // Die Bedingung, unter der zwei Fristen überhaupt tragen. Wäre die
    // Seitenleiste die kürzere, stünde eine hervorgehobene Verlosung ohne
    // Weg dorthin auf der Seite - sichtbar für jeden, der die Adresse schon
    // kennt, und für niemanden sonst.
    expect(level.raffle.RAFFLE_SEITENLEISTE_MS).toBeGreaterThanOrEqual(level.raffle.RAFFLE_NACHLAUF_MS);
  });

  it('zeigt den Eintrag noch, wenn die Bühne bereits abgeräumt ist', async () => {
    // Das Fenster zwischen den beiden Fristen: dreizehn Stunden nach der
    // Bestätigung ist die Verlosung nicht mehr hervorgehoben, aber weiterhin
    // über die Navigation zu finden - dort steht sie unter «Vergangene
    // Verlosungen», samt Gewinner. Der Eintrag zeigt also nicht ins Leere.
    const gezogen = new Date(Date.now() - 13 * STUNDE);
    const id = await verlosung('COMPLETED', gezogen);

    expect(await level.raffle.getFeaturedRaffle()).toBeNull();
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
    expect((await level.raffle.getPastRaffles(8)).map((eintrag) => eintrag.id)).toContain(id);
  });

  it('räumt die Bühne nach zwölf Stunden, nicht früher', async () => {
    const gezogen = new Date(Date.now() - 12 * STUNDE + 60_000);
    const id = await verlosung('COMPLETED', gezogen);

    expect((await level.raffle.getFeaturedRaffle())?.id).toBe(id);
  });

  it('nennt genau die Zustände, in denen der Eintrag ohne Frist steht', async () => {
    expect([...level.raffle.NAVIGATION_STATUSES]).toEqual([
      'ENTRY_OPEN',
      'ENTRY_CLOSED',
      'DRAWING',
      'WINNER_PENDING',
    ]);
  });

  it('unterscheidet sich von den laufenden Zuständen genau um SCHEDULED', async () => {
    // Für die Seite ist eine geplante Verlosung eine laufende - sie zeigt den
    // Countdown. Für die Navigation noch nicht. Der Unterschied ist Absicht
    // und soll einer bleiben.
    const nurInLive = [...level.raffle.LIVE_STATUSES].filter(
      (status) => !level.raffle.NAVIGATION_STATUSES.includes(status),
    );

    expect(nurInLive).toEqual(['SCHEDULED']);
  });
});
