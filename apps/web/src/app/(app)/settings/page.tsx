import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { env } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { listPermissions } from '@swisshub/permissions';
import { getCoreSettings, getModuleSettings, jail } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { CoreSettingsForm } from '@/modules/settings/components/core-settings-form';
import { JailSettingsForm } from '@/modules/settings/components/jail-settings-form';
import { RoleEditor, type ManagedRoleView } from '@/modules/settings/components/role-editor';
import { ReconciliationPanel } from '@/modules/settings/components/reconciliation-panel';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Einstellungen' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('settings.view');
  const csrfToken = csrfTokenFor(context);

  const canEditSettings = can(context, 'settings.edit');
  const canManagePermissions = can(context, 'permissions.manage');
  const canManageSystem = can(context, 'system.manage');
  const canEditJail = can(context, jail.JAIL_PERMISSIONS.settings);

  const [coreSettings, jailSettings, managedRoles] = await Promise.all([
    getCoreSettings(),
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    prisma.managedRole.findMany({
      orderBy: { moderationLevel: 'desc' },
      include: { permissions: { select: { permission: true } } },
    }),
  ]);

  // Discord-Daten sind optional: ohne Verbindung bleibt die Seite bedienbar.
  const [discordRoles, discordChannels, botPosition] = await Promise.all([
    discord.roles.list({ force: true }).catch(() => null),
    discord.channels.list({ force: true }).catch(() => null),
    discord.bot.highestRolePosition().catch(() => 0),
  ]);

  const roleViews: ManagedRoleView[] = managedRoles.map((role) => {
    const discordRole = discordRoles?.find((entry) => entry.id === role.discordRoleId);
    return {
      discordRoleId: role.discordRoleId,
      label: role.label,
      isProtected: role.isProtected,
      keepOnJail: role.keepOnJail,
      moderationLevel: role.moderationLevel,
      permissions: role.permissions.map((entry) => entry.permission),
      discordName: discordRole?.name ?? null,
      discordColor: discordRole?.color ?? 0,
      existsOnDiscord: discordRoles === null || discordRole !== undefined,
    };
  });

  const sortedRoles = (discordRoles ?? [])
    .filter((role) => !role.managed && role.name !== '@everyone')
    .sort((a, b) => b.position - a.position);

  return (
    <>
      <PageHeader
        title="Einstellungen"
        description="Discord-Anbindung, Rollen, Berechtigungen und Systemverhalten."
      />

      {discordRoles === null ? (
        <ErrorState
          title="Discord derzeit nicht erreichbar"
          description="Rollen und Channels koennen momentan nicht geladen werden. Bereits gespeicherte Einstellungen bleiben aktiv."
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Discord</CardTitle>
          <CardDescription>
            Verbindung zum SwissHub Discord-Server. Bot Token und Client Secret werden ausschliesslich ueber
            Environment Variables gesetzt und sind hier bewusst nicht bearbeitbar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Guild ID</dt>
              <dd className="font-mono text-sm">{env.DISCORD_GUILD_ID}</dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Bot-Rollenposition</dt>
              <dd className="font-mono text-sm">{botPosition > 0 ? botPosition : 'unbekannt'}</dd>
            </div>
          </dl>
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Secrets (Bot Token, Client Secret, AUTH_SECRET) gehoeren ausschliesslich in die Environment
            Variables des Servers - niemals in die Datenbank oder das Frontend.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Anzeigeoptionen, Zeitzone und zentrales Moderations-Log.</CardDescription>
        </CardHeader>
        <CardContent>
          <CoreSettingsForm
            csrfToken={csrfToken}
            channels={discordChannels ?? []}
            settings={{
              moderationLogChannelId: coreSettings.moderationLogChannelId,
              timezone: coreSettings.timezone,
              showDiscordIds: coreSettings.showDiscordIds,
              memberSearchLimit: coreSettings.memberSearchLimit,
            }}
            disabled={!canEditSettings}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jail</CardTitle>
          <CardDescription>Jail-Rolle, Channels und maximale Dauer des Jail-Moduls.</CardDescription>
        </CardHeader>
        <CardContent>
          <JailSettingsForm
            csrfToken={csrfToken}
            roles={sortedRoles.map((role) => ({ id: role.id, name: role.name, position: role.position }))}
            channels={discordChannels ?? []}
            botHighestPosition={botPosition || Number.MAX_SAFE_INTEGER}
            settings={{
              jailRoleId: jailSettings.jailRoleId,
              jailChannelId: jailSettings.jailChannelId,
              moderationLogChannelId: jailSettings.moderationLogChannelId,
              maxDurationSeconds: jailSettings.maxDurationSeconds,
              postModerationLog: jailSettings.postModerationLog,
              notifyInJailChannel: jailSettings.notifyInJailChannel,
              keepRoleIds: jailSettings.keepRoleIds,
            }}
            disabled={!canEditJail}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rollen &amp; Berechtigungen</CardTitle>
          <CardDescription>
            Discord-Rollen Berechtigungen zuordnen, Moderationsstufen festlegen und geschuetzte Rollen
            definieren.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoleEditor
            csrfToken={csrfToken}
            managedRoles={roleViews}
            discordRoles={sortedRoles.map((role) => ({ id: role.id, name: role.name, color: role.color }))}
            permissions={listPermissions().map((permission) => ({
              key: permission.key,
              label: permission.label,
              description: permission.description,
              module: permission.module,
              critical: permission.critical,
            }))}
            canEdit={canManagePermissions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Module</CardTitle>
          <CardDescription>Module aktivieren oder deaktivieren.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/modules"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            Zur Modulverwaltung
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>

      {canManageSystem ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Wartung <Badge variant="warning">system.manage</Badge>
            </CardTitle>
            <CardDescription>
              Gleicht den Datenbankzustand mit Discord ab (z.B. fehlende Jail-Rollen).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReconciliationPanel csrfToken={csrfToken} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
