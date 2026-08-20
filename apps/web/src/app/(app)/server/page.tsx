import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, Hash, RefreshCw, Shield, Users } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { guildIconUrl } from '@swisshub/discord/cdn';
import { getGuildConfig, getSyncStatus, getSystemHealth } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/shared/stat-card';
import { SetupProgress } from '@/modules/configuration/components/setup-progress';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Server' };
export const dynamic = 'force-dynamic';

/** Übersicht des verbundenen Discord-Servers inklusive Einrichtungsfortschritt. */
export default async function ServerOverviewPage(): Promise<React.JSX.Element> {
  await requirePagePermission('settings.view');

  const [guild, sync, health] = await Promise.all([getGuildConfig(), getSyncStatus(), getSystemHealth()]);

  if (!guild.guildId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kein Server verbunden</CardTitle>
          <CardDescription>Es ist noch kein Discord-Server mit dieser Anwendung verbunden.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/setup" className="text-sm font-medium text-primary hover:underline">
            Einrichtung starten
          </Link>
        </CardContent>
      </Card>
    );
  }

  const iconUrl = guildIconUrl(guild.guildId, guild.iconHash, 128);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconUrl}
                alt=""
                className="size-14 rounded-xl border border-border"
                width={56}
                height={56}
              />
            ) : (
              <span className="flex size-14 items-center justify-center rounded-xl border border-border text-lg font-semibold">
                {(guild.name ?? branding.name).slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <CardTitle>{guild.name ?? 'Unbenannter Server'}</CardTitle>
              <CardDescription className="font-mono text-xs">{guild.guildId}</CardDescription>
            </div>
            <Link
              href={`https://discord.com/channels/${guild.guildId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Auf Discord öffnen
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {guild.fromBootstrapEnv ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Dieser Server stammt noch aus der Umgebungsvariable <code>DISCORD_GUILD_ID</code>. Er wird
                beim nächsten Start des Bots in die Datenbank übernommen.
              </span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Mitglieder" value={guild.memberCount ?? '–'} icon={<Users />} />
        <StatCard label="Rollen" value={sync.roles} icon={<Shield />} />
        <StatCard label="Channels" value={sync.channels} icon={<Hash />} />
        <StatCard
          label="Letzter Abgleich"
          value={sync.lastSyncedAt ? formatDateTime(sync.lastSyncedAt) : 'nie'}
          icon={<RefreshCw />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Einrichtung</CardTitle>
          <CardDescription>
            Was noch fehlt, damit alle Funktionen einsatzbereit sind. Jeder Punkt führt direkt zur passenden
            Stelle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetupProgress completeness={health.completeness} steps={health.steps} />
        </CardContent>
      </Card>
    </>
  );
}
