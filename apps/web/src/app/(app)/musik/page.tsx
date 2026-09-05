import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, Music, Radio, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, music } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { MusicSectionNav } from '@/modules/music/components/section-nav';
import { LiveSession } from '@/modules/music/components/live-session';
import { PlayerControls } from '@/modules/music/components/player-controls';
import { ProgressBar } from '@/modules/music/components/progress-bar';
import { QueueList } from '@/modules/music/components/queue-list';
import { SearchPanel } from '@/modules/music/components/search-panel';
import { StartSessionButton } from '@/modules/music/components/start-session-button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { getMusicViewerContext, musicSections } from '@/server/music';

export const metadata: Metadata = { title: 'Musik' };
export const dynamic = 'force-dynamic';

/**
 * Der Musikplayer.
 *
 * Richtet sich auf den Sprachkanal, in dem die aufrufende Person gerade
 * sitzt - sie waehlt keine Session aus einer Liste. Welcher Bot dahinter
 * steckt, ist Infrastruktur und steht klein in der Kopfzeile, nicht im
 * Mittelpunkt.
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

  const [betrachter, kapazitaet, einstellungen] = await Promise.all([
    getMusicViewerContext(context),
    music.getPoolCapacity(),
    music.getMusicSettings(),
  ]);

  const zustand = betrachter.sessionId ? await music.getPlayerState(betrachter.sessionId) : null;
  const csrfToken = csrfTokenFor(context);
  const darfVerwalten = can(context, music.MUSIC_PERMISSIONS.queueManage) && betrachter.darfSteuern;

  const kopf = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MusicSectionNav sections={musicSections(context)} />
      <Badge variant={kapazitaet.frei === 0 ? 'warning' : 'secondary'}>
        {kapazitaet.frei} von {kapazitaet.verfuegbar} Bots frei
      </Badge>
    </div>
  );

  if (betrachter.voice === null) {
    return (
      <>
        {kopf}
        <EmptyState
          title="Du bist aktuell in keinem Discord Voice-Channel"
          description="Tritt einem Sprachkanal auf SwissHub bei - der Player richtet sich dann automatisch darauf aus."
        />
      </>
    );
  }

  if (zustand === null) {
    return (
      <>
        {kopf}
        <div className="rounded-2xl border border-border bg-card/40 p-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Radio className="size-6 text-primary-bright" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">{betrachter.voice.channelName ?? 'Dein Sprachkanal'}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {kapazitaet.frei === 0
              ? 'Alle Musik-Bots sind momentan belegt. Sobald einer frei wird, kannst du starten.'
              : 'In diesem Kanal läuft noch keine Musik. Hol dir einen Bot und leg los.'}
          </p>
          <div className="mt-5 flex justify-center">
            <StartSessionButton
              csrfToken={csrfToken}
              deaktiviert={!betrachter.darfStarten || kapazitaet.frei === 0}
            />
          </div>
        </div>
      </>
    );
  }

  const titel = zustand.currentItem;

  return (
    <>
      {kopf}

      {!zustand.botErreichbar ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Der Musik-Bot antwortet derzeit nicht. Die Anzeige kann veraltet sein.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Jetzt läuft */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Radio className="size-3.5 text-primary-bright" aria-hidden="true" />
              {zustand.session.voiceChannelName ?? betrachter.voice.channelName}
            </span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden="true" />
                {zustand.session.listenerCount}
              </span>
              <span>{zustand.bot?.name ?? zustand.bot?.key ?? 'Bot'}</span>
              <LiveSession sessionId={zustand.session.id} />
            </span>
          </div>

          <div className="space-y-6 p-5 sm:p-8">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-end">
              {titel?.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- fremde CDN-Adresse, kein Loader
                <img
                  src={titel.thumbnailUrl}
                  alt=""
                  width={176}
                  height={176}
                  className="size-40 rounded-2xl object-cover shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] sm:size-44"
                />
              ) : (
                <div
                  className="flex size-40 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-card sm:size-44"
                  aria-hidden="true"
                >
                  <Music className="size-12 text-primary-bright/60" />
                </div>
              )}

              <div className="min-w-0 flex-1 text-center sm:text-left">
                {titel ? (
                  <>
                    <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                      {titel.title}
                    </h2>
                    <p className="mt-1 truncate text-muted-foreground">
                      {titel.artist ?? 'Unbekannter Interpret'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground sm:justify-start">
                      {titel.requestedByDiscordUserId ? (
                        <span className="flex items-center gap-1.5">
                          <DiscordAvatar
                            discordId={titel.requestedByDiscordUserId}
                            avatarHash={null}
                            name={titel.requestedByUsername ?? 'Mitglied'}
                            size={20}
                          />
                          @{titel.requestedByUsername ?? 'Mitglied'}
                        </span>
                      ) : null}
                      <a
                        href={titel.webpageUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                      >
                        Auf YouTube öffnen
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-semibold tracking-tight">Nichts läuft gerade</h2>
                    <p className="mt-1 text-muted-foreground">Such dir unten einen Titel und leg los.</p>
                  </>
                )}
              </div>
            </div>

            <ProgressBar
              positionSeconds={zustand.positionSeconds}
              durationSeconds={titel?.durationSeconds ?? 0}
              isPaused={zustand.isPaused}
              sessionId={zustand.session.id}
              csrfToken={csrfToken}
              darfSpringen={betrachter.darfSteuern && can(context, music.MUSIC_PERMISSIONS.skip)}
            />

            <PlayerControls
              sessionId={zustand.session.id}
              csrfToken={csrfToken}
              isPaused={zustand.isPaused}
              volume={zustand.session.volume}
              maxVolume={einstellungen.maxVolume}
              loopMode={zustand.session.loopMode}
              hatTitel={titel !== null}
              wartende={zustand.queue.length}
              darfSteuern={betrachter.darfSteuern}
            />
          </div>
        </section>

        {/* Suche und Warteschlange */}
        <aside className="min-w-0 space-y-4">
          <SearchPanel
            sessionId={zustand.session.id}
            csrfToken={csrfToken}
            darfSteuern={betrachter.darfSteuern}
          />

          <section className="rounded-2xl border border-border bg-card/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Warteschlange</h2>
              <span className="text-xs text-muted-foreground">{zustand.queue.length}</span>
            </div>
            <QueueList
              sessionId={zustand.session.id}
              csrfToken={csrfToken}
              eintraege={zustand.queue.map((eintrag) => ({
                id: eintrag.id,
                title: eintrag.title,
                artist: eintrag.artist,
                durationSeconds: eintrag.durationSeconds,
                thumbnailUrl: eintrag.thumbnailUrl,
                requestedByUsername: eintrag.requestedByUsername,
                unavailable: eintrag.unavailable,
              }))}
              darfVerwalten={darfVerwalten}
            />
          </section>

          {betrachter.darfSteuern ? (
            <Link
              href="/musik/verlauf"
              className="block rounded-xl border border-border px-4 py-2.5 text-center text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              Zuletzt gespielt ansehen
            </Link>
          ) : null}
        </aside>
      </div>
    </>
  );
}
