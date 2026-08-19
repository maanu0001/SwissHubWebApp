import 'server-only';
import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { jail, readBotStatus, type BotStatusView } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import type { ModerationAction } from '@swisshub/database';

const log = createLogger('web:dashboard');

export interface DashboardData {
  bot: BotStatusView;
  memberCount: number | null;
  discordReachable: boolean;
  jailStats: Awaited<ReturnType<typeof jail.getJailStats>>;
  actionsToday: number;
  recentActions: ModerationAction[];
}

/**
 * Kennzahlen des Dashboards.
 *
 * Discord-Ausfaelle duerfen das Dashboard nicht unbenutzbar machen: der
 * Mitgliederzaehler faellt dann einfach weg, alles andere bleibt bedienbar.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [bot, jailStats, actionsToday, recentActions, memberCount] = await Promise.all([
    readBotStatus(),
    jail.getJailStats(),
    prisma.moderationAction.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.moderationAction.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    discord.guild.memberCount().catch((error: unknown) => {
      log.warn('Mitgliederzahl konnte nicht geladen werden', { error });
      return null;
    }),
  ]);

  return {
    bot,
    memberCount: memberCount ?? bot.guildMemberCount,
    discordReachable: memberCount !== null,
    jailStats,
    actionsToday,
    recentActions,
  };
}
