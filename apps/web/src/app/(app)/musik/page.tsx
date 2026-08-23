import type { Metadata } from 'next';
import { Headphones, Radio } from 'lucide-react';
import { isModuleEnabled, music } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { MusicSectionNav } from '@/modules/music/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { getMusicViewerContext, musicSections } from '@/server/music';

export const metadata: Metadata = { title: 'Musik' };
export const dynamic = 'force-dynamic';

/**
 * Der Musikplayer.
 *
 * Zeigt die Session des Sprachkanals, in dem die aufrufende Person gerade
 * sitzt - sie waehlt keine Session aus einer Liste, sondern der Kanal, in dem
 * sie steht, ist die Antwort.
 */
export default async function MusikPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(music.MUSIC_PERMISSIONS.view);

  if (!(await isModuleEnabled(music.MUSIC_MODULE_ID))) {
    return (
      <EmptyState
        title="Das Musik-Modul ist ausgeschaltet"
        description="Ein Mitglied der Verwaltung kann es unter Module einschalten."
      />
    );
  }

  const [betrachter, kapazitaet] = await Promise.all([
    getMusicViewerContext(context),
    music.getPoolCapacity(),
  ]);

  const zustand = betrachter.sessionId ? await music.getPlayerState(betrachter.sessionId) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MusicSectionNav sections={musicSections(context)} />
        <Badge variant={kapazitaet.frei === 0 ? 'warning' : 'secondary'}>
          {kapazitaet.frei} von {kapazitaet.verfuegbar} Bots frei
        </Badge>
      </div>

      {betrachter.voice === null ? (
        <EmptyState
          title="Du bist aktuell in keinem Discord Voice-Channel"
          description="Tritt einem Sprachkanal auf SwissHub bei - der Player richtet sich dann automatisch darauf aus."
        />
      ) : zustand === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="size-4 text-primary-bright" aria-hidden="true" />
              {betrachter.voice.channelName ?? 'Dein Sprachkanal'}
            </CardTitle>
            <CardDescription>In diesem Kanal läuft derzeit keine Musik-Session.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Keine Musik-Session aktiv"
              description={
                kapazitaet.frei === 0
                  ? 'Alle Musik-Bots sind momentan belegt.'
                  : 'Starte eine Session, um Musik zu suchen und abzuspielen.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Headphones className="size-4 text-primary-bright" aria-hidden="true" />
              {zustand.session.voiceChannelName ?? betrachter.voice.channelName ?? 'Session'}
            </CardTitle>
            <CardDescription>
              {zustand.bot?.name ?? zustand.bot?.key ?? 'Musik-Bot'} ·{' '}
              {zustand.botErreichbar ? 'verbunden' : 'antwortet nicht'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {zustand.currentItem ? (
              <div>
                <p className="text-lg font-semibold">{zustand.currentItem.title}</p>
                {zustand.currentItem.artist ? (
                  <p className="text-sm text-muted-foreground">{zustand.currentItem.artist}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Derzeit läuft kein Titel.</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Lautstärke {zustand.session.volume} %</Badge>
              <Badge variant="outline">
                {zustand.session.loopMode === 'OFF'
                  ? 'Keine Wiederholung'
                  : zustand.session.loopMode === 'TRACK'
                    ? 'Titel wiederholen'
                    : 'Warteschlange wiederholen'}
              </Badge>
              <Badge variant="outline">{zustand.queue.length} in der Warteschlange</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
