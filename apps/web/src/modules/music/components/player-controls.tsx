'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  pauseAction,
  resumeAction,
  setLoopAction,
  setVolumeAction,
  shuffleAction,
  skipAction,
  stopAction,
} from '@/modules/music/actions';

type LoopModus = 'OFF' | 'TRACK' | 'QUEUE';

export interface PlayerControlsProps {
  sessionId: string;
  csrfToken: string;
  isPaused: boolean;
  volume: number;
  maxVolume: number;
  loopMode: LoopModus;
  /** Ohne laufenden Titel gibt es nichts zu pausieren oder zu überspringen. */
  hatTitel: boolean;
  /** Wartende Titel - unter zweien gibt es nichts zu mischen. */
  wartende: number;
  darfSteuern: boolean;
}

const LOOP_REIHENFOLGE: LoopModus[] = ['OFF', 'QUEUE', 'TRACK'];
const LOOP_TITEL: Record<LoopModus, string> = {
  OFF: 'Wiederholung aus',
  QUEUE: 'Warteschlange wiederholen',
  TRACK: 'Titel wiederholen',
};

/**
 * Die Transportleiste.
 *
 * Play und Pause sind bewusst NICHT optimistisch: sie zeigen erst um, wenn
 * die Voice-Laufzeit bestaetigt hat. Ein Knopf, der sofort auf "pausiert"
 * springt, waehrend die Musik weiterlaeuft, ist schlimmer als einer, der
 * einen Moment braucht.
 *
 * Die Lautstaerke ist die Ausnahme: der Regler folgt dem Finger sofort und
 * schickt erst nach kurzer Ruhe. Sonst laege bei jedem Pixel eine Anfrage an.
 */
export function PlayerControls({
  sessionId,
  csrfToken,
  isPaused,
  volume,
  maxVolume,
  loopMode,
  hatTitel,
  wartende,
  darfSteuern,
}: PlayerControlsProps): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [, starteUebergang] = useTransition();
  const [reglerWert, setReglerWert] = useState(volume);

  // Von aussen geaenderte Lautstaerke uebernehmen - etwa wenn jemand sie
  // ueber einen Slash-Befehl gesetzt hat.
  useEffect(() => {
    setReglerWert(volume);
  }, [volume]);

  async function fuehreAus(name: string, aktion: () => Promise<{ ok: boolean; error?: { message: string } }>): Promise<void> {
    if (pending !== null) {
      return;
    }
    setPending(name);
    try {
      const antwort = await aktion();
      if (antwort.ok) {
        starteUebergang(() => router.refresh());
      } else {
        toast.error(antwort.error?.message ?? 'Die Aktion ist fehlgeschlagen.');
      }
    } finally {
      setPending(null);
    }
  }

  // Lautstaerke entprellen: erst 400 ms nach der letzten Bewegung senden.
  useEffect(() => {
    if (reglerWert === volume) {
      return;
    }
    const uhr = setTimeout(() => {
      void setVolumeAction({ csrfToken, sessionId, volume: reglerWert }).then((antwort) => {
        if (!antwort.ok) {
          toast.error(antwort.error.message);
          setReglerWert(volume);
        }
      });
    }, 400);
    return () => clearTimeout(uhr);
  }, [reglerWert, volume, csrfToken, sessionId]);

  const naechsterLoop = LOOP_REIHENFOLGE[(LOOP_REIHENFOLGE.indexOf(loopMode) + 1) % 3]!;
  const gesperrt = !darfSteuern || pending !== null;

  return (
    <div className="space-y-5">
      {/* Transport: Play gross und mittig, alles andere sekundaer. */}
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => void fuehreAus('shuffle', () => shuffleAction({ csrfToken, sessionId }))}
          disabled={gesperrt || wartende < 2}
          title="Warteschlange mischen"
          aria-label="Warteschlange mischen"
          className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {pending === 'shuffle' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Shuffle className="size-4" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() =>
            void fuehreAus('play', () =>
              isPaused
                ? resumeAction({ csrfToken, sessionId })
                : pauseAction({ csrfToken, sessionId }),
            )
          }
          disabled={gesperrt || !hatTitel}
          title={isPaused ? 'Fortsetzen' : 'Pausieren'}
          aria-label={isPaused ? 'Fortsetzen' : 'Pausieren'}
          className={cn(
            'inline-flex size-14 items-center justify-center rounded-full bg-accent-gradient text-primary-foreground shadow-[0_0_30px_-8px_hsl(var(--primary-bright))]',
            'transition-transform hover:scale-105 active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:scale-100 disabled:opacity-40 disabled:shadow-none',
          )}
        >
          {pending === 'play' ? (
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          ) : isPaused ? (
            // Optisch mittig: das Play-Dreieck wirkt sonst nach links gerückt.
            <Play className="size-6 translate-x-0.5 fill-current" aria-hidden="true" />
          ) : (
            <Pause className="size-6 fill-current" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => void fuehreAus('skip', () => skipAction({ csrfToken, sessionId }))}
          disabled={gesperrt || !hatTitel}
          title="Nächster Titel"
          aria-label="Nächster Titel"
          className="inline-flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {pending === 'skip' ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <SkipForward className="size-5 fill-current" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() =>
            void fuehreAus('loop', () => setLoopAction({ csrfToken, sessionId, mode: naechsterLoop }))
          }
          disabled={gesperrt}
          title={LOOP_TITEL[loopMode]}
          aria-label={`${LOOP_TITEL[loopMode]} - umschalten auf ${LOOP_TITEL[naechsterLoop]}`}
          className={cn(
            'inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
            loopMode === 'OFF' ? 'text-muted-foreground hover:text-foreground' : 'text-primary-bright',
          )}
        >
          {pending === 'loop' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : loopMode === 'TRACK' ? (
            <Repeat1 className="size-4" aria-hidden="true" />
          ) : (
            <Repeat className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Lautstärke und Stopp - bewusst getrennt von den Transportknöpfen,
          damit Stopp nicht versehentlich neben Play getroffen wird. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex min-w-[12rem] flex-1 items-center gap-3 text-sm">
          <span className="text-muted-foreground" aria-hidden="true">
            {reglerWert === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </span>
          <span className="sr-only">Lautstärke</span>
          <input
            type="range"
            min={0}
            max={maxVolume}
            step={5}
            value={reglerWert}
            disabled={!darfSteuern}
            onChange={(e) => setReglerWert(Number(e.target.value))}
            aria-valuetext={`${reglerWert} Prozent`}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
            {reglerWert} %
          </span>
        </label>

        <button
          type="button"
          onClick={() => void fuehreAus('stop', () => stopAction({ csrfToken, sessionId }))}
          disabled={gesperrt}
          title="Wiedergabe stoppen und Warteschlange leeren"
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {pending === 'stop' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          )}
          Stopp
        </button>
      </div>
    </div>
  );
}
