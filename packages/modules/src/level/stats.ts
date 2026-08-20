import { prisma, type XpGameKind, type XpSource } from '@swisshub/database';
import { levelFromXp } from './curve';
import { GAME_KINDS } from './game-rules';

export interface LeaderboardEntry {
  rank: number;
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  xp: number;
  level: number;
  messages: number;
  voiceMinutes: number;
}

/** Rangliste nach XP. Ersetzt `/leaderboard` des alten Bots. */
export async function getLeaderboard(
  options: { limit?: number; offset?: number; maxLevelTotalXp?: number } = {},
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const [profiles, total] = await Promise.all([
    prisma.levelProfile.findMany({
      orderBy: [{ xp: 'desc' }, { createdAt: 'asc' }],
      skip: offset,
      take: limit,
    }),
    prisma.levelProfile.count(),
  ]);

  return {
    total,
    entries: profiles.map((profile, index) => ({
      rank: offset + index + 1,
      discordId: profile.discordId,
      username: profile.username,
      displayName: profile.displayName,
      avatarHash: profile.avatarHash,
      xp: profile.xp,
      level: levelFromXp(profile.xp, options.maxLevelTotalXp),
      messages: profile.messages,
      voiceMinutes: profile.voiceMinutes,
    })),
  };
}

export interface GlobalStats {
  members: number;
  /** Mitglieder mit mindestens 1 XP. */
  active: number;
  totalXp: number;
  totalMessages: number;
  totalVoiceMinutes: number;
  averageXp: number;
  highestLevel: number;
  /** Verteilung über die Level, aufsteigend. */
  levelDistribution: Array<{ level: number; members: number }>;
}

/** Kennzahlen des ganzen Servers. Ersetzt `/global_stats`. */
export async function getGlobalStats(options: { maxLevelTotalXp?: number } = {}): Promise<GlobalStats> {
  const [aggregate, members, active, profiles] = await Promise.all([
    prisma.levelProfile.aggregate({
      _sum: { xp: true, messages: true, voiceMinutes: true },
      _avg: { xp: true },
      _max: { xp: true },
    }),
    prisma.levelProfile.count(),
    prisma.levelProfile.count({ where: { xp: { gt: 0 } } }),
    prisma.levelProfile.findMany({ select: { xp: true } }),
  ]);

  const distribution = new Map<number, number>();
  for (const profile of profiles) {
    const level = levelFromXp(profile.xp, options.maxLevelTotalXp);
    distribution.set(level, (distribution.get(level) ?? 0) + 1);
  }

  return {
    members,
    active,
    totalXp: aggregate._sum.xp ?? 0,
    totalMessages: aggregate._sum.messages ?? 0,
    totalVoiceMinutes: aggregate._sum.voiceMinutes ?? 0,
    averageXp: Math.round(aggregate._avg.xp ?? 0),
    highestLevel: levelFromXp(aggregate._max.xp ?? 0, options.maxLevelTotalXp),
    levelDistribution: [...distribution.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, count]) => ({ level, members: count })),
  };
}

export interface MemberStats {
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  xp: number;
  level: number;
  rank: number;
  messages: number;
  voiceMinutes: number;
  lastActivityAt: Date | null;
  lastMessageAt: Date | null;
  lastVoiceAt: Date | null;
  lastDecayAt: Date | null;
  /** XP-Gewinn und -Verlust je Quelle. */
  bySource: Array<{ source: XpSource; total: number; count: number }>;
  gameStats: Array<{
    kind: XpGameKind;
    wins: number;
    losses: number;
    draws: number;
    xpWon: number;
    xpLost: number;
  }>;
}

/** Werte einer einzelnen Person. Ersetzt `/level_stats` und `/check_user`. */
export async function getMemberStats(
  discordId: string,
  options: { maxLevelTotalXp?: number } = {},
): Promise<MemberStats | null> {
  const profile = await prisma.levelProfile.findUnique({ where: { discordId } });
  if (!profile) {
    return null;
  }

  const [better, grouped, gameStats] = await Promise.all([
    prisma.levelProfile.count({ where: { xp: { gt: profile.xp } } }),
    prisma.xpTransaction.groupBy({
      by: ['source'],
      where: { discordId },
      _sum: { delta: true },
      _count: { _all: true },
    }),
    prisma.levelGameStats.findMany({ where: { discordId } }),
  ]);

  return {
    discordId: profile.discordId,
    username: profile.username,
    displayName: profile.displayName,
    avatarHash: profile.avatarHash,
    xp: profile.xp,
    level: levelFromXp(profile.xp, options.maxLevelTotalXp),
    rank: better + 1,
    messages: profile.messages,
    voiceMinutes: profile.voiceMinutes,
    lastActivityAt: profile.lastActivityAt,
    lastMessageAt: profile.lastMessageAt,
    lastVoiceAt: profile.lastVoiceAt,
    lastDecayAt: profile.lastDecayAt,
    bySource: grouped
      .map((entry) => ({
        source: entry.source,
        total: entry._sum.delta ?? 0,
        count: entry._count._all,
      }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    gameStats: gameStats.map((entry) => ({
      kind: entry.kind,
      wins: entry.wins,
      losses: entry.losses,
      draws: entry.draws,
      xpWon: entry.xpWon,
      xpLost: entry.xpLost,
    })),
  };
}

export interface GameLeaderboardEntry {
  discordId: string;
  username: string | null;
  displayName: string | null;
  wins: number;
  losses: number;
  xpWon: number;
}

/** Top-Liste je Spielart. Ersetzt `/game_leaderboard` (dort fest Top 5). */
export async function getGameLeaderboards(
  limit = 5,
): Promise<Array<{ kind: XpGameKind; entries: GameLeaderboardEntry[] }>> {
  const results: Array<{ kind: XpGameKind; entries: GameLeaderboardEntry[] }> = [];

  for (const kind of GAME_KINDS) {
    const rows = await prisma.levelGameStats.findMany({
      where: { kind, wins: { gt: 0 } },
      orderBy: [{ wins: 'desc' }, { xpWon: 'desc' }],
      take: Math.min(Math.max(limit, 1), 50),
      include: { profile: { select: { username: true, displayName: true } } },
    });
    results.push({
      kind,
      entries: rows.map((row) => ({
        discordId: row.discordId,
        username: row.profile.username,
        displayName: row.profile.displayName,
        wins: row.wins,
        losses: row.losses,
        xpWon: row.xpWon,
      })),
    });
  }

  return results;
}

export interface XpTrendPoint {
  day: string;
  gained: number;
  lost: number;
  transactions: number;
}

/**
 * XP-Verlauf der letzten Tage.
 *
 * Erst durch das Journal überhaupt möglich - der Vorgänger speicherte nur den
 * jeweils aktuellen Stand.
 */
export async function getXpTrend(days = 30): Promise<XpTrendPoint[]> {
  const span = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - span * 86_400_000);

  const rows = await prisma.$queryRaw<Array<{ day: Date; gained: bigint; lost: bigint; count: bigint }>>`
    SELECT
      date_trunc('day', "createdAt") AS "day",
      COALESCE(SUM(CASE WHEN "delta" > 0 THEN "delta" ELSE 0 END), 0)::bigint AS "gained",
      COALESCE(SUM(CASE WHEN "delta" < 0 THEN -"delta" ELSE 0 END), 0)::bigint AS "lost",
      COUNT(*)::bigint AS "count"
    FROM "XpTransaction"
    WHERE "createdAt" >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    gained: Number(row.gained),
    lost: Number(row.lost),
    transactions: Number(row.count),
  }));
}

export interface InactiveMember {
  discordId: string;
  username: string | null;
  displayName: string | null;
  xp: number;
  level: number;
  lastActivityAt: Date | null;
  /** Tage seit der letzten Aktivität. */
  inactiveDays: number;
  /** Bereits abgezogene XP. */
  decayedXp: number;
}

/**
 * Wer gerade im Inaktivitäts-Abzug steckt.
 *
 * Beim Vorgänger liess sich das nur aus den Discord-Logs zusammensuchen.
 */
export async function getInactiveMembers(
  options: { graceDays?: number; limit?: number; now?: Date } = {},
): Promise<InactiveMember[]> {
  const graceDays = options.graceDays ?? 7;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000);

  const profiles = await prisma.levelProfile.findMany({
    where: { xp: { gt: 0 }, lastActivityAt: { not: null, lte: cutoff } },
    orderBy: { lastActivityAt: 'asc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 500),
  });

  if (profiles.length === 0) {
    return [];
  }

  const decayed = await prisma.xpTransaction.groupBy({
    by: ['discordId'],
    where: { source: 'DECAY', discordId: { in: profiles.map((entry) => entry.discordId) } },
    _sum: { delta: true },
  });
  const decayedByUser = new Map(decayed.map((entry) => [entry.discordId, -(entry._sum.delta ?? 0)]));

  return profiles.map((profile) => ({
    discordId: profile.discordId,
    username: profile.username,
    displayName: profile.displayName,
    xp: profile.xp,
    level: levelFromXp(profile.xp),
    lastActivityAt: profile.lastActivityAt,
    inactiveDays: profile.lastActivityAt
      ? Math.floor((now.getTime() - profile.lastActivityAt.getTime()) / 86_400_000)
      : 0,
    decayedXp: decayedByUser.get(profile.discordId) ?? 0,
  }));
}
