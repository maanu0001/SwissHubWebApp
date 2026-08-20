import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
// Muss vor dem Import des Prisma Clients passieren.
useTestSchema('test_level_service');

/**
 * Die zentrale XP-Engine.
 *
 * Geprüft wird, was im Betrieb Geld kostet: dass kein XP-Stand negativ wird,
 * dass jede Änderung im Journal steht, dass eine wiederholte Buchung nicht
 * doppelt zählt, dass ein Einsatz beim Annehmen wirklich weg ist und dass
 * niemand denselben Punktestand in zwei Partien gleichzeitig setzen kann.
 *
 * Läuft gegen eine echte Datenbank - die Zusicherungen hängen an
 * Unique-Indizes und Transaktionen, nicht an Anwendungscode.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const ALICE = { discordId: '900000000000000001', username: 'alice' };
const BOB = { discordId: '900000000000000002', username: 'bob' };

describeWithDatabase('Level-Engine', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.xpTransaction.deleteMany();
    await prisma.levelGameStats.deleteMany();
    await prisma.levelGameMatch.deleteMany();
    await prisma.levelMilestoneRole.deleteMany();
    await prisma.levelProfile.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('legt beim ersten XP ein Profil an und schreibt das Journal', async () => {
    const result = await level.applyXp({ ...ALICE, delta: 500, source: 'MESSAGE' });

    expect(result.xpBefore).toBe(0);
    expect(result.xpAfter).toBe(500);
    expect(result.levelBefore).toBe(1);
    expect(result.levelAfter).toBe(2);
    expect(result.levelUp).toBe(true);

    const transactions = await prisma.xpTransaction.findMany({ where: { discordId: ALICE.discordId } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.delta).toBe(500);
    expect(transactions[0]!.source).toBe('MESSAGE');
  });

  it('lässt einen XP-Stand nie unter null fallen', async () => {
    await level.applyXp({ ...ALICE, delta: 100, source: 'ADMIN' });
    const result = await level.applyXp({ ...ALICE, delta: -500, source: 'ADMIN' });

    expect(result.xpAfter).toBe(0);
    // Verbucht wurde nur, was vorhanden war - angefordert war mehr.
    expect(result.delta).toBe(-100);

    const booked = await prisma.xpTransaction.findFirst({
      where: { discordId: ALICE.discordId },
      orderBy: { createdAt: 'desc' },
    });
    expect(booked!.delta).toBe(-100);
    expect(booked!.requestedDelta).toBe(-500);
  });

  it('hält Journal und Punktestand deckungsgleich', async () => {
    for (const delta of [10, 250, -30, 4000, -1000, 12]) {
      await level.applyXp({ ...ALICE, delta, source: 'ADMIN' });
    }

    const profile = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } });
    const sum = await prisma.xpTransaction.aggregate({
      where: { discordId: ALICE.discordId },
      _sum: { delta: true },
    });

    expect(sum._sum.delta).toBe(profile.xp);
  });

  it('bucht dieselbe Anfrage nicht zweimal', async () => {
    const key = 'test:einmalig';
    const first = await level.applyXp({ ...ALICE, delta: 300, source: 'GAME_WIN', idempotencyKey: key });
    const second = await level.applyXp({ ...ALICE, delta: 300, source: 'GAME_WIN', idempotencyKey: key });

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);

    const profile = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } });
    expect(profile.xp).toBe(300);
    expect(await prisma.xpTransaction.count({ where: { discordId: ALICE.discordId } })).toBe(1);
  });

  it('setzt einen Stand exakt, statt ihn aufzuaddieren', async () => {
    await level.applyXp({ ...ALICE, delta: 999, source: 'MESSAGE' });
    const result = await level.setXp(ALICE, 5220, { source: 'MIGRATION', reason: 'Altdaten' });

    expect(result.xpAfter).toBe(5220);
    expect(result.levelAfter).toBe(10);

    const profile = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } });
    expect(profile.xp).toBe(5220);
  });

  it('verrechnet den Inaktivitäts-Abzug und schreibt ihn ins Journal', async () => {
    const past = new Date(Date.now() - 12 * 86_400_000);
    await level.applyXp({ ...ALICE, delta: 5000, source: 'ADMIN' });
    await prisma.levelProfile.update({
      where: { discordId: ALICE.discordId },
      data: { lastActivityAt: past, lastDecayAt: past },
    });

    const result = await level.settleDecayFor(ALICE.discordId);

    // Fünf Abzugstage: viermal 50, einmal 25.
    expect(result!.decayed).toBe(225);
    expect(result!.profile.xp).toBe(4775);

    const decay = await prisma.xpTransaction.findFirst({
      where: { discordId: ALICE.discordId, source: 'DECAY' },
    });
    expect(decay).not.toBeNull();
    expect(decay!.delta).toBe(-225);
  });

  it('holt den Abzug vor einer Buchung nach, wenn er fällig ist', async () => {
    const past = new Date(Date.now() - 9 * 86_400_000);
    await level.applyXp({ ...ALICE, delta: 5000, source: 'ADMIN' });
    await prisma.levelProfile.update({
      where: { discordId: ALICE.discordId },
      data: { lastActivityAt: past, lastDecayAt: past },
    });

    const result = await level.applyXp(
      { ...ALICE, delta: 10, source: 'MESSAGE', touchActivity: true },
      { applyDecayFirst: true },
    );

    // Zwei Abzugstage à 50 XP, danach die 10 XP der Nachricht.
    expect(result.decayed).toBe(100);
    expect(result.xpAfter).toBe(4910);
  });

  it('zieht einen zweiten Abzug für dieselben Tage nicht erneut ab', async () => {
    const past = new Date(Date.now() - 12 * 86_400_000);
    await level.applyXp({ ...ALICE, delta: 5000, source: 'ADMIN' });
    await prisma.levelProfile.update({
      where: { discordId: ALICE.discordId },
      data: { lastActivityAt: past, lastDecayAt: past },
    });

    const first = await level.settleDecayFor(ALICE.discordId);
    const second = await level.settleDecayFor(ALICE.discordId);

    expect(first!.decayed).toBe(225);
    expect(second!.decayed).toBe(0);
  });

  it('merkt eine Aktivität auch ohne XP vor', async () => {
    await level.touchActivity(ALICE, { markMessage: true });

    const profile = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } });
    expect(profile.xp).toBe(0);
    expect(profile.lastActivityAt).not.toBeNull();
    expect(profile.lastMessageAt).not.toBeNull();
    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  it('zählt die Rangliste nach XP', async () => {
    await level.applyXp({ ...ALICE, delta: 1000, source: 'ADMIN' });
    await level.applyXp({ ...BOB, delta: 2000, source: 'ADMIN' });

    const board = await level.getLeaderboard({ limit: 10 });
    expect(board.entries.map((entry) => entry.discordId)).toEqual([BOB.discordId, ALICE.discordId]);
    expect(board.entries[0]!.rank).toBe(1);
    expect(await level.getRank(ALICE.discordId)).toBe(2);
  });
});

describeWithDatabase('XP-Spiele', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.xpTransaction.deleteMany();
    await prisma.levelGameStats.deleteMany();
    await prisma.levelGameMatch.deleteMany();
    await prisma.levelProfile.deleteMany();
    await level.applyXp({ ...ALICE, delta: 1000, source: 'ADMIN' });
    await level.applyXp({ ...BOB, delta: 1000, source: 'ADMIN' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const challenge = () =>
    level.createChallenge({
      kind: 'XP_BATTLE',
      challenger: ALICE,
      opponent: BOB,
      bet: 100,
    });

  it('zieht beim Annehmen beide Einsätze ein', async () => {
    const match = await challenge();

    // Vor dem Annehmen ist noch nichts abgebucht.
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } })).xp).toBe(1000);

    await level.acceptChallenge(match.id, BOB);

    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } })).xp).toBe(900);
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: BOB.discordId } })).xp).toBe(900);
  });

  it('zahlt dem Gewinner den Topf aus', async () => {
    const match = await challenge();
    await level.acceptChallenge(match.id, BOB);
    const result = await level.finishGame(match.id, ALICE.discordId);

    // 100 Einsatz, Topf 200, davon 95 Prozent = 190.
    expect(result.payout).toBe(190);
    expect(result.net).toBe(90);
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } })).xp).toBe(1090);
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: BOB.discordId } })).xp).toBe(900);
  });

  it('lässt keine zwei Partien gleichzeitig zu', async () => {
    await challenge();
    await expect(challenge()).rejects.toThrow(/scho es Spiel/u);
  });

  it('gibt die Beteiligten nach dem Abrechnen wieder frei', async () => {
    const match = await challenge();
    await level.acceptChallenge(match.id, BOB);
    await level.finishGame(match.id, ALICE.discordId);

    expect(await level.findActiveGame(ALICE.discordId)).toBeNull();
    await expect(challenge()).resolves.toBeTruthy();
  });

  it('gibt die Einsätze bei Unentschieden zurück', async () => {
    const match = await challenge();
    await level.acceptChallenge(match.id, BOB);
    await level.closeGame(match.id, 'DRAW', 'Unentschieden');

    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } })).xp).toBe(1000);
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: BOB.discordId } })).xp).toBe(1000);
  });

  it('bucht nichts ab, wenn die Herausforderung abgelehnt wird', async () => {
    const match = await challenge();
    await level.closeGame(match.id, 'DECLINED', 'Abgelehnt');

    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } })).xp).toBe(1000);
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: BOB.discordId } })).xp).toBe(1000);
  });

  it('weist einen Einsatz über dem Guthaben ab', async () => {
    await expect(
      level.createChallenge({ kind: 'XP_TTT', challenger: ALICE, opponent: BOB, bet: 5000 }),
    ).rejects.toThrow(/gnueg XP/u);
  });

  it('zählt Siege und Niederlagen je Spielart', async () => {
    const match = await challenge();
    await level.acceptChallenge(match.id, BOB);
    await level.finishGame(match.id, ALICE.discordId);

    const winner = await prisma.levelGameStats.findUniqueOrThrow({
      where: { discordId_kind: { discordId: ALICE.discordId, kind: 'XP_BATTLE' } },
    });
    const loser = await prisma.levelGameStats.findUniqueOrThrow({
      where: { discordId_kind: { discordId: BOB.discordId, kind: 'XP_BATTLE' } },
    });

    expect(winner.wins).toBe(1);
    expect(winner.xpWon).toBe(90);
    expect(loser.losses).toBe(1);
    expect(loser.xpLost).toBe(100);
  });

  it('rechnet eine Partie kein zweites Mal ab', async () => {
    const match = await challenge();
    await level.acceptChallenge(match.id, BOB);
    await level.finishGame(match.id, ALICE.discordId);

    await expect(level.finishGame(match.id, ALICE.discordId)).rejects.toThrow(/scho abgrechnet/u);
    expect((await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ALICE.discordId } })).xp).toBe(1090);
  });

  it('lässt Gewinn und Verlust in Summe kein XP entstehen', async () => {
    const match = await challenge();
    await level.acceptChallenge(match.id, BOB);
    await level.finishGame(match.id, ALICE.discordId);

    const total = await prisma.levelProfile.aggregate({ _sum: { xp: true } });
    // 2000 XP vorher, davon verfallen 5 Prozent des Topfs: 200 - 190 = 10.
    expect(total._sum.xp).toBe(1990);
  });
});
