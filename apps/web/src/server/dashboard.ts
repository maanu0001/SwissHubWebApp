import 'server-only';
import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { jail, loadAvatarHashes, readBotStatus, type BotStatusView } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import type { AuditLog, JailEntry } from '@swisshub/database';

const log = createLogger('web:dashboard');

export interface DashboardData {
  bot: BotStatusView;
  memberCount: number | null;
  onlineCount: number | null;
  discordReachable: boolean;
  /**
   * Jail-Kennzahlen - nur fuer Berechtigte.
   *
   * `undefined` heisst hier nicht «keine Jails», sondern «diese Person darf
   * es nicht wissen». Deshalb ein fehlender Wert und keine Null: eine Null
   * waere eine Auskunft ueber den Moderationsstand des Servers, und die geht
   * ein gewoehnliches Mitglied nichts an.
   */
  jailStats?: Awaited<ReturnType<typeof jail.getJailStats>>;
  /** Die nächsten auslaufenden aktiven Jails. */
  activeJails: JailEntry[];
  /** Moderationsaktionen heute - nur fuer Berechtigte, siehe oben. */
  actionsToday?: number;
  actionsYesterday?: number;
  /** Prozentuale Veränderung gegenüber gestern (gerundet). */
  actionsTrend: number | null;
  /** Letzte Aktionen inklusive Avatar-Hash des Ausführenden. */
  recentActivity: Array<AuditLog & { actorAvatarHash: string | null }>;
}

export interface DashboardScope {
  canViewJails: boolean;
  canViewAudit: boolean;
  /** Darf die Moderationskennzahlen des Servers sehen. */
  canViewModeration: boolean;
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

  // Was der Betrachter nicht sehen darf, wird auch nicht abgefragt. Es
  // hinterher wegzulassen waere dieselbe Abfrage und dieselbe Zeile in einem
  // Fehlerprotokoll - nur mit dem Anschein von Zurueckhaltung.
  const [bot, jailStats, actionsToday, actionsYesterday, activeJails, recentActivity, guild] =
    await Promise.all([
      readBotStatus(),
      scope.canViewJails ? jail.getJailStats() : Promise.resolve(undefined),
      scope.canViewModeration
        ? prisma.moderationAction.count({ where: { createdAt: { gte: startOfToday } } })
        : Promise.resolve(undefined),
      scope.canViewModeration
        ? prisma.moderationAction.count({
            where: { createdAt: { gte: startOfYesterday, lt: startOfToday } },
          })
        : Promise.resolve(undefined),
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

  const avatarHashes = await loadAvatarHashes(recentActivity.map((entry) => entry.actorDiscordId));

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
      actionsToday !== undefined && actionsYesterday !== undefined && actionsYesterday > 0
        ? Math.round(((actionsToday - actionsYesterday) / actionsYesterday) * 100)
        : null,
    // Avatare gesammelt nachschlagen - ein Query statt einer Anfrage pro Zeile.
    recentActivity: recentActivity.map((entry) => ({
      ...entry,
      actorAvatarHash: avatarHashes.get(entry.actorDiscordId ?? '') ?? null,
    })),
  };
}
