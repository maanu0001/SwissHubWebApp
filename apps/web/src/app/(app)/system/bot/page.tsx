import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { discordConfig } from '@swisshub/config';
import { getGuildConfig, inspectBotPermissions, readBotStatus } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/shared/stat-card';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Bot' };
export const dynamic = 'force-dynamic';

/**
 * Bot-Status und Berechtigungsprüfung.
 *
 * Beantwortet die Frage "darf der Bot alles, was die aktivierten Module
 * brauchen?" - inklusive Einladungslink mit exakt den fehlenden Rechten.
 */
export default async function BotSystemPage(): Promise<React.JSX.Element> {
  await requirePagePermission('settings.view', { allowDuringSetup: true });

  const [status, report, guild] = await Promise.all([
    readBotStatus(),
    inspectBotPermissions().catch(() => null),
    getGuildConfig(),
  ]);

  const inviteUrl = guild.guildId
    ? `https://discord.com/oauth2/authorize?client_id=${discordConfig.clientId}&scope=bot%20applications.commands&permissions=268438528&guild_id=${guild.guildId}`
    : null;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Verbindung"
          value={status.online ? 'Online' : 'Offline'}
          tone={status.online ? 'success' : 'destructive'}
          hint={
            status.lastHeartbeatAt ? `Heartbeat ${formatDateTime(status.lastHeartbeatAt)}` : 'kein Heartbeat'
          }
        />
        <StatCard label="Ping" value={status.wsPingMs !== null ? `${status.wsPingMs} ms` : '–'} />
        <StatCard label="Bot-Konto" value={report?.botUsername ?? status.botUsername ?? '–'} />
        <StatCard
          label="Rollenposition"
          value={report?.botHighestPosition ?? 0}
          hint={report?.botRoleName ?? 'keine eigene Rolle'}
          tone={report && report.botHighestPosition > 0 ? 'default' : 'warning'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Moderationsabgleich mit Discord</CardTitle>
          <CardDescription>
            Massnahmen, die jemand direkt in der Discord-App ergreift, landen nur dann in der Akte, wenn der
            Bot Discords Audit-Log lesen darf. Ohne dieses Recht läuft alles Übrige weiter - die
            Moderationshistorie bleibt aber unvollständig.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            Drei Zustände, nicht zwei. «Noch nicht geprüft» ist keine
            Beanstandung: nach einem Neustart dauert es bis zum ersten
            Prüflauf, und ein rotes Feld wäre dann schlicht falsch.
          */}
          {status.auditLogAccess === null ? (
            <p className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Noch nicht geprüft. Der Bot prüft das nach dem Start und danach regelmässig.
            </p>
          ) : status.auditLogAccess ? (
            <p className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>
                Massnahmen aus Discord werden erkannt.
                {status.auditLogCheckedAt
                  ? ` Zuletzt geprüft ${formatDateTime(status.auditLogCheckedAt)}.`
                  : ''}
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Moderationsaktionen direkt aus Discord können aktuell nicht erkannt werden, weil dem Bot die
                Berechtigung <strong>Audit-Log anzeigen</strong> fehlt. Banns und Timeouts landen dann ohne
                Moderator und ohne Grund in der Akte; Kicks gar nicht, weil sie sich ohne Audit-Eintrag nicht
                von einem freiwilligen Austritt unterscheiden lassen.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discord-Berechtigungen</CardTitle>
          <CardDescription>
            Geprüft wird gegen die Anforderungen der aktivierten Module. Fehlende Rechte müssen auf Discord
            vergeben werden - über die Bot-Rolle oder eine neue Einladung.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!report?.available ? (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Die Berechtigungen des Bots konnten nicht ermittelt werden. Ist der Bot Mitglied des verbundenen
              Servers und wurde bereits ein Discord-Abgleich ausgeführt?
            </p>
          ) : (
            <>
              {report.isAdministrator ? (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Der Bot besitzt <strong>Administrator</strong>. Das schliesst alle Rechte ein, ist aber mehr
                  als nötig - für den Produktivbetrieb sind gezielte Berechtigungen sicherer.
                </p>
              ) : null}

              <ul className="grid gap-2 sm:grid-cols-2">
                {report.checks.map((check) => (
                  <li
                    key={check.permission}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      check.granted
                        ? 'border-border'
                        : 'border-destructive/40 bg-destructive/5 text-destructive'
                    }`}
                  >
                    {check.granted ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{check.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Benötigt von:{' '}
                        {check.requiredBy
                          .map((entry) => (entry === 'core' ? 'Grundfunktionen' : entry))
                          .join(', ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              {report.missing.length > 0 ? (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                  <p className="text-sm font-medium text-destructive">
                    {report.missing.length} Berechtigung(en) fehlen
                  </p>
                  {inviteUrl ? (
                    <Link
                      href={inviteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      Bot mit vollständigen Rechten neu einladen
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Alle benötigten Berechtigungen sind vorhanden.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zugangsdaten</CardTitle>
          <CardDescription>
            Bot Token und Client Secret werden ausschliesslich als Umgebungsvariablen gesetzt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sie sind bewusst nicht über das Dashboard bearbeitbar: ein Token, das im Browser bearbeitet werden
            kann, taucht früher oder später in einem Formular, einer Antwort oder einem Log auf. Die Anwendung
            liest sie nur serverseitig und gibt sie nie aus.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">DISCORD_BOT_TOKEN</Badge>
            <Badge variant="outline">DISCORD_CLIENT_SECRET</Badge>
            <Badge variant="outline">AUTH_SECRET</Badge>
            <Badge variant="outline">DATABASE_URL</Badge>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
