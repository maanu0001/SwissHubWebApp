import { prisma } from '@swisshub/database';
import type { XpRaffle, XpRaffleDraw, XpRaffleEntry, XpRaffleStatus } from '@swisshub/database';
import { winChance } from './entry-cost';
import { latestDraw } from './draw';
import { LIVE_STATUSES } from './service';

/**
 * Leseabfragen für Verlosungen.
 *
 * Die Gewinnchance wird ausschliesslich hier berechnet - der Browser bekommt
 * die fertige Zahl und rechnet nichts nach.
 */

export interface RaffleParticipant {
  entryId: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  xpBeforeEntry: number;
  entryXp: number;
  weight: number;
  status: XpRaffleEntry['status'];
  chance: number;
  createdAt: Date;
}

export interface RaffleDetail {
  raffle: XpRaffle;
  participants: RaffleParticipant[];
  totalWeight: number;
  activeCount: number;
  potXp: number;
  draw: XpRaffleDraw | null;
  winner: RaffleParticipant | null;
}

const toParticipant = (entry: XpRaffleEntry, totalWeight: number): RaffleParticipant => ({
  entryId: entry.id,
  discordId: entry.discordId,
  username: entry.username,
  displayName: entry.displayName,
  xpBeforeEntry: entry.xpBeforeEntry,
  entryXp: entry.entryXp,
  weight: entry.weight,
  status: entry.status,
  chance: entry.status === 'ACTIVE' || entry.status === 'WINNER' ? winChance(entry.weight, totalWeight) : 0,
  createdAt: entry.createdAt,
});

/** Vollständiger Stand einer Verlosung inklusive Teilnehmerliste. */
export async function getRaffleDetail(raffleId: string): Promise<RaffleDetail | null> {
  const raffle = await prisma.xpRaffle.findUnique({ where: { id: raffleId } });
  if (!raffle) {
    return null;
  }

  const entries = await prisma.xpRaffleEntry.findMany({
    where: { raffleId },
    orderBy: { createdAt: 'asc' },
  });

  const counted = entries.filter((entry) => entry.status === 'ACTIVE' || entry.status === 'WINNER');
  const totalWeight = counted.reduce((sum, entry) => sum + entry.weight, 0);
  const potXp = counted.reduce((sum, entry) => sum + entry.entryXp, 0);

  const draw = await latestDraw(raffleId);
  const participants = entries.map((entry) => toParticipant(entry, totalWeight));
  const winner =
    draw === null ? null : (participants.find((entry) => entry.entryId === draw.winnerEntryId) ?? null);

  return {
    raffle,
    participants,
    totalWeight,
    activeCount: counted.length,
    potXp,
    draw,
    winner,
  };
}

/** Teilnehmerliste, sortiert nach Einsatz - die grössten Anteile zuerst. */
export async function getParticipants(
  raffleId: string,
  options: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: RaffleParticipant[]; total: number; totalWeight: number }> {
  const search = options.search?.trim();
  const where = {
    raffleId,
    ...(search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { discordId: { contains: search } },
          ],
        }
      : {}),
  };

  const totals = await prisma.xpRaffleEntry.aggregate({
    where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
    _sum: { weight: true },
  });
  const totalWeight = totals._sum.weight ?? 0;

  const [rows, total] = await Promise.all([
    prisma.xpRaffleEntry.findMany({
      where,
      orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    }),
    prisma.xpRaffleEntry.count({ where }),
  ]);

  return { rows: rows.map((entry) => toParticipant(entry, totalWeight)), total, totalWeight };
}

export interface RaffleSummary {
  id: string;
  title: string;
  status: XpRaffleStatus;
  entryModel: XpRaffle['entryModel'];
  prizeDescription: string;
  entryCount: number;
  potXp: number;
  entryEndsAt: Date | null;
  drawScheduledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  winnerDiscordId: string | null;
  winnerDisplayName: string | null;
}

/** Verlosungen für Listen - ohne Teilnehmerdaten. */
export async function listRaffles(
  options: { statuses?: XpRaffleStatus[]; limit?: number; offset?: number } = {},
): Promise<{ rows: RaffleSummary[]; total: number }> {
  const where = options.statuses?.length ? { status: { in: options.statuses } } : {};

  const [raffles, total] = await Promise.all([
    prisma.xpRaffle.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: options.limit ?? 25,
      skip: options.offset ?? 0,
      include: {
        confirmedDraw: {
          select: { winnerDiscordId: true, winnerEntry: { select: { displayName: true, username: true } } },
        },
      },
    }),
    prisma.xpRaffle.count({ where }),
  ]);

  return {
    rows: raffles.map((raffle) => ({
      id: raffle.id,
      title: raffle.title,
      status: raffle.status,
      entryModel: raffle.entryModel,
      prizeDescription: raffle.prizeDescription,
      entryCount: raffle.entryCount,
      potXp: raffle.potXp,
      entryEndsAt: raffle.entryEndsAt,
      drawScheduledAt: raffle.drawScheduledAt,
      completedAt: raffle.completedAt,
      createdAt: raffle.createdAt,
      winnerDiscordId: raffle.confirmedDraw?.winnerDiscordId ?? null,
      winnerDisplayName:
        raffle.confirmedDraw?.winnerEntry.displayName ?? raffle.confirmedDraw?.winnerEntry.username ?? null,
    })),
    total,
  };
}

export interface MyEntry {
  raffleId: string;
  title: string;
  status: XpRaffleStatus;
  entryXp: number;
  entryStatus: XpRaffleEntry['status'];
  won: boolean;
  createdAt: Date;
  prizeDescription: string;
}

/** Die eigenen Teilnahmen - für den Bereich "Meine Teilnahmen". */
export async function getMyEntries(discordId: string, limit = 20): Promise<MyEntry[]> {
  const entries = await prisma.xpRaffleEntry.findMany({
    where: { discordId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { raffle: { select: { id: true, title: true, status: true, prizeDescription: true } } },
  });

  return entries.map((entry) => ({
    raffleId: entry.raffle.id,
    title: entry.raffle.title,
    status: entry.raffle.status,
    entryXp: entry.entryXp,
    entryStatus: entry.status,
    won: entry.status === 'WINNER' && entry.raffle.status === 'COMPLETED',
    createdAt: entry.createdAt,
    prizeDescription: entry.raffle.prizeDescription,
  }));
}

export interface RaffleOverview {
  active: RaffleSummary | null;
  liveCount: number;
  totalRaffles: number;
  completedCount: number;
  nextDrawAt: Date | null;
}

/** Kennzahlen für die Übersichtskarten im Dashboard. */
export async function getRaffleOverview(): Promise<RaffleOverview> {
  const [live, totalRaffles, completedCount, next] = await Promise.all([
    listRaffles({ statuses: [...LIVE_STATUSES], limit: 1 }),
    prisma.xpRaffle.count(),
    prisma.xpRaffle.count({ where: { status: 'COMPLETED' } }),
    prisma.xpRaffle.findFirst({
      where: { status: { in: ['SCHEDULED', 'ENTRY_OPEN', 'ENTRY_CLOSED'] }, drawScheduledAt: { not: null } },
      orderBy: { drawScheduledAt: 'asc' },
      select: { drawScheduledAt: true },
    }),
  ]);

  return {
    active: live.rows[0] ?? null,
    liveCount: live.total,
    totalRaffles,
    completedCount,
    nextDrawAt: next?.drawScheduledAt ?? null,
  };
}

export interface RaffleStats {
  totalRaffles: number;
  completedRaffles: number;
  totalEntries: number;
  uniqueParticipants: number;
  totalEntryXp: number;
  averageEntryXp: number;
  fixedRaffles: number;
  percentageRaffles: number;
  refundedXp: number;
}

/**
 * Auswertung für die Statistikseite.
 *
 * Ausgewertet wird nur, was seit der Einführung tatsächlich stattgefunden hat.
 * Es werden keine Zahlen für frühere Zeiträume geschätzt.
 */
export async function getRaffleStats(): Promise<RaffleStats> {
  const [totalRaffles, completedRaffles, byModel, entries, unique, refunds] = await Promise.all([
    prisma.xpRaffle.count(),
    prisma.xpRaffle.count({ where: { status: 'COMPLETED' } }),
    prisma.xpRaffle.groupBy({ by: ['entryModel'], _count: { _all: true } }),
    prisma.xpRaffleEntry.aggregate({ _count: { _all: true }, _sum: { entryXp: true } }),
    prisma.xpRaffleEntry.findMany({ distinct: ['discordId'], select: { discordId: true } }),
    prisma.xpRaffleRefund.aggregate({ _sum: { amount: true } }),
  ]);

  const totalEntries = entries._count._all;
  const totalEntryXp = entries._sum.entryXp ?? 0;

  return {
    totalRaffles,
    completedRaffles,
    totalEntries,
    uniqueParticipants: unique.length,
    totalEntryXp,
    averageEntryXp: totalEntries === 0 ? 0 : Math.round(totalEntryXp / totalEntries),
    fixedRaffles: byModel.find((row) => row.entryModel === 'FIXED')?._count._all ?? 0,
    percentageRaffles: byModel.find((row) => row.entryModel === 'PERCENTAGE')?._count._all ?? 0,
    refundedXp: refunds._sum.amount ?? 0,
  };
}

/** Vergangene Verlosungen für die öffentliche Seite. */
export async function getPastRaffles(limit = 10): Promise<RaffleSummary[]> {
  const { rows } = await listRaffles({ statuses: ['COMPLETED', 'CANCELLED'], limit });
  return rows;
}

/**
 * Laeuft gerade eine Verlosung?
 *
 * «Laufend» heisst: Mitglieder koennen etwas damit anfangen - die Teilnahme
 * ist offen, sie steht unmittelbar bevor, oder die Ziehung ist im Gang.
 * Entwuerfe und abgeschlossene Verlosungen zaehlen nicht; ein Entwurf ist
 * noch nichts, und eine abgeschlossene ist Geschichte.
 *
 * Gedacht fuer die Navigation: der Eintrag «XP-Gluecksrad» erscheint neben
 * «Mein Profil» nur, solange es dort etwas zu tun gibt. Im Level-System
 * bleibt das Gluecksrad dauerhaft erreichbar - dort wird es verwaltet.
 */
export async function hatLaufendeVerlosung(): Promise<boolean> {
  const anzahl = await prisma.xpRaffle.count({
    where: { status: { in: ['SCHEDULED', 'ENTRY_OPEN', 'ENTRY_CLOSED', 'DRAWING', 'WINNER_PENDING'] } },
  });
  return anzahl > 0;
}
