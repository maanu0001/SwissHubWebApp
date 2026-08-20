import { prisma } from '@swisshub/database';
import { paginate, toSkipTake, type Paginated } from '@swisshub/shared';
import type {
  Prisma,
  SpielersucheGame,
  SpielersucheMatch,
  SpielersucheParticipant,
} from '@swisshub/database';
import type { SearchListQuery } from './schemas';

/**
 * Lesezugriffe der Spielersuche.
 *
 * Bewusst getrennt von den schreibenden Services, damit Listen- und
 * Detailansichten garantiert keine Seiteneffekte auslösen.
 */

export interface MatchWithParticipants extends SpielersucheMatch {
  participants: SpielersucheParticipant[];
  game: SpielersucheGame | null;
}

const ACTIVE_STATUS = ['OPEN', 'COMPLETE'] as const;

export async function listSearches(query: SearchListQuery): Promise<Paginated<MatchWithParticipants>> {
  const where: Prisma.SpielersucheMatchWhereInput = {
    ...(query.tab === 'active'
      ? { status: { in: [...ACTIVE_STATUS] } }
      : { status: { in: ['CLOSED', 'EXPIRED'] } }),
    ...(query.status ? { status: query.status } : {}),
    ...(query.gameId ? { gameId: query.gameId } : {}),
    ...(query.search
      ? {
          OR: [
            { creatorUsername: { contains: query.search, mode: 'insensitive' } },
            { creatorDisplayName: { contains: query.search, mode: 'insensitive' } },
            { gameName: { contains: query.search, mode: 'insensitive' } },
            { creatorDiscordId: query.search },
          ],
        }
      : {}),
  };

  const { skip, take } = toSkipTake({ page: query.page, pageSize: query.pageSize });
  const [items, total] = await Promise.all([
    prisma.spielersucheMatch.findMany({
      where,
      include: {
        participants: { where: { leftAt: null }, orderBy: { joinedAt: 'asc' } },
        game: true,
      },
      orderBy: query.tab === 'active' ? { createdAt: 'asc' } : { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.spielersucheMatch.count({ where }),
  ]);

  return paginate(items, total, { page: query.page, pageSize: query.pageSize });
}

/** Eine Suche mit allen Teilnehmern - auch bereits ausgetretenen. */
export async function getSearchDetail(matchId: string): Promise<MatchWithParticipants | null> {
  return prisma.spielersucheMatch.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: { joinedAt: 'asc' } }, game: true },
  });
}

export async function listActiveSearchesWithParticipants(limit = 50): Promise<MatchWithParticipants[]> {
  return prisma.spielersucheMatch.findMany({
    where: { status: { in: [...ACTIVE_STATUS] } },
    include: {
      participants: { where: { leftAt: null }, orderBy: { joinedAt: 'asc' } },
      game: true,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/** Zahl der laufenden Suchen - für Modulkachel und Navigation. */
export async function countActiveSearches(): Promise<number> {
  return prisma.spielersucheMatch.count({ where: { status: { in: [...ACTIVE_STATUS] } } });
}

export interface TopGameEntry {
  gameId: string | null;
  name: string;
  searches: number;
}

/** Beliebteste Spiele im Zeitraum. */
export async function getTopGames(since?: Date, limit = 5): Promise<TopGameEntry[]> {
  const rows = await prisma.spielersucheMatch.groupBy({
    by: ['gameId', 'gameName'],
    where: since ? { createdAt: { gte: since } } : {},
    _count: { _all: true },
    orderBy: { _count: { gameId: 'desc' } },
    take: limit,
  });

  return rows
    .map((row) => ({ gameId: row.gameId, name: row.gameName, searches: row._count._all }))
    .sort((a, b) => b.searches - a.searches);
}

export interface TopCreatorEntry {
  discordId: string;
  username: string | null;
  avatarHash: string | null;
  searches: number;
}

export async function getTopCreators(since?: Date, limit = 5): Promise<TopCreatorEntry[]> {
  const rows = await prisma.spielersucheMatch.groupBy({
    by: ['creatorDiscordId'],
    where: since ? { createdAt: { gte: since } } : {},
    _count: { _all: true },
    orderBy: { _count: { creatorDiscordId: 'desc' } },
    take: limit,
  });

  const details = await prisma.spielersucheMatch.findMany({
    where: { creatorDiscordId: { in: rows.map((row) => row.creatorDiscordId) } },
    distinct: ['creatorDiscordId'],
    orderBy: { createdAt: 'desc' },
    select: {
      creatorDiscordId: true,
      creatorUsername: true,
      creatorDisplayName: true,
      creatorAvatarHash: true,
    },
  });

  return rows.map((row) => {
    const detail = details.find((entry) => entry.creatorDiscordId === row.creatorDiscordId);
    return {
      discordId: row.creatorDiscordId,
      username: detail?.creatorDisplayName ?? detail?.creatorUsername ?? null,
      avatarHash: detail?.creatorAvatarHash ?? null,
      searches: row._count._all,
    };
  });
}

/** Die letzten Suchen einer Person - für das Mitgliederprofil. */
export async function getMemberSearches(discordId: string, limit = 10): Promise<SpielersucheMatch[]> {
  return prisma.spielersucheMatch.findMany({
    where: { creatorDiscordId: discordId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
