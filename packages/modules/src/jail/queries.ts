import { prisma } from '@swisshub/database';
import { paginate, toSkipTake, type Paginated } from '@swisshub/shared';
import type { JailEntry, Prisma } from '@swisshub/database';
import type { JailListQuery } from './schemas';

/**
 * Lesezugriffe des Jail-Moduls. Bewusst getrennt von den schreibenden
 * Services, damit Listen-/Detailansichten keine Seiteneffekte auslösen.
 */
export async function listJails(query: JailListQuery): Promise<Paginated<JailEntry>> {
  const where: Prisma.JailEntryWhereInput = {
    // "Aktiv" umfasst auch Mitglieder, die den Server verlassen haben: ihre
    // Strafe läuft weiter und wird beim Wiedereintritt erneut angewendet.
    ...(query.tab === 'active'
      ? {
          releasedAt: null,
          status: { in: ['COMPLETED', 'PARTIAL'] },
          lifecycle: { in: ['ACTIVE', 'PENDING_REJOIN', 'RESTORE_FAILED'] },
        }
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

/** Vollständige Jail-Historie eines Mitglieds. */
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
      where: {
        releasedAt: null,
        status: { in: ['COMPLETED', 'PARTIAL'] },
        // Permanente Jails haben kein `endsAt` und laufen nie "bald ab".
        endsAt: { not: null, lte: soon },
      },
    }),
    prisma.jailEntry.count({ where: { startedAt: { gte: startOfDay } } }),
    prisma.jailEntry.count({ where: { releasedAt: { gte: startOfDay } } }),
  ]);

  return { active, endingSoon, createdToday, releasedToday };
}

/**
 * Alle offenen Jails.
 *
 * "Offen" heisst: noch nicht freigelassen. Dazu gehören auch Mitglieder, die
 * den Server verlassen haben (`PENDING_REJOIN`) - ihre Strafe läuft weiter.
 * Dieselbe Abfrage bedient die Dashboard-Übersicht und `/jail_list`.
 */
export async function listActiveJails(limit = 100): Promise<JailEntry[]> {
  return prisma.jailEntry.findMany({
    where: {
      releasedAt: null,
      status: { in: ['COMPLETED', 'PARTIAL'] },
      lifecycle: { in: ['ACTIVE', 'PENDING_REJOIN', 'RESTORE_FAILED'] },
    },
    // Permanente Jails haben kein Ende und stehen deshalb am Schluss.
    orderBy: [{ endsAt: { sort: 'asc', nulls: 'last' } }, { startedAt: 'asc' }],
    take: limit,
  });
}

/** Ein Jail mit seinem strukturierten Rollen-Snapshot. */
export async function getJailDetail(id: string): Promise<
  | (JailEntry & {
      roleSnapshotEntries: Array<{
        roleId: string;
        roleNameAtTime: string | null;
        rolePositionAtTime: number | null;
        managedAtTime: boolean;
        kept: boolean;
        restoredAt: Date | null;
        restoreFailedCode: string | null;
      }>;
    })
  | null
> {
  return prisma.jailEntry.findUnique({
    where: { id },
    include: {
      roleSnapshotEntries: {
        orderBy: [{ rolePositionAtTime: 'desc' }, { roleId: 'asc' }],
      },
    },
  });
}
