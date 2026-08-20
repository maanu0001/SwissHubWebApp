import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import type { SpielersucheSource, SpielersucheVoiceSession } from '@swisshub/database';

const log = createLogger('spielersuche:stats');

/**
 * Statistik der Spielersuche.
 *
 * Der alte Bot zählte die Nutzung des Befehls und die Zeit in den von ihm
 * erstellten Sprachkanälen. Beides bleibt erhalten - erweitert um die Quelle,
 * damit sichtbar wird, ob eine Suche über Discord oder das Dashboard entstand.
 */

/** Hält fest, dass jemand eine Suche gestartet hat. */
export async function recordUsage(
  discordId: string,
  source: SpielersucheSource = 'SLASH_COMMAND',
): Promise<void> {
  await prisma.spielersucheUsage.create({
    data: { discordId, command: 'spielersuche', source },
  });
}

/**
 * Beginnt eine Voice-Session.
 *
 * Läuft für dieselbe Person im selben Kanal bereits eine offene Session, wird
 * keine zweite angelegt - sonst würden doppelte Ereignisse die Zeit verdoppeln.
 */
export async function startVoiceSession(input: {
  discordId: string;
  matchId: string | null;
  voiceChannelId: string;
  joinedAt?: Date;
}): Promise<SpielersucheVoiceSession | null> {
  const open = await prisma.spielersucheVoiceSession.findFirst({
    where: { discordId: input.discordId, voiceChannelId: input.voiceChannelId, leftAt: null },
  });
  if (open) {
    return open;
  }

  return prisma.spielersucheVoiceSession.create({
    data: {
      discordId: input.discordId,
      matchId: input.matchId,
      voiceChannelId: input.voiceChannelId,
      joinedAt: input.joinedAt ?? new Date(),
    },
  });
}

/** Obergrenze einer einzelnen Session: 12 Stunden. */
const MAX_SESSION_SECONDS = 12 * 60 * 60;

/**
 * Beendet eine Voice-Session und schreibt die Dauer fest.
 *
 * Die Obergrenze fängt den Fall ab, dass der Bot beim Verlassen offline war
 * und die Session tagelang offen blieb. Ohne sie entstünden Ranglisten mit
 * dreistelligen Stundenwerten aus einem einzigen Ausfall.
 */
export async function endVoiceSession(input: {
  discordId: string;
  voiceChannelId: string;
  leftAt?: Date;
}): Promise<SpielersucheVoiceSession | null> {
  const open = await prisma.spielersucheVoiceSession.findFirst({
    where: { discordId: input.discordId, voiceChannelId: input.voiceChannelId, leftAt: null },
    orderBy: { joinedAt: 'desc' },
  });
  if (!open) {
    return null;
  }

  const leftAt = input.leftAt ?? new Date();
  const raw = Math.max(0, Math.round((leftAt.getTime() - open.joinedAt.getTime()) / 1000));
  const durationSeconds = Math.min(raw, MAX_SESSION_SECONDS);

  if (raw > MAX_SESSION_SECONDS) {
    log.warn('Voice-Session überschreitet die Obergrenze und wird gekürzt', {
      sessionId: open.id,
      rawSeconds: raw,
    });
  }

  return prisma.spielersucheVoiceSession.update({
    where: { id: open.id },
    data: { leftAt, durationSeconds },
  });
}

/**
 * Schliesst Sessions, die beim Neustart offen geblieben sind.
 *
 * Ohne diese Bereinigung würde eine solche Session beim nächsten Beitritt als
 * "läuft noch" gelten und die Zeit weiterzählen, obwohl niemand im Kanal war.
 */
export async function recoverStaleVoiceSessions(
  activeChannelIds: ReadonlySet<string> = new Set(),
): Promise<number> {
  const open = await prisma.spielersucheVoiceSession.findMany({ where: { leftAt: null } });
  let closed = 0;

  for (const session of open) {
    if (activeChannelIds.has(`${session.voiceChannelId}:${session.discordId}`)) {
      continue;
    }
    const raw = Math.max(0, Math.round((Date.now() - session.joinedAt.getTime()) / 1000));
    await prisma.spielersucheVoiceSession.update({
      where: { id: session.id },
      data: { leftAt: new Date(), durationSeconds: Math.min(raw, MAX_SESSION_SECONDS) },
    });
    closed += 1;
  }

  if (closed > 0) {
    log.info('Offene Voice-Sessions nach Neustart geschlossen', { closed });
  }
  return closed;
}

export interface UserStats {
  discordId: string;
  createdSearches: number;
  joinedSearches: number;
  usageCount: number;
  voiceSeconds: number;
  voiceSessions: number;
}

const EMPTY_STATS = (discordId: string): UserStats => ({
  discordId,
  createdSearches: 0,
  joinedSearches: 0,
  usageCount: 0,
  voiceSeconds: 0,
  voiceSessions: 0,
});

/** Statistik einer Person; `since` grenzt auf einen Zeitraum ein. */
export async function getUserStats(discordId: string, since?: Date): Promise<UserStats> {
  const [created, joined, usage, voice] = await Promise.all([
    prisma.spielersucheMatch.count({
      where: { creatorDiscordId: discordId, ...(since ? { createdAt: { gte: since } } : {}) },
    }),
    prisma.spielersucheParticipant.count({
      where: { discordId, isCreator: false, ...(since ? { joinedAt: { gte: since } } : {}) },
    }),
    prisma.spielersucheUsage.count({
      where: { discordId, ...(since ? { usedAt: { gte: since } } : {}) },
    }),
    prisma.spielersucheVoiceSession.aggregate({
      where: { discordId, leftAt: { not: null }, ...(since ? { joinedAt: { gte: since } } : {}) },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
  ]);

  return {
    ...EMPTY_STATS(discordId),
    createdSearches: created,
    joinedSearches: joined,
    usageCount: usage,
    voiceSeconds: voice._sum.durationSeconds ?? 0,
    voiceSessions: voice._count._all,
  };
}

export interface LeaderboardEntry {
  discordId: string;
  username: string | null;
  avatarHash: string | null;
  usageCount: number;
  voiceSeconds: number;
}

/**
 * Rangliste.
 *
 * Sortiert wird wie im alten Bot: zuerst nach der Zahl der gestarteten
 * Suchen, bei Gleichstand nach Voice-Zeit.
 */
export async function getLeaderboard(
  options: { since?: Date; limit?: number } = {},
): Promise<LeaderboardEntry[]> {
  const since = options.since;
  const limit = options.limit ?? 5;

  const [usage, voice] = await Promise.all([
    prisma.spielersucheUsage.groupBy({
      by: ['discordId'],
      where: since ? { usedAt: { gte: since } } : {},
      _count: { _all: true },
    }),
    prisma.spielersucheVoiceSession.groupBy({
      by: ['discordId'],
      where: { leftAt: { not: null }, ...(since ? { joinedAt: { gte: since } } : {}) },
      _sum: { durationSeconds: true },
    }),
  ]);

  const merged = new Map<string, LeaderboardEntry>();
  const ensure = (discordId: string): LeaderboardEntry => {
    const existing = merged.get(discordId);
    if (existing) {
      return existing;
    }
    const created: LeaderboardEntry = {
      discordId,
      username: null,
      avatarHash: null,
      usageCount: 0,
      voiceSeconds: 0,
    };
    merged.set(discordId, created);
    return created;
  };

  for (const row of usage) {
    ensure(row.discordId).usageCount = row._count._all;
  }
  for (const row of voice) {
    ensure(row.discordId).voiceSeconds = row._sum.durationSeconds ?? 0;
  }

  const ranked = [...merged.values()]
    .sort((a, b) => b.usageCount - a.usageCount || b.voiceSeconds - a.voiceSeconds)
    .slice(0, limit);

  // Namen und Avatare aus den Teilnahmen ergänzen - dafür braucht es keinen
  // Discord-Aufruf.
  const known = await prisma.spielersucheParticipant.findMany({
    where: { discordId: { in: ranked.map((entry) => entry.discordId) } },
    orderBy: { joinedAt: 'desc' },
    distinct: ['discordId'],
    select: { discordId: true, username: true, displayName: true, avatarHash: true },
  });

  for (const entry of ranked) {
    const match = known.find((row) => row.discordId === entry.discordId);
    entry.username = match?.displayName ?? match?.username ?? null;
    entry.avatarHash = match?.avatarHash ?? null;
  }

  return ranked;
}

export interface SpielersucheOverview {
  activeSearches: number;
  openSearches: number;
  completeSearches: number;
  searchesToday: number;
  searchesLast7Days: number;
  searchesLast30Days: number;
  totalSearches: number;
  activeParticipants: number;
  activeVoiceChannels: number;
  configuredGames: number;
  voiceSecondsLast30Days: number;
  averageGroupSize: number;
  completionRate: number;
}

/** Kennzahlen für Übersicht und Modulkachel. */
export async function getOverview(): Promise<SpielersucheOverview> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    open,
    complete,
    today,
    week,
    month,
    total,
    closedOrDone,
    participants,
    voiceChannels,
    games,
    voice,
    groupSizes,
  ] = await Promise.all([
    prisma.spielersucheMatch.count({ where: { status: 'OPEN' } }),
    prisma.spielersucheMatch.count({ where: { status: 'COMPLETE' } }),
    prisma.spielersucheMatch.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.spielersucheMatch.count({ where: { createdAt: { gte: last7 } } }),
    prisma.spielersucheMatch.count({ where: { createdAt: { gte: last30 } } }),
    prisma.spielersucheMatch.count(),
    prisma.spielersucheMatch.count({ where: { status: { in: ['CLOSED', 'EXPIRED', 'COMPLETE'] } } }),
    prisma.spielersucheParticipant.count({
      where: { leftAt: null, match: { status: { in: ['OPEN', 'COMPLETE'] } } },
    }),
    prisma.spielersucheMatch.count({
      where: { voiceChannelId: { not: null }, status: { in: ['OPEN', 'COMPLETE'] } },
    }),
    prisma.spielersucheGame.count({ where: { enabled: true } }),
    prisma.spielersucheVoiceSession.aggregate({
      where: { leftAt: { not: null }, joinedAt: { gte: last30 } },
      _sum: { durationSeconds: true },
    }),
    prisma.spielersucheMatch.findMany({
      select: { _count: { select: { participants: true } } },
      take: 500,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // "Vollständig geworden" zählt jede Suche, die den Status COMPLETE erreicht
  // hat - auch wenn sie danach geschlossen wurde.
  const completed = await prisma.spielersucheMatch.count({
    where: { OR: [{ status: 'COMPLETE' }, { closeReason: 'COMPLETE' }] },
  });

  const sizes = groupSizes.map((row) => row._count.participants);
  const averageGroupSize = sizes.length > 0 ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length : 0;

  return {
    activeSearches: open + complete,
    openSearches: open,
    completeSearches: complete,
    searchesToday: today,
    searchesLast7Days: week,
    searchesLast30Days: month,
    totalSearches: total,
    activeParticipants: participants,
    activeVoiceChannels: voiceChannels,
    configuredGames: games,
    voiceSecondsLast30Days: voice._sum.durationSeconds ?? 0,
    averageGroupSize: Math.round(averageGroupSize * 10) / 10,
    completionRate: closedOrDone > 0 ? Math.round((completed / closedOrDone) * 100) : 0,
  };
}

/** "3 Std. 12 Min." - dieselbe Darstellung wie im alten Bot. */
export function formatVoiceDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) {
    return `${seconds} Sek.`;
  }
  return hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
}
