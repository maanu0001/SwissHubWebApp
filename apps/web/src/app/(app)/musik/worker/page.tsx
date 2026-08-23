import type { Metadata } from 'next';
import { music } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { MusicSectionNav } from '@/modules/music/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { musicSections } from '@/server/music';

export const metadata: Metadata = { title: 'Musik-Bots' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  OFFLINE: 'Offline',
  FREE: 'Frei',
  BUSY: 'Belegt',
  CONNECTING: 'Verbindet',
  DEGRADED: 'Gestört',
  DRAINING: 'Wird entleert',
  DISABLED: 'Deaktiviert',
};

function statusVariante(status: string, erreichbar: boolean): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (!erreichbar) return 'destructive';
  if (status === 'FREE') return 'success';
  if (status === 'BUSY' || status === 'CONNECTING') return 'secondary';
  return 'warning';
}

/**
 * Der Bot-Pool.
 *
 * Zeigt ausdruecklich keinen Token und keine Moeglichkeit, einen einzugeben:
 * die Tokens liegen in der Umgebung der Voice-Laufzeit. Was hier steht, ist
 * der Zustand, den die Laufzeit selbst meldet.
 */
export default async function MusikWorkerPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(music.MUSIC_PERMISSIONS.workersView);
  const [bots, kapazitaet] = await Promise.all([music.listBots(), music.getPoolCapacity()]);

  return (
    <>
      <PageHeader
        title="Musik-Bots"
        description="Controller und Worker des Pools mit ihrem gemeldeten Zustand."
        actions={
          <Badge variant={kapazitaet.frei === 0 ? 'warning' : 'secondary'}>
            {kapazitaet.verfuegbar} erreichbar · {kapazitaet.frei} frei
          </Badge>
        }
      />
      <MusicSectionNav sections={musicSections(context)} />

      {kapazitaet.frei === 0 && kapazitaet.verfuegbar > 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          Alle Musik-Bots sind aktuell belegt. Eine neue Session lässt sich erst starten, wenn eine
          bestehende endet.
        </p>
      ) : null}

      {bots.length === 0 ? (
        <EmptyState
          title="Kein Musik-Bot konfiguriert"
          description="Die Voice-Laufzeit meldet ihre Bots selbst an, sobald sie läuft."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => (
            <Card key={bot.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center gap-3">
                  {bot.discordUserId ? (
                    <DiscordAvatar
                      discordId={bot.discordUserId}
                      avatarHash={bot.avatarHash}
                      name={bot.name ?? bot.key}
                      size={40}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{bot.name ?? bot.key}</p>
                    <p className="text-xs text-muted-foreground">
                      {bot.type === 'CONTROLLER' ? 'Controller' : 'Worker'} · {bot.key}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariante(bot.status, bot.erreichbar)}>
                    {bot.erreichbar ? (STATUS_LABEL[bot.status] ?? bot.status) : 'Nicht erreichbar'}
                  </Badge>
                  {!bot.enabled ? <Badge variant="outline">Abgeschaltet</Badge> : null}
                </div>

                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Session</dt>
                    <dd className="truncate">{bot.voiceChannelName ?? '–'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Letztes Lebenszeichen</dt>
                    <dd>{bot.lastHeartbeatAt ? formatDateTime(bot.lastHeartbeatAt) : 'nie'}</dd>
                  </div>
                </dl>

                {bot.lastError ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">
                    {bot.lastError}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
