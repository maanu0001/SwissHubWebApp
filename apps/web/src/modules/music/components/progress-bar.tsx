'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { seekAction } from '@/modules/music/actions';

const zeit = (sekunden: number): string => {
  const s = Math.max(0, Math.floor(sekunden));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${m}:${String(rest).padStart(2, '0')}`;
};

/** Ein Sprung mit den Pfeiltasten. Fünf Sekunden, wie überall sonst. */
const TASTENSCHRITT = 5;

/**
 * Wiedergabefortschritt - und die Stelle, an der man ihn ändert.
 *
 * Rechnet im Browser weiter, statt sekuendlich zu fragen. Der Server liefert
 * einmal die Position, danach zaehlt eine lokale Uhr - bei sechs gleichzeitig
 * geoeffneten Sessions waere ein Sekundentakt sonst reine Last ohne Nutzen.
 * Bei einer Pause steht die Uhr, und ein neuer Serverwert setzt sie zurueck.
 *
 * Die Leiste sah bisher aus wie etwas, worauf man klicken kann, und war doch
 * nur eine Anzeige: wer ein zweiminuetiges Intro ueberspringen wollte, konnte
 * den Titel ueberspringen, mehr nicht. Jetzt springt ein Klick dorthin, wo er
 * hingezeigt hat.
 *
 * Der Sprung wird sofort angezeigt und erst danach bestaetigt. Das ist keine
 * Beschoenigung: scheitert er, springt die Anzeige zurueck und sagt warum.
 * Umgekehrt - erst warten, dann anzeigen - fuehlte sich die Leiste an, als
 * haette der Klick nicht gezaehlt.
 */
export function ProgressBar({
  positionSeconds,
  durationSeconds,
  isPaused,
  sessionId,
  csrfToken,
  darfSpringen,
}: {
  positionSeconds: number;
  durationSeconds: number;
  isPaused: boolean;
  sessionId: string;
  csrfToken: string;
  /** Ohne Steuerrecht bleibt die Leiste, was sie war: eine Anzeige. */
  darfSpringen: boolean;
}): React.JSX.Element {
  const [position, setPosition] = useState(positionSeconds);
  const [pending, setPending] = useState(false);
  const leiste = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPosition(positionSeconds);
  }, [positionSeconds]);

  useEffect(() => {
    if (isPaused || pending) {
      return;
    }
    const uhr = setInterval(() => {
      setPosition((wert) => (durationSeconds > 0 ? Math.min(wert + 1, durationSeconds) : wert + 1));
    }, 1000);
    return () => clearInterval(uhr);
  }, [isPaused, durationSeconds, pending]);

  // Ohne bekannte Laenge gibt es keine Strecke, auf der sich zielen liesse -
  // bei einem Livestream etwa. Dann bleibt die Leiste eine Anzeige.
  const springbar = darfSpringen && durationSeconds > 0;

  const springe = async (ziel: number): Promise<void> => {
    if (!springbar || pending) {
      return;
    }
    const gerundet = Math.max(0, Math.min(Math.round(ziel), Math.max(0, durationSeconds - 1)));
    const vorher = position;
    setPosition(gerundet);
    setPending(true);
    try {
      const ergebnis = await seekAction({ csrfToken, sessionId, positionSeconds: gerundet });
      if (!ergebnis.ok) {
        setPosition(vorher);
        toast.error(ergebnis.error?.message ?? 'Der Sprung hat nicht geklappt.');
      }
    } finally {
      setPending(false);
    }
  };

  const ausKlick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rahmen = leiste.current?.getBoundingClientRect();
    if (!rahmen || rahmen.width === 0) {
      return;
    }
    const anteil = (event.clientX - rahmen.left) / rahmen.width;
    void springe(Math.min(1, Math.max(0, anteil)) * durationSeconds);
  };

  const ausTaste = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      void springe(position + (event.key === 'ArrowRight' ? TASTENSCHRITT : -TASTENSCHRITT));
    } else if (event.key === 'Home') {
      event.preventDefault();
      void springe(0);
    }
  };

  const anteil = durationSeconds > 0 ? Math.min(100, (position / durationSeconds) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div
        ref={leiste}
        // `slider` statt `progressbar`, sobald sich etwas einstellen lässt:
        // eine Fortschrittsanzeige ist per Definition nicht bedienbar, und
        // ein Screenreader würde die Tastenbedienung sonst nicht ankündigen.
        role={springbar ? 'slider' : 'progressbar'}
        aria-valuemin={0}
        aria-valuemax={durationSeconds || 100}
        aria-valuenow={Math.floor(position)}
        aria-valuetext={`${zeit(position)} von ${durationSeconds > 0 ? zeit(durationSeconds) : 'unbekannt'}`}
        aria-label={springbar ? 'Wiedergabeposition' : 'Wiedergabefortschritt'}
        {...(springbar
          ? {
              tabIndex: 0,
              onClick: ausKlick,
              onKeyDown: ausTaste,
              'aria-disabled': pending,
            }
          : {})}
        className={springbar ? 'group -my-2 cursor-pointer py-2 focus-visible:outline-none' : undefined}
      >
        <div className="h-1.5 overflow-hidden rounded-full bg-border/70 group-focus-visible:ring-2 group-focus-visible:ring-ring">
          <div
            className={
              pending
                ? 'h-full rounded-full bg-accent-gradient'
                : 'h-full rounded-full bg-accent-gradient transition-[width] duration-1000 ease-linear'
            }
            style={{ width: `${anteil}%` }}
          />
        </div>
      </div>
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{zeit(position)}</span>
        <span>{durationSeconds > 0 ? zeit(durationSeconds) : '–:––'}</span>
      </div>
    </div>
  );
}
