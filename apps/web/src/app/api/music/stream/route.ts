import { music } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { getActionAuthContext } from '@/server/auth';
import { darfSessionSteuern } from '@/server/music';

const log = createLogger('web:music-stream');

/**
 * Live-Zustand einer Musik-Session.
 *
 * Server-Sent Events statt WebSockets: der Strom laeuft nur in eine Richtung -
 * Befehle gehen ueber die bestehenden Aktionen. Eine WebSocket-Verbindung
 * braeuchte eigene Infrastruktur, Wiederverbindung und einen zweiten Weg
 * durch nginx; SSE ist gewoehnliches HTTP und der Browser verbindet von
 * selbst neu.
 *
 * Gesendet wird nur, was sich wirklich geaendert hat. Der Fingerabdruck
 * unten entscheidet das - sonst schoebe der Strom sekuendlich denselben
 * Zustand ueber die Leitung und die Oberflaeche zeichnete sich grundlos neu.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Wie oft die Datenbank gefragt wird. */
const INTERVALL_MS = 2_000;
/** Lebenszeichen gegen Proxys, die stille Verbindungen schliessen. */
const HERZSCHLAG_MS = 20_000;
/**
 * Nach dieser Zeit endet der Strom von selbst.
 *
 * Der Browser verbindet danach neu. Das begrenzt, wie lange eine einmal
 * erteilte Berechtigung nachwirkt: wer die Rolle verliert, ist spaetestens
 * beim naechsten Verbindungsaufbau draussen.
 */
const HOECHSTDAUER_MS = 15 * 60_000;

/** Was sich geaendert haben muss, damit es die Oberflaeche erfaehrt. */
function fingerabdruck(zustand: Awaited<ReturnType<typeof music.getPlayerState>>): string {
  if (!zustand) {
    return 'ende';
  }
  return [
    zustand.session.status,
    zustand.session.currentItemId ?? '-',
    zustand.session.volume,
    zustand.session.loopMode,
    zustand.session.listenerCount,
    zustand.isPaused ? 'pause' : 'play',
    zustand.botErreichbar ? 'da' : 'weg',
    zustand.queue.length,
    // Reihenfolge und Inhalt der Warteschlange, nicht nur ihre Laenge.
    zustand.queue.map((eintrag) => eintrag.id).join(','),
    zustand.session.trackStartedAt?.getTime() ?? 0,
  ].join('|');
}

export async function GET(request: Request): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new Response(null, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
  if (!/^c[a-z0-9]{20,}$/u.test(sessionId)) {
    return new Response(null, { status: 400 });
  }

  // Dieselbe Pruefung wie bei jeder Aktion. Eine Session-ID im Adressfeld
  // sagt nichts darueber aus, ob sie jemanden etwas angeht.
  if (!(await darfSessionSteuern(context, sessionId))) {
    return new Response(null, { status: 403 });
  }

  const kodierer = new TextEncoder();

  const strom = new ReadableStream<Uint8Array>({
    async start(steuerung) {
      let offen = true;
      let letzter = '';
      let letzterHerzschlag = Date.now();

      const schliessen = (): void => {
        if (!offen) {
          return;
        }
        offen = false;
        clearInterval(uhr);
        try {
          steuerung.close();
        } catch {
          // Der Browser war schneller - nichts zu tun.
        }
      };

      const senden = (ereignis: string, daten: unknown): void => {
        if (!offen) {
          return;
        }
        try {
          steuerung.enqueue(kodierer.encode(`event: ${ereignis}\ndata: ${JSON.stringify(daten)}\n\n`));
        } catch {
          schliessen();
        }
      };

      const start = Date.now();

      const pruefen = async (): Promise<void> => {
        if (!offen) {
          return;
        }
        if (Date.now() - start > HOECHSTDAUER_MS) {
          // Der Browser verbindet von selbst neu und wird dabei erneut geprueft.
          senden('neuverbinden', {});
          schliessen();
          return;
        }

        try {
          const zustand = await music.getPlayerState(sessionId);
          const jetzt = fingerabdruck(zustand);

          if (jetzt !== letzter) {
            letzter = jetzt;
            letzterHerzschlag = Date.now();

            if (!zustand || zustand.session.endedAt) {
              senden('beendet', {});
              schliessen();
              return;
            }
            senden('zustand', {
              status: zustand.session.status,
              volume: zustand.session.volume,
              loopMode: zustand.session.loopMode,
              listenerCount: zustand.session.listenerCount,
              isPaused: zustand.isPaused,
              botErreichbar: zustand.botErreichbar,
              positionSeconds: zustand.positionSeconds,
              currentItemId: zustand.session.currentItemId,
              queueIds: zustand.queue.map((eintrag) => eintrag.id),
            });
            return;
          }

          if (Date.now() - letzterHerzschlag > HERZSCHLAG_MS) {
            letzterHerzschlag = Date.now();
            // Ein Kommentar - der Browser sieht ihn nicht, der Proxy schon.
            steuerung.enqueue(kodierer.encode(': .\n\n'));
          }
        } catch (error) {
          log.warn('Musik-Strom gestört', {
            grund: error instanceof Error ? error.message : 'unbekannt',
          });
          schliessen();
        }
      };

      const uhr = setInterval(() => void pruefen(), INTERVALL_MS);
      request.signal.addEventListener('abort', schliessen);

      await pruefen();
    },
  });

  return new Response(strom, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx puffert Antworten sonst und der Strom kaeme stossweise an.
      'x-accel-buffering': 'no',
    },
  });
}
