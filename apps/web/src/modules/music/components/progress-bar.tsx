'use client';

import { useEffect, useState } from 'react';

const zeit = (sekunden: number): string => {
  const s = Math.max(0, Math.floor(sekunden));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${m}:${String(rest).padStart(2, '0')}`;
};

/**
 * Wiedergabefortschritt.
 *
 * Rechnet im Browser weiter, statt sekuendlich zu fragen. Der Server liefert
 * einmal die Position, danach zaehlt eine lokale Uhr - bei sechs gleichzeitig
 * geoeffneten Sessions waere ein Sekundentakt sonst reine Last ohne Nutzen.
 *
 * Bei einer Pause steht die Uhr, und ein neuer Serverwert setzt sie zurueck.
 */
export function ProgressBar({
  positionSeconds,
  durationSeconds,
  isPaused,
}: {
  positionSeconds: number;
  durationSeconds: number;
  isPaused: boolean;
}): React.JSX.Element {
  const [position, setPosition] = useState(positionSeconds);

  useEffect(() => {
    setPosition(positionSeconds);
  }, [positionSeconds]);

  useEffect(() => {
    if (isPaused) {
      return;
    }
    const uhr = setInterval(() => {
      setPosition((wert) => (durationSeconds > 0 ? Math.min(wert + 1, durationSeconds) : wert + 1));
    }, 1000);
    return () => clearInterval(uhr);
  }, [isPaused, durationSeconds]);

  const anteil = durationSeconds > 0 ? Math.min(100, (position / durationSeconds) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border/70"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={durationSeconds || 100}
        aria-valuenow={Math.floor(position)}
        aria-valuetext={`${zeit(position)} von ${durationSeconds > 0 ? zeit(durationSeconds) : 'unbekannt'}`}
        aria-label="Wiedergabefortschritt"
      >
        <div
          className="h-full rounded-full bg-accent-gradient transition-[width] duration-1000 ease-linear"
          style={{ width: `${anteil}%` }}
        />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{zeit(position)}</span>
        <span>{durationSeconds > 0 ? zeit(durationSeconds) : '–:––'}</span>
      </div>
    </div>
  );
}
