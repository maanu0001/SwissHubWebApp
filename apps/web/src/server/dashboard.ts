import 'server-only';
import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { jail, readBotStatus, type BotStatusView } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import type { AuditLog, JailEntry } from '@swisshub/database';

const log = createLogger('web:dashboard');

export interface DashboardData {
  bot: BotStatusView;
  memberCount: number | null;
  onlineCount: number | null;
  discordReachable: boolean;
  jailStats: Awaited<ReturnType<typeof jail.getJailStats>>;
  /** Die nächsten auslaufenden aktiven Jails. */
  activeJails: JailEntry[];
  actionsToday: number;
  actionsYesterday: number;
  /** Prozentuale Veränderung gegenüber gestern (gerundet). */
  actionsTrend: number | null;
  recentActivity: AuditLog[];
}

export interface DashboardScope {
  canViewJails: boolean;
  canViewAudit: boolean;
}

/**
 * Kennzahlen des Dashboards.
 *
 * Discord-Ausfälle dürfen das Dashboard nicht unbenutzbar machen: der
 * Mitgliederzähler fällt dann weg, alles andere bleibt bedienbar. Es werden
 * nur Daten geladen, die der Benutzer auch sehen darf.
 */
export async function loadDashboardData(scope: DashboardScope): Promise<DashboardData> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

  const [bot, jailStats, actionsToday, actionsYesterday, activeJails, recentActivity, guild] =
    await Promise.all([
      readBotStatus(),
      jail.getJailStats(),
      prisma.moderationAction.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.moderationAction.count({
        where: { createdAt: { gte: startOfYesterday, lt: startOfToday } },
      }),
      scope.canViewJails
        ? prisma.jailEntry.findMany({
            where: { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] } },
            orderBy: { endsAt: 'asc' },
            take: 5,
          })
        : Promise.resolve([]),
      scope.canViewAudit
        ? prisma.auditLog.findMany({ orderBy: { sequence: 'desc' }, take: 6 })
        : Promise.resolve([]),
      discord.guild.get().catch((error: unknown) => {
        log.warn('Guild-Daten konnten nicht geladen werden', { error });
        return null;
      }),
    ]);

  return {
    bot,
    memberCount: guild?.approximateMemberCount ?? bot.guildMemberCount,
    onlineCount: guild?.approximatePresenceCount ?? null,
    discordReachable: guild !== null,
    jailStats,
    activeJails,
    actionsToday,
    actionsYesterday,
    actionsTrend:
      actionsYesterday > 0 ? Math.round(((actionsToday - actionsYesterday) / actionsYesterday) * 100) : null,
    recentActivity,
  };
}
