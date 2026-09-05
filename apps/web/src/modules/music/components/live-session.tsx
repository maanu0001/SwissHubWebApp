'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Radio, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Haelt den Player auf dem Laufenden.
 *
 * Der Strom traegt bewusst nur die Kennzeichen einer Aenderung, nicht den
 * ganzen Zustand: was angezeigt wird, rendert der Server ohnehin schon, und
 * zwei Wege zu denselben Daten driften auseinander. Meldet der Strom eine
 * Aenderung, wird die Seite aufgefrischt - das ist eine Stelle statt zweier.
 *
 * Die Anzeige unten sagt ehrlich, woran man ist: verbunden, getrennt, oder
 * Session beendet. Ein stiller Ausfall waere schlimmer als ein sichtbarer.
 */
type Verbindung = 'verbindet' | 'live' | 'getrennt' | 'beendet';

export function LiveSession({ sessionId }: { sessionId: string }): React.JSX.Element {
  const router = useRouter();
  const [verbindung, setVerbindung] = useState<Verbindung>('verbindet');
  // Ohne diese Sperre löst ein Schwall von Ereignissen ebenso viele
  // Aktualisierungen aus - der Server rendert dann mehrfach dasselbe.
  const laeuft = useRef(false);

  useEffect(() => {
    let quelle: EventSource | null = null;
    let neuVersuch: ReturnType<typeof setTimeout> | null = null;
    let beendet = false;

    const verbinde = (): void => {
      if (beendet) {
        return;
      }
      quelle = new EventSource(`/api/music/stream?sessionId=${encodeURIComponent(sessionId)}`);

      quelle.onopen = () => setVerbindung('live');

      quelle.addEventListener('zustand', () => {
        setVerbindung('live');
        if (laeuft.current) {
          return;
        }
        laeuft.current = true;
        // Kurz sammeln: mehrere Änderungen kurz nacheinander sind eine.
        setTimeout(() => {
          laeuft.current = false;
          router.refresh();
        }, 250);
      });

      quelle.addEventListener('beendet', () => {
        setVerbindung('beendet');
        beendet = true;
        quelle?.close();
        router.refresh();
      });

      quelle.addEventListener('neuverbinden', () => {
        // Der Server beendet lange Verbindungen bewusst - erneut anmelden,
        // damit auch die Berechtigung wieder geprüft wird.
        quelle?.close();
        quelle = null;
        neuVersuch = setTimeout(verbinde, 500);
      });

      quelle.onerror = () => {
        setVerbindung('getrennt');
        quelle?.close();
        quelle = null;
        if (!beendet) {
          // EventSource verbindet zwar selbst neu, aber nicht nach einem
          // geschlossenen Strom. Also selbst, mit Abstand.
          neuVersuch = setTimeout(verbinde, 3_000);
        }
      };
    };

    verbinde();

    return () => {
      beendet = true;
      if (neuVersuch) {
        clearTimeout(neuVersuch);
      }
      quelle?.close();
    };
  }, [sessionId, router]);

  const text: Record<Verbindung, string> = {
    verbindet: 'Verbindet…',
    live: 'Live',
    getrennt: 'Verbindung unterbrochen',
    beendet: 'Session beendet',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        verbindung === 'live' ? 'text-muted-foreground' : 'text-warning',
      )}
      // Statusänderungen werden vorgelesen, ohne den Fokus zu stehlen.
      role="status"
      aria-live="polite"
    >
      {verbindung === 'getrennt' || verbindung === 'beendet' ? (
        <WifiOff className="size-3" aria-hidden="true" />
      ) : (
        <Radio className={cn('size-3', verbindung === 'live' && 'text-primary-bright')} aria-hidden="true" />
      )}
      {text[verbindung]}
    </span>
  );
}
