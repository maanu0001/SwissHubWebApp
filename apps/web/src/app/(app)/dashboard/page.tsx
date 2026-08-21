import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, Blocks, Lock, ScrollText, Search, Settings, TrendingUp, Users } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { can } from '@swisshub/auth';
import {
  branding as brandingModule,
  enabledModuleIds,
  getModuleSettings,
  getSystemHealth,
  jail,
  listModuleStatus,
} from '@swisshub/modules';
import { formatDateTime, formatRemaining, plural } from '@swisshub/shared';
import { StatCard, StatDelta } from '@/components/shared/stat-card';
import { Panel } from '@/components/shared/panel';
import { ActivityItem } from '@/components/shared/activity-item';
import { QuickAction } from '@/components/shared/quick-action';
import { ModuleCard } from '@/components/shared/module-card';
import { BrandBanner } from '@/components/shared/brand-banner';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { JailRowActions } from '@/modules/jail/components/jail-row-actions';
import { CreateJailDialog } from '@/modules/jail/components/create-jail-dialog';
import { SetupProgress } from '@/modules/configuration/components/setup-progress';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDashboardData } from '@/server/dashboard';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const numberFormat = new Intl.NumberFormat(branding.locale);

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('dashboard.view');

  const canViewJails = can(context, jail.JAIL_PERMISSIONS.view);
  const canCreateJail = can(context, jail.JAIL_PERMISSIONS.create);
  const canReleaseJail = can(context, jail.JAIL_PERMISSIONS.release);
  const canViewAudit = can(context, 'audit.view');
  const canViewMembers = can(context, 'members.view');
  const canManageModules = can(context, 'modules.manage');
  const canViewSettings = can(context, 'settings.view');

  const [data, moduleStatus, moduleIds, jailSettings, health, logoUrl] = await Promise.all([
    loadDashboardData({ canViewJails, canViewAudit }),
    listModuleStatus(),
    enabledModuleIds(),
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    canViewSettings ? getSystemHealth() : Promise.resolve(null),
    brandingModule.currentLogoUrl(),
  ]);

  const csrfToken = csrfTokenFor(context);

  // Verfügbare Module zuerst, geplante als Ausblick dahinter.
  const visibleModules = moduleStatus
    .filter(
      (entry) =>
        !entry.definition.core &&
        entry.definition.navigation.some((item) => context.permissionKeys.includes(item.permission)),
    )
    .sort((a, b) => {
      // Eingeschaltete Module zuerst - was abgeschaltet ist, steht hinten.
      const rank = (entry: typeof a): number => (entry.enabled ? 0 : 1);
      return rank(a) - rank(b) || a.definition.name.localeCompare(b.definition.name);
    });

  return (
    <>
      {health && health.completeness < 100 ? (
        <section aria-label="Einrichtung" className="rounded-xl border border-warning/40 bg-warning/5 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Einrichtung noch nicht abgeschlossen</h2>
            <Link href="/setup" className="inline-flex min-h-6 items-center text-sm text-primary hover:underline">
              Zum Einrichtungsassistenten
            </Link>
          </div>
          <SetupProgress completeness={health.completeness} steps={health.steps} />
        </section>
      ) : null}

      <section aria-label="Kennzahlen" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Mitglieder"
          value={data.memberCount !== null ? numberFormat.format(data.memberCount) : '-'}
          hint={
            data.discordReachable ? (
              data.onlineCount !== null ? (
                <span className="flex items-center gap-1.5">
                  online: {numberFormat.format(data.onlineCount)}
                  <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                </span>
              ) : (
                'Aktuell auf Discord'
              )
            ) : (
              'Discord derzeit nicht erreichbar'
            )
          }
          icon={<Users />}
        />

        <StatCard
          label="Aktive Jails"
          value={data.jailStats.active}
          hint={
            data.jailStats.endingSoon > 0
              ? `${data.jailStats.endingSoon} enden in der nächsten Stunde`
              : 'Keine bevorstehenden Freilassungen'
          }
          icon={<Lock />}
          tone={data.jailStats.active > 0 ? 'warning' : 'default'}
        />

        <StatCard
          label="Bot Status"
          value={data.bot.online ? 'Online' : 'Offline'}
          tone={data.bot.online ? 'success' : 'destructive'}
          hint={
            data.bot.online
              ? data.bot.wsPingMs !== null
                ? `Ping: ${data.bot.wsPingMs} ms`
                : 'Discord verbunden'
              : data.bot.lastHeartbeatAt
                ? `Letzter Heartbeat: ${formatDateTime(data.bot.lastHeartbeatAt)}`
                : 'Noch kein Heartbeat empfangen'
          }
          icon={<Activity />}
        />

        <StatCard
          label="Aktionen heute"
          value={data.actionsToday}
          hint={
            data.actionsTrend !== null ? (
              <>
                <StatDelta value={data.actionsTrend} suffix="%" /> zum Vortag
              </>
            ) : (
              `${plural(data.jailStats.createdToday, 'Jail', 'Jails')} · ${plural(
                data.jailStats.releasedToday,
                'Freilassung',
                'Freilassungen',
              )}`
            )
          }
          icon={<TrendingUp />}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {canViewJails ? (
            <Panel
              title="Aktive Jails"
              icon={<Lock />}
              action={{ label: 'Alle anzeigen', href: '/jail' }}
              bodyClassName="p-0"
            >
              {data.activeJails.length === 0 ? (
                <EmptyState
                  className="border-0"
                  title="Keine aktiven Jails"
                  description="Aktuell ist kein Mitglied gejailt."
                />
              ) : (
                <div className="overflow-x-auto scrollbar-slim">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Aktive Jail-Strafen</caption>
                    <thead>
                      <tr className="border-b border-border/70 text-left text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Mitglied
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Grund
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Moderator
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Ende
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Verbleibend
                        </th>
                        <th scope="col" className="px-5 py-3">
                          <span className="sr-only">Aktionen</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.activeJails.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/members/${entry.targetDiscordId}`}
                              className="flex items-center gap-3 hover:underline"
                            >
                              <DiscordAvatar
                                discordId={entry.targetDiscordId}
                                avatarHash={entry.targetAvatarHash}
                                name={entry.targetUsername}
                                size={32}
                              />
                              <span className="flex min-w-0 flex-col leading-tight">
                                <span className="truncate font-medium">
                                  {entry.targetDisplayName ?? entry.targetUsername}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  @{entry.targetUsername}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="max-w-[12rem] px-5 py-3 text-muted-foreground">
                            <span className="line-clamp-1">{entry.reason}</span>
                          </td>
                          <td className="px-5 py-3">
                            <span className="flex items-center gap-2">
                              <DiscordAvatar
                                discordId={entry.moderatorDiscordId}
                                avatarHash={entry.moderatorAvatarHash}
                                name={entry.moderatorUsername}
                                size={24}
                              />
                              <span className="truncate font-medium">{entry.moderatorUsername}</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                            {jail.jailEndLabel(entry, { short: true })}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 font-medium text-primary-bright">
                            {entry.endsAt
                              ? (formatRemaining(entry.endsAt) ?? 'Fällig')
                              : jail.PERMANENT_LABEL}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <JailRowActions
                              csrfToken={csrfToken}
                              jailId={entry.id}
                              memberLabel={entry.targetDisplayName ?? entry.targetUsername}
                              canRelease={canReleaseJail}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}

          <Panel
            title="Module"
            icon={<Blocks />}
            action={canManageModules ? { label: 'Module verwalten', href: '/modules' } : undefined}
          >
            {visibleModules.length === 0 ? (
              <EmptyState
                className="border-0"
                title="Keine Module verfügbar"
                description="Dir sind derzeit keine Module zugewiesen."
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {visibleModules.map((entry) => (
                    <ModuleCard
                      key={entry.definition.id}
                      name={entry.definition.name}
                      description={entry.definition.tagline ?? entry.definition.description}
                      icon={entry.definition.icon}
                      enabled={entry.enabled && moduleIds.has(entry.definition.id)}
                      href={entry.enabled ? (entry.definition.navigation[0]?.href ?? null) : null}
                    />
                  ))}
                </div>
                <div className="accent-rule mt-5 w-40 rounded-full" aria-hidden="true" />
              </>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          {canViewAudit ? (
            <Panel
              title="Letzte Aktivitäten"
              icon={<Activity />}
              action={{ label: 'Alle', href: '/audit', ariaLabel: 'Alle Aktivitäten anzeigen' }}
              bodyClassName="px-5 py-1"
            >
              {data.recentActivity.length === 0 ? (
                <EmptyState
                  className="border-0"
                  title="Noch keine Aktivitäten"
                  description="Sobald Aktionen ausgeführt werden, erscheinen sie hier."
                />
              ) : (
                <ul className="divide-y divide-border/50">
                  {data.recentActivity.map((entry) => (
                    <ActivityItem
                      key={entry.id}
                      entry={{
                        id: entry.id,
                        action: entry.action,
                        createdAt: entry.createdAt,
                        actorUsername: entry.actorUsername,
                        actorDiscordId: entry.actorDiscordId,
                        actorAvatarHash: entry.actorAvatarHash,
                        targetLabel: entry.targetLabel ?? entry.targetDiscordId,
                        reason:
                          typeof entry.metadata === 'object' &&
                          entry.metadata !== null &&
                          'reason' in entry.metadata &&
                          typeof (entry.metadata as { reason?: unknown }).reason === 'string'
                            ? ((entry.metadata as { reason: string }).reason ?? null)
                            : null,
                        success: entry.success,
                      }}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}

          <Panel title="Schnellaktionen" icon={<Lock />} bodyClassName="space-y-2 p-5">
            {canCreateJail ? (
              <QuickAction title="Mitglied jailen" description="Neuen Jail erstellen" icon={<Lock />}>
                <CreateJailDialog
                  csrfToken={csrfToken}
                  durationPresets={jail.JAIL_DURATION_PRESETS}
                  maxDurationSeconds={jailSettings.maxDurationSeconds}
                  announceByDefault={!jailSettings.silentByDefault}
                  variant="quick-action"
                  triggerLabel="Mitglied jailen"
                />
              </QuickAction>
            ) : null}

            {canViewMembers ? (
              <QuickAction
                title="Mitglied suchen"
                description="Nach Mitgliedern suchen"
                icon={<Search />}
                href="/members"
              />
            ) : null}

            {canViewAudit ? (
              <QuickAction
                title="Audit Log"
                description="Logs und Aktivitäten"
                icon={<ScrollText />}
                href="/audit"
              />
            ) : null}

            {canViewSettings ? (
              <QuickAction
                title="Einstellungen"
                description="Bot und System konfigurieren"
                icon={<Settings />}
                href="/settings"
              />
            ) : null}
          </Panel>
        </div>
      </div>

      <BrandBanner
        logoUrl={logoUrl}
        footnote={
          data.bot.online
            ? `Bot online${data.bot.wsPingMs !== null ? ` · Ping ${data.bot.wsPingMs} ms` : ''} · Zeitzone ${branding.timezone}`
            : `Bot derzeit nicht erreichbar · Zeitzone ${branding.timezone}`
        }
      />
    </>
  );
}
