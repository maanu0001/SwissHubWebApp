import type { Metadata } from 'next';
import { Activity, Gavel, Lock, Users } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { formatDateTime, formatTime } from '@swisshub/shared';
import { enabledModuleIds, listModuleStatus } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ModuleCard } from '@/components/shared/module-card';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { requirePagePermission } from '@/server/auth';
import { loadDashboardData } from '@/server/dashboard';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const ACTION_LABEL: Record<string, string> = {
  JAIL_CREATE: 'hat gejailt',
  JAIL_RELEASE: 'hat freigelassen',
  JAIL_EXTEND: 'hat die Dauer angepasst',
};

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('dashboard.view');
  const [data, moduleStatus, moduleIds] = await Promise.all([
    loadDashboardData(),
    listModuleStatus(),
    enabledModuleIds(),
  ]);

  const visibleModules = moduleStatus.filter(
    (entry) =>
      !entry.definition.core &&
      entry.definition.navigation.some((item) => context.permissionKeys.includes(item.permission)),
  );

  return (
    <>
      <PageHeader
        title={`Willkommen zurueck, ${context.user.displayName}.`}
        description={`Uebersicht ueber ${branding.name}. Zeiten in ${branding.timezone}.`}
        actions={
          <DiscordAvatar
            discordId={context.user.discordId}
            avatarHash={context.user.avatarHash}
            name={context.user.displayName}
            size={40}
          />
        }
      />

      <section aria-label="Kennzahlen" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bot Status"
          value={data.bot.online ? 'Online' : 'Offline'}
          hint={
            data.bot.online
              ? `Discord verbunden${data.bot.wsPingMs !== null ? ` \u00b7 Ping: ${data.bot.wsPingMs} ms` : ''}`
              : data.bot.lastHeartbeatAt
                ? `Bot derzeit nicht erreichbar \u00b7 letzter Heartbeat: ${formatDateTime(data.bot.lastHeartbeatAt)}${
                    data.bot.lastConnectedAt
                      ? ` \u00b7 zuletzt verbunden: ${formatDateTime(data.bot.lastConnectedAt)}`
                      : ''
                  }`
                : 'Noch kein Heartbeat empfangen'
          }
          icon={<Activity />}
          tone={data.bot.online ? 'success' : 'destructive'}
        />
        <StatCard
          label="Mitglieder"
          value={data.memberCount ?? '-'}
          hint={data.discordReachable ? 'Aktuell auf Discord' : 'Discord derzeit nicht erreichbar'}
          icon={<Users />}
        />
        <StatCard
          label="Aktive Jails"
          value={data.jailStats.active}
          hint={
            data.jailStats.endingSoon > 0
              ? `${data.jailStats.endingSoon} enden in der naechsten Stunde`
              : 'Keine bevorstehenden Freilassungen'
          }
          icon={<Lock />}
          tone={data.jailStats.active > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Aktionen heute"
          value={data.actionsToday}
          hint={`${data.jailStats.createdToday} Jails · ${data.jailStats.releasedToday} Freilassungen`}
          icon={<Gavel />}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Letzte Aktionen</CardTitle>
            <CardDescription>Die zuletzt ausgefuehrten Moderationsaktionen.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentActions.length === 0 ? (
              <EmptyState
                title="Noch keine Aktionen"
                description="Sobald Moderationsaktionen ausgefuehrt werden, erscheinen sie hier."
              />
            ) : (
              <ol className="divide-y divide-border/60">
                {data.recentActions.map((action) => (
                  <li key={action.id} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                    <time
                      dateTime={action.createdAt.toISOString()}
                      className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
                    >
                      {formatTime(action.createdAt)}
                    </time>
                    <p className="text-sm">
                      <span className="font-medium">{action.actorUsername}</span>{' '}
                      {ACTION_LABEL[action.type] ?? 'hat eine Aktion ausgefuehrt gegen'}{' '}
                      <span className="font-medium">{action.targetUsername}</span>
                      {action.reason ? (
                        <span className="text-muted-foreground"> &middot; {action.reason}</span>
                      ) : null}
                    </p>
                    {action.status !== 'COMPLETED' ? (
                      <Badge variant="warning" className="ml-auto shrink-0">
                        {action.status}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Module</CardTitle>
            <CardDescription>Aktive SwissHub-Module mit deinen Berechtigungen.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {visibleModules.length === 0 ? (
              <EmptyState
                title="Keine Module verfuegbar"
                description="Dir sind derzeit keine Module zugewiesen."
              />
            ) : (
              visibleModules.map((entry) => (
                <ModuleCard
                  key={entry.definition.id}
                  name={entry.definition.name}
                  description={entry.definition.description}
                  icon={entry.definition.icon}
                  enabled={entry.enabled && moduleIds.has(entry.definition.id)}
                  href={entry.enabled ? (entry.definition.navigation[0]?.href ?? null) : null}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
