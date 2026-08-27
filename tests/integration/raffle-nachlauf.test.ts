import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_raffle_nachlauf');

/**
 * Das Nachlauffenster des XP-Glücksrads.
 *
 * Nach der Bestätigung bleibt der Eintrag in der Seitenleiste noch zwölf
 * Stunden stehen, damit die Ziehung auch sehen kann, wer nicht zufällig in
 * der richtigen Minute online war. Die Grenze zieht die Datenbank über
 * `completedAt` - kein Browser-Timer, kein `localStorage`.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const STUNDE = 60 * 60 * 1000;

async function verlosung(
  status: 'DRAFT' | 'ENTRY_OPEN' | 'WINNER_PENDING' | 'COMPLETED' | 'CANCELLED',
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

  it('zeigt den Eintrag 11 Stunden 59 Minuten nach der Bestätigung noch', async () => {
    await verlosung('COMPLETED', new Date(Date.now() - (11 * STUNDE + 59 * 60_000)));
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(true);
  });

  it('zeigt den Eintrag 12 Stunden 1 Minute nach der Bestätigung nicht mehr', async () => {
    await verlosung('COMPLETED', new Date(Date.now() - (12 * STUNDE + 60_000)));
    expect(await level.raffle.hatLaufendeVerlosung()).toBe(false);
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

  it('nennt zwölf Stunden als Nachlauf', async () => {
    // Die Zahl steht an einer Stelle; Seitenleiste und Seite lesen dieselbe.
    expect(level.raffle.RAFFLE_NACHLAUF_MS).toBe(12 * STUNDE);
  });
});
