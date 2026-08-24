import { tournaments } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { getActionAuthContext } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

const log = createLogger('web:tournament-live');

/**
 * Der Live-Stand eines Turniers.
 *
 * Wie beim Musik-Strom Server-Sent Events und keine WebSockets: der Strom
 * laeuft nur in eine Richtung, Befehle gehen ueber die bestehenden Aktionen.
 * SSE ist gewoehnliches HTTP, der Browser verbindet von selbst neu, und es
 * braucht keinen zweiten Weg durch nginx.
 *
 * Gesendet wird nur, was sich geaendert hat. Ein Leitstand, der sich
 * sekuendlich grundlos neu zeichnet, ist waehrend eines laufenden Turniers
 * genau das Gegenteil von hilfreich.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Wie oft die Datenbank gefragt wird.
 *
 * Bewusst traeger als beim Musikstrom: dort wandert ein Fortschrittsbalken,
 * hier aendert sich ein Matchstand. Fuenf Sekunden sind schnell genug, um
 * waehrend eines Turniers nicht veraltet zu wirken.
 */
const INTERVALL_MS = 5_000;
/** Lebenszeichen gegen Proxys, die stille Verbindungen schliessen. */
const HERZSCHLAG_MS = 20_000;
/**
 * Nach dieser Zeit endet der Strom von selbst.
 *
 * Der Browser verbindet danach neu und wird dabei erneut geprueft: wer die
 * Zustaendigkeit verliert, ist spaetestens dann draussen.
 */
const HOECHSTDAUER_MS = 15 * 60_000;

/** Was sich geaendert haben muss, damit es die Oberflaeche erfaehrt. */
function fingerabdruck(zustand: tournaments.LiveZustand): string {
  return [
    zustand.status,
    zustand.runde ?? '-',
    zustand.abschnitt ?? '-',
    zustand.matchesLive,
    zustand.matchesWartend,
    zustand.matchesOffen,
    zustand.matchesFertig,
    zustand.einspruecheOffen,
    zustand.eingecheckt,
    zustand.bestaetigt,
  ].join('|');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new Response(null, { status: 401 });
  }

  const { id } = await params;
  if (!/^c[a-z0-9]{20,}$/u.test(id)) {
    return new Response(null, { status: 400 });
  }

  // Dieselbe Pruefung wie auf jeder Verwaltungsseite. Eine Turnierkennung im
  // Adressfeld sagt nichts darueber aus, ob sie jemanden etwas angeht.
  try {
    const { zugriff } = await ladeTurnierMitZugriff(context, id);
    if (!zugriff.asStaff) {
      return new Response(null, { status: 403 });
    }
  } catch {
    return new Response(null, { status: 404 });
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
          senden('neuverbinden', {});
          schliessen();
          return;
        }

        try {
          const zustand = await tournaments.getLiveZustand(id);
          const jetzt = fingerabdruck(zustand);

          if (jetzt !== letzter) {
            letzter = jetzt;
            letzterHerzschlag = Date.now();
            senden('zustand', zustand);
            return;
          }

          if (Date.now() - letzterHerzschlag > HERZSCHLAG_MS) {
            letzterHerzschlag = Date.now();
            // Ein Kommentar - der Browser sieht ihn nicht, der Proxy schon.
            steuerung.enqueue(kodierer.encode(': .\n\n'));
          }
        } catch (error) {
          log.warn('Turnier-Strom gestört', {
            tournamentId: id,
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
      'x-accel-buffering': 'no',
    },
  });
}
