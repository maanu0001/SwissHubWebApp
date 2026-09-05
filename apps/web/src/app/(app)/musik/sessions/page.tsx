import type { Metadata } from 'next';
import { music } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { MusicSectionNav } from '@/modules/music/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { musicSections } from '@/server/music';

export const metadata: Metadata = { title: 'Musik-Sessions' };
export const dynamic = 'force-dynamic';

const LOOP_LABEL: Record<string, string> = {
  OFF: 'Aus',
  TRACK: 'Titel',
  QUEUE: 'Warteschlange',
};

/** Alle laufenden Sessions - der Ueberblick ueber den gesamten Server. */
export default async function MusikSessionsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(music.MUSIC_PERMISSIONS.sessionsViewAll);
  const [sessions, kapazitaet] = await Promise.all([music.listActiveSessions(), music.getPoolCapacity()]);

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Alle laufenden Musik-Sessions auf dem Server."
        actions={
          <Badge variant={kapazitaet.frei === 0 ? 'warning' : 'secondary'}>
            {kapazitaet.belegt} aktiv · {kapazitaet.frei} frei
          </Badge>
        }
      />
      <MusicSectionNav sections={musicSections(context)} />

      {sessions.length === 0 ? (
        <EmptyState title="Keine aktiven Sessions" description="Derzeit läuft in keinem Sprachkanal Musik." />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Laufende Musik-Sessions</caption>
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <th scope="col" className="px-5 py-3 font-semibold">
                  Sprachkanal
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Bot
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Zuhörer
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Titel
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Warteschlange
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Lautstärke
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Loop
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Seit
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((row) => (
                <tr key={row.session.id} className="border-b border-border/40 last:border-0">
                  <td className="px-5 py-3 font-medium">
                    {row.session.voiceChannelName ?? row.session.voiceChannelId}
                  </td>
                  <td className="px-5 py-3">{row.botName ?? row.botKey ?? '–'}</td>
                  <td className="px-5 py-3 tabular-nums">{row.session.listenerCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">{row.currentTitle ?? '–'}</td>
                  <td className="px-5 py-3 tabular-nums">{row.queueLength}</td>
                  <td className="px-5 py-3 tabular-nums">{row.session.volume} %</td>
                  <td className="px-5 py-3">
                    <Badge variant="outline">
                      {LOOP_LABEL[row.session.loopMode] ?? row.session.loopMode}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDateTime(row.session.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
