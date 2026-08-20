import { prisma, type LevelGameMatch, type XpTransaction } from '@swisshub/database';
import { levelFromXp } from './curve';
import { isInDecayPhase, type DecayRules } from './decay';

/**
 * Abfragen für das Dashboard.
 *
 * Bewusst getrennt von den Diensten: hier wird nur gelesen und für die
 * Anzeige aufbereitet, nie geschrieben.
 */

export interface LevelOverview {
  members: number;
  activeMembers: number;
  totalXp: number;
  averageLevel: number;
  highestLevel: number;
  /** XP-Buchungen der letzten 24 Stunden. */
  transactionsToday: number;
  xpGainedToday: number;
  xpLostToday: number;
  milestoneRoles: number;
  runningGames: number;
  gamesToday: number;
  inDecay: number;
  lastImportAt: Date | null;
}

export async function getLevelOverview(options: { decayRules?: DecayRules } = {}): Promise<LevelOverview> {
  const since = new Date(Date.now() - 86_400_000);
  const graceDays = options.decayRules?.graceDays ?? 7;
  const decayCutoff = new Date(Date.now() - graceDays * 86_400_000);

  const [aggregate, members, activeMembers, today, milestoneRoles, runningGames, gamesToday, inDecay, lastImport, profiles] =
    await Promise.all([
      prisma.levelProfile.aggregate({ _sum: { xp: true }, _max: { xp: true } }),
      prisma.levelProfile.count(),
      prisma.levelProfile.count({ where: { xp: { gt: 0 } } }),
      prisma.xpTransaction.findMany({
        where: { createdAt: { gte: since } },
        select: { delta: true },
      }),
      prisma.levelMilestoneRole.count({ where: { enabled: true } }),
      prisma.levelGameMatch.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
      prisma.levelGameMatch.count({ where: { createdAt: { gte: since } } }),
      prisma.levelProfile.count({
        where: { xp: { gt: 0 }, lastActivityAt: { not: null, lte: decayCutoff } },
      }),
      prisma.levelImport.findFirst({
        where: { status: 'IMPORTED' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      }),
      prisma.levelProfile.findMany({ select: { xp: true } }),
    ]);

  const levels = profiles.map((profile) => levelFromXp(profile.xp));
  const averageLevel =
    levels.length > 0 ? Math.round((levels.reduce((sum, value) => sum + value, 0) / levels.length) * 10) / 10 : 0;

  return {
    members,
    activeMembers,
    totalXp: aggregate._sum.xp ?? 0,
    averageLevel,
    highestLevel: levelFromXp(aggregate._max.xp ?? 0),
    transactionsToday: today.length,
    xpGainedToday: today.reduce((sum, entry) => sum + Math.max(0, entry.delta), 0),
    xpLostToday: today.reduce((sum, entry) => sum + Math.max(0, -entry.delta), 0),
    milestoneRoles,
    runningGames,
    gamesToday,
    inDecay,
    lastImportAt: lastImport?.finishedAt ?? null,
  };
}

export interface MemberListEntry {
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
  inDecay: boolean;
}

export interface MemberListResult {
  entries: MemberListEntry[];
  total: number;
}

/** Mitgliederliste mit Suche und Seitenwechsel. */
export async function listLevelMembers(options: {
  query?: string;
  page?: number;
  pageSize?: number;
  sort?: 'xp' | 'activity' | 'messages' | 'voice';
  decayRules?: DecayRules;
} = {}): Promise<MemberListResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const query = options.query?.trim() ?? '';

  const where = query
    ? {
        OR: [
          { discordId: { contains: query } },
          { username: { contains: query, mode: 'insensitive' as const } },
          { displayName: { contains: query, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const orderBy =
    options.sort === 'activity'
      ? [{ lastActivityAt: 'desc' as const }]
      : options.sort === 'messages'
        ? [{ messages: 'desc' as const }]
        : options.sort === 'voice'
          ? [{ voiceMinutes: 'desc' as const }]
          : [{ xp: 'desc' as const }];

  const [rows, total] = await Promise.all([
    prisma.levelProfile.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.levelProfile.count({ where }),
  ]);

  const now = new Date();

  // Der Rang richtet sich immer nach XP - auch wenn gerade nach Aktivität
  // sortiert wird. Sonst hiesse "Rang" je nach Ansicht etwas anderes.
  const ranks = await Promise.all(
    rows.map((row) => prisma.levelProfile.count({ where: { xp: { gt: row.xp } } })),
  );

  return {
    total,
    entries: rows.map((row, index) => ({
      discordId: row.discordId,
      username: row.username,
      displayName: row.displayName,
      avatarHash: row.avatarHash,
      xp: row.xp,
      level: levelFromXp(row.xp),
      rank: (ranks[index] ?? 0) + 1,
      messages: row.messages,
      voiceMinutes: row.voiceMinutes,
      lastActivityAt: row.lastActivityAt,
      inDecay: isInDecayPhase(row.lastActivityAt, now, options.decayRules),
    })),
  };
}

/** Journal einer Person - die Herkunft jeder einzelnen XP-Änderung. */
export async function listXpTransactions(options: {
  discordId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: XpTransaction[]; total: number }> {
  const where = options.discordId ? { discordId: options.discordId } : {};
  const [entries, total] = await Promise.all([
    prisma.xpTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: Math.max(options.offset ?? 0, 0),
      take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    }),
    prisma.xpTransaction.count({ where }),
  ]);
  return { entries, total };
}

/** Laufende und beendete Partien. */
export async function listGameMatches(options: { limit?: number; onlyRunning?: boolean } = {}): Promise<
  LevelGameMatch[]
> {
  return prisma.levelGameMatch.findMany({
    where: options.onlyRunning ? { status: { in: ['PENDING', 'RUNNING'] } } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 25, 1), 200),
  });
}

export interface DecayPreviewEntry {
  discordId: string;
  username: string | null;
  displayName: string | null;
  xp: number;
  level: number;
  lastActivityAt: Date | null;
  inactiveDays: number;
  /** XP, die beim nächsten Lauf abgezogen würden. */
  pendingDecay: number;
  levelAfter: number;
}

/**
 * Vorschau des nächsten Abzugs.
 *
 * Zeigt vorab, wen es trifft und wie hart - beim Vorgänger liess sich das erst
 * hinterher an den Logs ablesen.
 */
export async function previewDecay(options: {
  decayRules: DecayRules;
  limit?: number;
  now?: Date;
  maxLevelTotalXp?: number;
}): Promise<DecayPreviewEntry[]> {
  const { computeDecay } = await import('./decay');
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.decayRules.graceDays * 86_400_000);

  const profiles = await prisma.levelProfile.findMany({
    where: { xp: { gt: 0 }, lastActivityAt: { not: null, lte: cutoff } },
    orderBy: { lastDecayAt: 'asc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 500),
  });

  return profiles
    .map((profile) => {
      const result = computeDecay(
        {
          xp: profile.xp,
          lastActivityAt: profile.lastActivityAt,
          lastDecayAt: profile.lastDecayAt,
          now,
        },
        options.decayRules,
      );
      return {
        discordId: profile.discordId,
        username: profile.username,
        displayName: profile.displayName,
        xp: profile.xp,
        level: levelFromXp(profile.xp, options.maxLevelTotalXp),
        lastActivityAt: profile.lastActivityAt,
        inactiveDays: profile.lastActivityAt
          ? Math.floor((now.getTime() - profile.lastActivityAt.getTime()) / 86_400_000)
          : 0,
        pendingDecay: result.decayed,
        levelAfter: levelFromXp(result.newXp, options.maxLevelTotalXp),
      };
    })
    .filter((entry) => entry.pendingDecay > 0);
}
