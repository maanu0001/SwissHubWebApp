import { AUDIT_ACTIONS, Prisma, prisma, safeRecordAudit } from '@swisshub/database';
import type { XpRaffle, XpRaffleEntry } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, forbidden, formatSwissNumber, notFound } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';
import { applyXpWithin, type LevelIdentity, type XpEngineOptions } from '../service';
import { calculateEntryCost, winChance, type EntryCost } from './entry-cost';
import { assertEntryOpen, entryCostRules, lockRaffle, refreshCounters, requireRaffle } from './service';
import type { RaffleActor } from './schemas';

const logger = createLogger('level.raffle.entries');

/**
 * Teilnahmen an einer Verlosung.
 *
 * Genau eine Stelle bucht XP ab und legt eine Teilnahme an - die Webseite und
 * der Knopf auf Discord rufen beide `enterRaffle` auf. Damit gilt für beide
 * Wege derselbe Preis, dasselbe Gewicht und dieselbe Gewinnchance.
 */

export interface EntryPreview {
  raffleId: string;
  currentXp: number;
  cost: EntryCost;
  /** XP-Stand nach einer Teilnahme. */
  xpAfter: number;
  affordable: boolean;
  /** Bereits vorhandene Teilnahme, falls die Person schon mitmacht. */
  existingEntry: XpRaffleEntry | null;
  /** Geschätzte Chance, wenn die Person jetzt beitreten würde. */
  estimatedChance: number;
  totalWeight: number;
  entryCount: number;
}

/**
 * Was eine Teilnahme diese Person kosten würde.
 *
 * Reine Anzeige - die Zahlen werden bei der Bestätigung erneut berechnet,
 * weil sich der XP-Stand bis dahin geändert haben kann.
 */
export async function previewEntry(discordId: string, raffleId: string): Promise<EntryPreview> {
  const raffle = await requireRaffle(raffleId);
  const [profile, existingEntry, totals] = await Promise.all([
    prisma.levelProfile.findUnique({ where: { discordId }, select: { xp: true } }),
    prisma.xpRaffleEntry.findUnique({ where: { raffleId_discordId: { raffleId, discordId } } }),
    prisma.xpRaffleEntry.aggregate({
      where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
      _sum: { weight: true },
      _count: { _all: true },
    }),
  ]);

  const currentXp = profile?.xp ?? 0;
  const cost = calculateEntryCost(entryCostRules(raffle), currentXp);
  const totalWeight = totals._sum.weight ?? 0;

  // Wer schon dabei ist, sieht seine tatsächliche Chance; alle anderen die
  // Chance, die sie nach einem Beitritt hätten.
  const estimatedChance = existingEntry
    ? winChance(existingEntry.weight, totalWeight)
    : winChance(cost.weight, totalWeight + cost.weight);

  return {
    raffleId,
    currentXp,
    cost,
    xpAfter: Math.max(0, currentXp - cost.entryXp),
    affordable: currentXp >= cost.entryXp,
    existingEntry,
    estimatedChance,
    totalWeight,
    entryCount: totals._count._all,
  };
}

export interface EnterRaffleResult {
  entry: XpRaffleEntry;
  raffle: XpRaffle;
  /** Die Teilnahme bestand bereits - es wurde nichts abgebucht. */
  alreadyEntered: boolean;
  xpBefore: number;
  xpAfter: number;
  chance: number;
  entryCount: number;
  potXp: number;
}

/**
 * Nimmt an einer Verlosung teil.
 *
 * Abbuchung, Teilnahme und Journalzeile entstehen in einer einzigen
 * Transaktion. Es gibt deshalb keinen Zustand, in dem XP fehlen, ohne dass
 * eine Teilnahme existiert - oder umgekehrt.
 *
 * Gegen doppelte Teilnahme wirken zwei Dinge zusammen: die Zeilensperre auf
 * dem Profil (die zweite Anfrage wartet) und der eindeutige Schlüssel aus
 * Verlosung und Person (die zweite Anfrage scheitert daran). Ein Doppelklick
 * kann damit nicht zweimal abbuchen.
 */
export async function enterRaffle(
  identity: LevelIdentity,
  raffleId: string,
  options: XpEngineOptions & { now?: Date } = {},
): Promise<EnterRaffleResult> {
  const now = options.now ?? new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      // Innerhalb der Transaktion frisch und gesperrt lesen: die Vorschau kann
      // veraltet sein, und eine Teilnahme darf nicht mehr durchgehen, waehrend
      // nebenan bereits der Auszug fuer die Ziehung entsteht.
      const raffle = await lockRaffle(tx, raffleId);

      const describeExisting = async (entry: XpRaffleEntry): Promise<EnterRaffleResult> => {
        const totals = await tx.xpRaffleEntry.aggregate({
          where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
          _sum: { weight: true, entryXp: true },
          _count: { _all: true },
        });
        return {
          entry,
          raffle,
          alreadyEntered: true,
          xpBefore: entry.xpBeforeEntry,
          xpAfter: entry.xpBeforeEntry - entry.entryXp,
          chance: winChance(entry.weight, totals._sum.weight ?? 0),
          entryCount: totals._count._all,
          potXp: totals._sum.entryXp ?? 0,
        } satisfies EnterRaffleResult;
      };

      // Schneller Weg: wer offensichtlich schon dabei ist, braucht gar keine
      // Sperre. Der zweite Klick auf denselben Knopf ist kein Fehler.
      const known = await tx.xpRaffleEntry.findUnique({
        where: { raffleId_discordId: { raffleId, discordId: identity.discordId } },
      });
      if (known) {
        return describeExisting(known);
      }

      assertEntryOpen(raffle, now);

      // Der Stand wird gesperrt gelesen, damit zwischen Berechnung und
      // Abbuchung nichts dazwischenkommt.
      await tx.levelProfile.upsert({
        where: { discordId: identity.discordId },
        create: { discordId: identity.discordId },
        update: {},
      });
      await tx.$queryRaw`SELECT "id" FROM "LevelProfile" WHERE "discordId" = ${identity.discordId} FOR UPDATE`;

      // Zweite Prüfung, jetzt hinter der Sperre: zwei gleichzeitige Anfragen
      // reihen sich hier auf, und die zweite sieht die inzwischen angelegte
      // Teilnahme der ersten. Ohne diese Prüfung liefe sie in den eindeutigen
      // Schlüssel - abgefangen wäre das zwar auch, aber jeder Doppelklick
      // hinterliesse eine Fehlermeldung im Betriebsprotokoll.
      const raced = await tx.xpRaffleEntry.findUnique({
        where: { raffleId_discordId: { raffleId, discordId: identity.discordId } },
      });
      if (raced) {
        return describeExisting(raced);
      }

      const profile = await tx.levelProfile.findUniqueOrThrow({
        where: { discordId: identity.discordId },
      });

      const cost = calculateEntryCost(entryCostRules(raffle), profile.xp);
      if (profile.xp < cost.entryXp) {
        throw conflict(
          `Du hesch nid gnueg XP. D Teilnahm choscht ${formatSwissNumber(cost.entryXp)} XP, du hesch ${formatSwissNumber(profile.xp)} XP.`,
        );
      }

      // Dieselbe Engine wie überall sonst - nur eben innerhalb dieser
      // Transaktion, damit Abbuchung und Teilnahme zusammen stehen.
      const booking = await applyXpWithin(
        tx,
        {
          ...identity,
          delta: -cost.entryXp,
          source: 'RAFFLE_ENTRY',
          reason: `XP-Glücksrad: ${raffle.title}`,
          idempotencyKey: `raffle-entry:${raffleId}:${identity.discordId}`,
        },
        options,
      );

      const entry = await tx.xpRaffleEntry.create({
        data: {
          raffleId,
          discordId: identity.discordId,
          username: identity.username ?? profile.username,
          displayName: identity.displayName ?? profile.displayName,
          xpBeforeEntry: booking.xpBefore,
          entryXp: cost.entryXp,
          weight: cost.weight,
          status: 'ACTIVE',
        },
      });

      const counters = await refreshCounters(tx, raffleId);
      const totals = await tx.xpRaffleEntry.aggregate({
        where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
        _sum: { weight: true },
      });

      return {
        entry,
        raffle,
        alreadyEntered: false,
        xpBefore: booking.xpBefore,
        xpAfter: booking.xpAfter,
        chance: winChance(entry.weight, totals._sum.weight ?? 0),
        entryCount: counters.entryCount,
        potXp: counters.potXp,
      } satisfies EnterRaffleResult;
    });
  } catch (error) {
    // Zwei gleichzeitige Anfragen: eine gewinnt, die andere läuft in den
    // eindeutigen Schlüssel. Für die Person ist das kein Fehler - sie nimmt
    // ja teil.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.info('Gleichzeitige Teilnahme abgefangen', {
        raffleId,
        discordId: identity.discordId,
      });
      const entry = await prisma.xpRaffleEntry.findUnique({
        where: { raffleId_discordId: { raffleId, discordId: identity.discordId } },
      });
      if (entry) {
        const raffle = await requireRaffle(raffleId);
        const totals = await prisma.xpRaffleEntry.aggregate({
          where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
          _sum: { weight: true, entryXp: true },
          _count: { _all: true },
        });
        return {
          entry,
          raffle,
          alreadyEntered: true,
          xpBefore: entry.xpBeforeEntry,
          xpAfter: entry.xpBeforeEntry - entry.entryXp,
          chance: winChance(entry.weight, totals._sum.weight ?? 0),
          entryCount: totals._count._all,
          potXp: totals._sum.entryXp ?? 0,
        } satisfies EnterRaffleResult;
      }
    }
    throw error;
  }
}

/**
 * Zahlt den Einsatz einer Teilnahme zurück.
 *
 * Die Rückzahlung hängt an einer eigenen Zeile mit eindeutigem Schlüssel auf
 * der Teilnahme. Ein zweiter Aufruf - etwa nach einem Neustart mitten im
 * Abbruch - findet diese Zeile vor und zahlt kein zweites Mal.
 */
export async function refundEntry(
  tx: Prisma.TransactionClient,
  entry: XpRaffleEntry,
  input: {
    reason: 'RAFFLE_CANCELLED' | 'ENTRY_REMOVED' | 'MINIMUM_NOT_REACHED';
    note?: string | null;
    actorDiscordId?: string | null;
    raffleTitle: string;
    status: 'REFUNDED' | 'DISQUALIFIED';
  },
  options: XpEngineOptions = {},
): Promise<{ refunded: number; alreadyRefunded: boolean }> {
  const existing = await tx.xpRaffleRefund.findUnique({ where: { entryId: entry.id } });
  if (existing) {
    return { refunded: existing.amount, alreadyRefunded: true };
  }

  if (entry.entryXp > 0) {
    await applyXpWithin(
      tx,
      {
        discordId: entry.discordId,
        delta: entry.entryXp,
        source: 'RAFFLE_REFUND',
        reason: `XP-Glücksrad zurückgezahlt: ${input.raffleTitle}`,
        actorDiscordId: input.actorDiscordId ?? null,
        idempotencyKey: `raffle-refund:${entry.id}`,
      },
      options,
    );
  }

  await tx.xpRaffleRefund.create({
    data: {
      raffleId: entry.raffleId,
      entryId: entry.id,
      discordId: entry.discordId,
      amount: entry.entryXp,
      reason: input.reason,
      note: input.note ?? null,
      actorDiscordId: input.actorDiscordId ?? null,
    },
  });

  await tx.xpRaffleEntry.update({
    where: { id: entry.id },
    data: { status: input.status, removalReason: input.note ?? null },
  });

  return { refunded: entry.entryXp, alreadyRefunded: false };
}

/**
 * Entfernt eine Teilnahme und zahlt den Einsatz zurück.
 *
 * Die Zeile bleibt bestehen und wechselt nur ihren Zustand - wer einmal
 * bezahlt hat, verschwindet nicht spurlos aus der Historie.
 */
export async function removeEntry(
  actor: RaffleActor,
  entryId: string,
  reason: string,
  options: XpEngineOptions = {},
): Promise<{ refunded: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.xpRaffleEntry.findUnique({
      where: { id: entryId },
      include: { raffle: true },
    });
    if (!entry) {
      throw notFound(`Teilnahme ${entryId} nicht gefunden`, 'Diese Teilnahme gibt es nicht.');
    }
    if (entry.status !== 'ACTIVE') {
      throw conflict('Diese Teilnahme ist bereits zurückgezahlt oder ausgeschlossen.');
    }
    if (entry.raffle.status === 'DRAWING') {
      throw forbidden('Ziehung läuft', 'Während der Ziehung lässt sich die Teilnehmerliste nicht ändern.');
    }

    const refund = await refundEntry(
      tx,
      entry,
      {
        reason: 'ENTRY_REMOVED',
        note: reason,
        actorDiscordId: actor.discordId,
        raffleTitle: entry.raffle.title,
        status: 'DISQUALIFIED',
      },
      options,
    );
    await refreshCounters(tx, entry.raffleId);
    return { refund, entry };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_ENTRY_REMOVED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: result.entry.discordId,
    targetLabel: result.entry.displayName ?? result.entry.username,
    success: true,
    metadata: {
      raffleId: result.entry.raffleId,
      entryId,
      reason,
      refunded: result.refund.refunded,
    },
  });

  return { refunded: result.refund.refunded };
}
