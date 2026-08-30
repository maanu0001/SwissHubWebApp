import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { listDeprecatedEnvKeys } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { getCoreSettings, getGuildConfig, getSystemHealth } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/shared/states';
import { CoreSettingsForm } from '@/modules/settings/components/core-settings-form';
import { ReconciliationPanel } from '@/modules/settings/components/reconciliation-panel';
import { SetupProgress } from '@/modules/configuration/components/setup-progress';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Einstellungen' };
export const dynamic = 'force-dynamic';

const SHORTCUTS = [
  {
    href: '/server',
    label: 'Server-Übersicht',
    description: 'Verbundener Discord-Server und Einrichtungsstand.',
  },
  {
    href: '/server/permissions',
    label: 'Berechtigungen',
    description: 'Welche Discord-Rolle im Dashboard was darf.',
  },
  { href: '/modules', label: 'Module', description: 'Module aktivieren und ihre Einstellungen pflegen.' },
  {
    href: '/system/discord',
    label: 'Discord-Sync',
    description: 'Rollen und Channels mit Discord abgleichen.',
  },
  { href: '/system/bot', label: 'Bot', description: 'Verbindung und Discord-Berechtigungen des Bots.' },
  {
    href: '/system/log-kanaele',
    label: 'Discord-Log-Kanäle',
    description: 'Welche Log-Kategorie in welchen Discord-Kanal ausgegeben wird.',
  },
];

/**
 * Systemeinstellungen.
 *
 * Enthält nur noch die anwendungsweiten Werte - Server, Rollen, Module und
 * deren Einstellungen haben eigene Bereiche und werden hier verlinkt.
 */
export default async function SettingsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('settings.view');
  const csrfToken = csrfTokenFor(context);

  const canEditSettings = can(context, 'settings.edit');
  const canManageSystem = can(context, 'system.manage');

  const [coreSettings, options, guild, health] = await Promise.all([
    getCoreSettings(),
    loadDiscordOptions(),
    getGuildConfig(),
    getSystemHealth(),
  ]);

  const deprecated = listDeprecatedEnvKeys();

  return (
    <>
      {guild.guildId === null ? (
        <ErrorState
          title="Kein Discord-Server verbunden"
          description="Bitte zuerst den Einrichtungsassistenten unter /setup abschliessen."
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Einrichtungsstand</CardTitle>
          <CardDescription>Was noch fehlt, damit alle Funktionen einsatzbereit sind.</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupProgress completeness={health.completeness} steps={health.steps} />
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
            channels={options.channels.filter((channel) => channel.kind === 'text')}
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
          <CardTitle>Weitere Bereiche</CardTitle>
          <CardDescription>
            Konfiguration liegt vollständig in der Datenbank und wird hier im Dashboard gepflegt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.href}>
                <Link
                  href={shortcut.href}
                  className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{shortcut.label}</span>
                    <span className="block text-xs text-muted-foreground">{shortcut.description}</span>
                  </span>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Umgebungsvariablen</CardTitle>
          <CardDescription>
            Nur Infrastruktur-Secrets gehören noch in die <code>.env</code>. Alles andere wird hier
            konfiguriert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">DATABASE_URL</Badge>
            <Badge variant="outline">AUTH_SECRET</Badge>
            <Badge variant="outline">DISCORD_BOT_TOKEN</Badge>
            <Badge variant="outline">DISCORD_CLIENT_ID</Badge>
            <Badge variant="outline">DISCORD_CLIENT_SECRET</Badge>
            <Badge variant="outline">NEXT_PUBLIC_APP_URL</Badge>
          </div>
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Bot Token und Client Secret sind bewusst nicht über die Oberfläche bearbeitbar. Sie werden nur
            serverseitig gelesen und tauchen weder in Antworten noch im Audit Log auf.
          </p>

          {deprecated.length > 0 ? (
            <div className="space-y-1.5 rounded-md border border-border px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Abgelöste Variablen
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {deprecated.map((entry) => (
                  <li key={entry.key}>
                    <code>{entry.key}</code> – {entry.replacement}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Sie wurden in die Datenbank übernommen und können aus der <code>.env</code> entfernt werden.
              </p>
            </div>
          ) : null}
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
