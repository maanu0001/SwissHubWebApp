import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
useTestSchema('test_raffle');

/**
 * XP-Verlosungen gegen eine echte Datenbank.
 *
 * Die entscheidenden Zusagen lassen sich nur hier prüfen: dass Abbuchung und
 * Teilnahme zusammen stehen oder fallen, dass niemand zweimal mitmacht, dass
 * ein Abbruch jeden Einsatz genau einmal zurückzahlt und dass der Einsatz
 * nach der Teilnahme unverändert bleibt.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');
const { raffle: R } = level;

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };

/** Vorgabe eines Formulars, wie es aus dem Dashboard käme. */
const draftInput = (overrides: Record<string, unknown> = {}) =>
  R.raffleSchema.parse({
    title: 'Gaming Gear Giveaway',
    prizeKind: 'EXTERNAL_PRIZE',
    prizeDescription: '1 Monat Discord Nitro',
    entryModel: 'FIXED',
    fixedEntryXp: 500,
    minimumParticipants: 2,
    ...overrides,
  });

async function giveXp(discordId: string, xp: number): Promise<void> {
  await prisma.levelProfile.upsert({
    where: { discordId },
    create: { discordId, xp, username: `user-${discordId.slice(-3)}` },
    update: { xp },
  });
}

/** Legt eine Verlosung an und öffnet die Teilnahme. */
async function openRaffle(overrides: Record<string, unknown> = {}) {
  const created = await R.createRaffle(ADMIN, draftInput(overrides));
  return R.publishRaffle(ADMIN, created.id);
}

const xpOf = async (discordId: string): Promise<number> =>
  (await prisma.levelProfile.findUnique({ where: { discordId } }))?.xp ?? 0;

describeWithDatabase('XP-Verlosungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "XpRaffleRefund","XpRaffleDraw","XpRaffleEntry","XpRaffle","XpTransaction","LevelProfile","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('zieht den Einsatz ab und legt die Teilnahme an', async () => {
    await giveXp('900000000000000001', 12_450);
    const created = await openRaffle();

    const result = await R.enterRaffle({ discordId: '900000000000000001' }, created.id);

    expect(result.alreadyEntered).toBe(false);
    expect(result.entry.entryXp).toBe(500);
    expect(result.entry.weight).toBe(1);
    expect(result.xpAfter).toBe(11_950);
    expect(await xpOf('900000000000000001')).toBe(11_950);
  });

  it('schreibt die Abbuchung ins zentrale XP-Journal', async () => {
    await giveXp('900000000000000001', 5000);
    const created = await openRaffle();
    await R.enterRaffle({ discordId: '900000000000000001' }, created.id);

    const ledger = await prisma.xpTransaction.findFirst({
      where: { discordId: '900000000000000001', source: 'RAFFLE_ENTRY' },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.delta).toBe(-500);
    expect(ledger!.xpBefore).toBe(5000);
    expect(ledger!.xpAfter).toBe(4500);
    expect(ledger!.reason).toContain('Gaming Gear Giveaway');
  });

  it('weist eine Teilnahme ohne genügend XP ab und bucht nichts', async () => {
    await giveXp('900000000000000002', 499);
    const created = await openRaffle();

    await expect(R.enterRaffle({ discordId: '900000000000000002' }, created.id)).rejects.toThrow(
      /nid gnueg XP/u,
    );

    // Weder Teilnahme noch Abbuchung dürfen zurückbleiben.
    expect(await xpOf('900000000000000002')).toBe(499);
    expect(await prisma.xpRaffleEntry.count()).toBe(0);
    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  it('lässt niemanden zweimal teilnehmen', async () => {
    await giveXp('900000000000000003', 5000);
    const created = await openRaffle();

    const first = await R.enterRaffle({ discordId: '900000000000000003' }, created.id);
    const second = await R.enterRaffle({ discordId: '900000000000000003' }, created.id);

    expect(first.alreadyEntered).toBe(false);
    expect(second.alreadyEntered).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    // Nur einmal bezahlt.
    expect(await xpOf('900000000000000003')).toBe(4500);
    expect(await prisma.xpRaffleEntry.count()).toBe(1);
  });

  it('bucht auch bei gleichzeitigen Anfragen nur einmal ab', async () => {
    await giveXp('900000000000000004', 5000);
    const created = await openRaffle();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => R.enterRaffle({ discordId: '900000000000000004' }, created.id)),
    );

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await prisma.xpRaffleEntry.count()).toBe(1);
    expect(await xpOf('900000000000000004')).toBe(4500);
    expect(await prisma.xpTransaction.count({ where: { source: 'RAFFLE_ENTRY' } })).toBe(1);
  });

  it('gibt beim Festbetrag allen dasselbe Gewicht', async () => {
    const created = await openRaffle();
    for (let index = 0; index < 4; index += 1) {
      const discordId = `90000000000000010${index}`;
      await giveXp(discordId, 1000 * (index + 1));
      await R.enterRaffle({ discordId }, created.id);
    }

    const detail = await R.getRaffleDetail(created.id);
    expect(detail!.totalWeight).toBe(4);
    for (const participant of detail!.participants) {
      expect(participant.weight).toBe(1);
      expect(participant.chance).toBeCloseTo(0.25, 10);
    }
  });

  it('gewichtet beim Anteilsmodell nach dem bezahlten Einsatz', async () => {
    const created = await openRaffle({
      entryModel: 'PERCENTAGE',
      fixedEntryXp: null,
      percentage: 5,
    });

    await giveXp('900000000000000201', 20_000);
    await giveXp('900000000000000202', 10_000);
    await R.enterRaffle({ discordId: '900000000000000201' }, created.id);
    await R.enterRaffle({ discordId: '900000000000000202' }, created.id);

    const detail = await R.getRaffleDetail(created.id);
    const [reich, arm] = detail!.participants;
    expect(reich!.entryXp).toBe(1000);
    expect(arm!.entryXp).toBe(500);
    expect(reich!.chance).toBeCloseTo(2 / 3, 6);
    expect(arm!.chance).toBeCloseTo(1 / 3, 6);
  });

  it('hält den Einsatz fest, auch wenn später XP dazukommen', async () => {
    const created = await openRaffle({
      entryModel: 'PERCENTAGE',
      fixedEntryXp: null,
      percentage: 5,
    });
    await giveXp('900000000000000301', 10_000);
    const result = await R.enterRaffle({ discordId: '900000000000000301' }, created.id);
    expect(result.entry.entryXp).toBe(500);

    // Die Person verdient danach kräftig dazu.
    await level.applyXp({ discordId: '900000000000000301', delta: 90_000, source: 'ADMIN' });

    const entry = await prisma.xpRaffleEntry.findUniqueOrThrow({ where: { id: result.entry.id } });
    expect(entry.entryXp).toBe(500);
    expect(entry.weight).toBe(500);
    expect(entry.xpBeforeEntry).toBe(10_000);
  });

  it('verweigert die Teilnahme, sobald die Ziehung läuft', async () => {
    await giveXp('900000000000000401', 5000);
    await giveXp('900000000000000402', 5000);
    const created = await openRaffle();
    await R.enterRaffle({ discordId: '900000000000000401' }, created.id);
    await R.enterRaffle({ discordId: '900000000000000402' }, created.id);
    await R.closeEntries(ADMIN, created.id);

    await giveXp('900000000000000403', 5000);
    await expect(R.enterRaffle({ discordId: '900000000000000403' }, created.id)).rejects.toThrow(/nid offe/u);
  });

  it('zahlt beim Abbruch jeden Einsatz genau einmal zurück', async () => {
    const created = await openRaffle();
    const teilnehmende = ['900000000000000501', '900000000000000502', '900000000000000503'];
    for (const discordId of teilnehmende) {
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    for (const discordId of teilnehmende) {
      expect(await xpOf(discordId)).toBe(4500);
    }

    const cancelled = await R.cancelRaffle(ADMIN, created.id, 'Preis nicht verfügbar');
    expect(cancelled.refundedEntries).toBe(3);
    expect(cancelled.refundedXp).toBe(1500);
    for (const discordId of teilnehmende) {
      expect(await xpOf(discordId)).toBe(5000);
    }

    // Ein zweiter Anlauf - etwa nach einem Neustart mitten im Abbruch - darf
    // nicht noch einmal auszahlen.
    await expect(R.cancelRaffle(ADMIN, created.id, 'nochmal')).rejects.toThrow(/bereits abgebrochen/u);
    for (const discordId of teilnehmende) {
      expect(await xpOf(discordId)).toBe(5000);
    }
    expect(await prisma.xpRaffleRefund.count()).toBe(3);
  });

  it('entfernt eine Teilnahme mit Rückzahlung, ohne sie zu löschen', async () => {
    await giveXp('900000000000000601', 5000);
    const created = await openRaffle();
    const entered = await R.enterRaffle({ discordId: '900000000000000601' }, created.id);

    const removed = await R.removeEntry(ADMIN, entered.entry.id, 'Mehrfachkonto');
    expect(removed.refunded).toBe(500);
    expect(await xpOf('900000000000000601')).toBe(5000);

    const entry = await prisma.xpRaffleEntry.findUniqueOrThrow({ where: { id: entered.entry.id } });
    expect(entry.status).toBe('DISQUALIFIED');
    expect(entry.removalReason).toBe('Mehrfachkonto');

    const refreshed = await prisma.xpRaffle.findUniqueOrThrow({ where: { id: created.id } });
    expect(refreshed.entryCount).toBe(0);
    expect(refreshed.potXp).toBe(0);
  });

  it('zieht erst, wenn die Mindestzahl erreicht ist', async () => {
    await giveXp('900000000000000701', 5000);
    const created = await openRaffle({ minimumParticipants: 3 });
    await R.enterRaffle({ discordId: '900000000000000701' }, created.id);
    await R.closeEntries(ADMIN, created.id);

    await expect(R.startDraw(ADMIN, created.id)).rejects.toThrow(/fehlen Teilnehmende/u);
    // Die Verlosung darf dabei nicht in der Ziehung hängen bleiben.
    const after = await prisma.xpRaffle.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe('ENTRY_CLOSED');
  });

  it('zieht ohne Teilnehmende gar nicht', async () => {
    const created = await openRaffle({ minimumParticipants: 1 });
    await R.closeEntries(ADMIN, created.id);
    await expect(R.startDraw(ADMIN, created.id)).rejects.toThrow(/niemand teilgenommen/u);
  });

  it('bestimmt den Gewinner serverseitig und hält den Auszug fest', async () => {
    const created = await openRaffle();
    for (let index = 0; index < 4; index += 1) {
      const discordId = `90000000000000080${index}`;
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);

    // Vorgegebene Zufallsquelle: Punkt 2 auf der Achse trifft die dritte
    // Teilnahme, weil beim Festbetrag jede genau 1 wiegt.
    const { draw, raffle: updated } = await R.startDraw(ADMIN, created.id, {
      random: { integer: () => 2, hex: (bytes: number) => 'b'.repeat(bytes * 2) },
    });

    expect(updated.status).toBe('WINNER_PENDING');
    expect(draw.version).toBe(1);
    expect(draw.participantCount).toBe(4);
    expect(draw.totalWeight).toBe(4);
    expect(draw.drawnTicket).toBe(2);
    expect(draw.winnerDiscordId).toBe('900000000000000802');

    // Der Auszug hält fest, worauf die Ziehung beruhte.
    const snapshot = R.snapshotTickets(draw);
    expect(snapshot).toHaveLength(4);
    expect(snapshot.every((ticket) => ticket.weight === 1)).toBe(true);
  });

  it('nimmt während der Ziehung niemanden mehr auf', async () => {
    const created = await openRaffle();
    for (const discordId of ['900000000000000901', '900000000000000902']) {
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);
    await R.startDraw(ADMIN, created.id);

    await giveXp('900000000000000903', 5000);
    await expect(R.enterRaffle({ discordId: '900000000000000903' }, created.id)).rejects.toThrow(
      /Ziehig lauft/u,
    );
  });

  it('zieht nicht zweimal gleichzeitig', async () => {
    const created = await openRaffle();
    for (const discordId of ['900000000000001001', '900000000000001002']) {
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);

    const results = await Promise.allSettled([
      R.startDraw(ADMIN, created.id),
      R.startDraw(ADMIN, created.id),
    ]);
    const erfolgreich = results.filter((result) => result.status === 'fulfilled');
    expect(erfolgreich).toHaveLength(1);
    expect(await prisma.xpRaffleDraw.count()).toBe(1);
  });

  it('zieht nur unter den gültigen Teilnahmen', async () => {
    const created = await openRaffle();
    const ids = ['900000000000001101', '900000000000001102', '900000000000001103'];
    const entries = [];
    for (const discordId of ids) {
      await giveXp(discordId, 5000);
      entries.push((await R.enterRaffle({ discordId }, created.id)).entry);
    }
    // Eine Teilnahme wird entfernt - sie darf nicht mehr antreten.
    await R.removeEntry(ADMIN, entries[0]!.id, 'Regelverstoss');
    await R.closeEntries(ADMIN, created.id);

    const { draw } = await R.startDraw(ADMIN, created.id);
    expect(draw.participantCount).toBe(2);
    expect(R.snapshotTickets(draw).map((ticket) => ticket.discordId)).not.toContain(ids[0]);
  });

  it('zieht mit Pflichtgrund neu und schliesst den bisherigen Gewinner aus', async () => {
    const created = await openRaffle();
    for (let index = 0; index < 3; index += 1) {
      const discordId = `90000000000000120${index}`;
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);

    const first = await R.startDraw(ADMIN, created.id, {
      random: { integer: () => 0, hex: (bytes: number) => 'c'.repeat(bytes * 2) },
    });
    expect(first.draw.winnerDiscordId).toBe('900000000000001200');

    const second = await R.redraw(
      ADMIN,
      created.id,
      { reason: 'Gewinner ist nicht mehr auf dem Server', excludePreviousWinner: true },
      { random: { integer: () => 0, hex: (bytes: number) => 'd'.repeat(bytes * 2) } },
    );

    expect(second.draw.version).toBe(2);
    expect(second.draw.redrawReason).toBe('Gewinner ist nicht mehr auf dem Server');
    expect(second.draw.participantCount).toBe(2);
    expect(second.draw.winnerDiscordId).not.toBe(first.draw.winnerDiscordId);

    // Die erste Ziehung bleibt sichtbar - sie wird nicht überschrieben.
    const alle = await R.allDraws(created.id);
    expect(alle).toHaveLength(2);
    expect(alle[0]!.winnerDiscordId).toBe('900000000000001200');
  });

  it('bestätigt den Gewinner und schliesst die Verlosung ab', async () => {
    const created = await openRaffle();
    for (const discordId of ['900000000000001301', '900000000000001302']) {
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);
    const { draw } = await R.startDraw(ADMIN, created.id);

    const confirmed = await R.confirmWinner(ADMIN, created.id);
    expect(confirmed.raffle.status).toBe('COMPLETED');
    expect(confirmed.raffle.confirmedDrawId).toBe(draw.id);

    const winner = await prisma.xpRaffleEntry.findUniqueOrThrow({ where: { id: draw.winnerEntryId } });
    expect(winner.status).toBe('WINNER');

    // Ein zweiter Anlauf ändert nichts mehr.
    await expect(R.confirmWinner(ADMIN, created.id)).rejects.toThrow(/bereits abgeschlossen/u);
  });

  it('schreibt einen XP-Gewinn über dieselbe Engine gut', async () => {
    const created = await openRaffle({ prizeKind: 'XP_PRIZE', prizeXp: 10_000 });
    for (const discordId of ['900000000000001401', '900000000000001402']) {
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);
    const { draw } = await R.startDraw(ADMIN, created.id);

    const confirmed = await R.confirmWinner(ADMIN, created.id);
    expect(confirmed.prizeXpAwarded).toBe(10_000);
    expect(await xpOf(draw.winnerDiscordId)).toBe(4500 + 10_000);

    const ledger = await prisma.xpTransaction.findFirst({
      where: { discordId: draw.winnerDiscordId, source: 'RAFFLE_PRIZE' },
    });
    expect(ledger!.delta).toBe(10_000);
  });

  it('sperrt Einsatzmodell und Beträge, sobald jemand bezahlt hat', async () => {
    await giveXp('900000000000001501', 5000);
    const created = await openRaffle();
    await R.enterRaffle({ discordId: '900000000000001501' }, created.id);

    await expect(R.updateRaffle(ADMIN, created.id, draftInput({ fixedEntryXp: 100 }))).rejects.toThrow(
      /nicht mehr ändern/u,
    );

    // Beschreibung und Banner bleiben änderbar.
    const updated = await R.updateRaffle(ADMIN, created.id, draftInput({ description: 'Neue Beschreibung' }));
    expect(updated.description).toBe('Neue Beschreibung');
    expect(updated.fixedEntryXp).toBe(500);
  });

  it('übersteht einen Neustart, weil alles in der Datenbank steht', async () => {
    await giveXp('900000000000001601', 5000);
    await giveXp('900000000000001602', 5000);
    const created = await openRaffle();
    await R.enterRaffle({ discordId: '900000000000001601' }, created.id);

    // Ein Neustart hält nichts im Arbeitsspeicher fest - der Zustand kommt
    // ausschliesslich aus der Datenbank.
    const wiedergelesen = await R.getRaffle(created.id);
    expect(wiedergelesen!.status).toBe('ENTRY_OPEN');
    await R.enterRaffle({ discordId: '900000000000001602' }, created.id);

    await R.closeEntries(ADMIN, created.id);
    const nachSchluss = await R.getRaffle(created.id);
    expect(nachSchluss!.status).toBe('ENTRY_CLOSED');
    const { draw } = await R.startDraw(ADMIN, created.id);
    expect(draw.participantCount).toBe(2);
  });
});
