import { prisma } from '@swisshub/database';
import { paginate, toSkipTake, type Paginated } from '@swisshub/shared';
import type { JailEntry, Prisma } from '@swisshub/database';
import type { JailListQuery } from './schemas';

/**
 * Lesezugriffe des Jail-Moduls. Bewusst getrennt von den schreibenden
 * Services, damit Listen-/Detailansichten keine Seiteneffekte ausloesen.
 */
export async function listJails(query: JailListQuery): Promise<Paginated<JailEntry>> {
  const where: Prisma.JailEntryWhereInput = {
    ...(query.tab === 'active'
      ? { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] } }
      : { OR: [{ releasedAt: { not: null } }, { status: 'FAILED' }] }),
    ...(query.search
      ? {
          OR: [
            { targetUsername: { contains: query.search, mode: 'insensitive' } },
            { targetDisplayName: { contains: query.search, mode: 'insensitive' } },
            { targetDiscordId: query.search },
            { moderatorUsername: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const { skip, take } = toSkipTake({ page: query.page, pageSize: query.pageSize });
  const [items, total] = await Promise.all([
    prisma.jailEntry.findMany({
      where,
      orderBy: query.tab === 'active' ? { endsAt: 'asc' } : { startedAt: 'desc' },
      skip,
      take,
    }),
    prisma.jailEntry.count({ where }),
  ]);

  return paginate(items, total, { page: query.page, pageSize: query.pageSize });
}

export async function getJail(id: string): Promise<JailEntry | null> {
  return prisma.jailEntry.findUnique({ where: { id } });
}

export async function getActiveJail(discordId: string): Promise<JailEntry | null> {
  return prisma.jailEntry.findUnique({ where: { activeKey: discordId } });
}

/** Vollstaendige Jail-Historie eines Mitglieds. */
export async function getJailHistory(discordId: string, limit = 25): Promise<JailEntry[]> {
  return prisma.jailEntry.findMany({
    where: { targetDiscordId: discordId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}

export interface JailStats {
  active: number;
  endingSoon: number;
  createdToday: number;
  releasedToday: number;
}

export async function getJailStats(): Promise<JailStats> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const soon = new Date(now.getTime() + 60 * 60 * 1000);

  const [active, endingSoon, createdToday, releasedToday] = await Promise.all([
    prisma.jailEntry.count({ where: { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] } } }),
    prisma.jailEntry.count({
      where: { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] }, endsAt: { lte: soon } },
    }),
    prisma.jailEntry.count({ where: { startedAt: { gte: startOfDay } } }),
    prisma.jailEntry.count({ where: { releasedAt: { gte: startOfDay } } }),
  ]);

  return { active, endingSoon, createdToday, releasedToday };
}
