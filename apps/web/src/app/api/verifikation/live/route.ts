import { can } from '@swisshub/auth';
import { verification } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { getOptionalAuthContext } from '@/server/auth';

const log = createLogger('web:verification-live');

/**
 * Der Live-Stand der Warteschlange.
 *
 * Server-Sent Events wie beim Turnierstand und beim Musikstrom - es gibt
 * keine zweite Realtime-Infrastruktur in diesem Projekt und es soll auch
 * keine geben. SSE ist gewoehnliches HTTP, der Browser verbindet von selbst
 * neu, und es braucht keinen zweiten Weg durch nginx.
 *
 * Gesendet wird nur, was sich geaendert hat: eine Warteschlange, die sich
 * sekuendlich grundlos neu zeichnet, ist waehrend einer Spamwelle genau das
 * Gegenteil von hilfreich.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Wie oft die Datenbank gefragt wird. */
const INTERVALL_MS = 4_000;
/** Lebenszeichen gegen Proxys, die stille Verbindungen schliessen. */
const HERZSCHLAG_MS = 20_000;
/**
 * Nach dieser Zeit endet der Strom von selbst.
 *
 * Der Browser verbindet danach neu und wird dabei erneut geprueft: wer die
 * Berechtigung verliert, ist spaetestens dann draussen.
 */
const HOECHSTDAUER_MS = 15 * 60_000;

/** Was sich geaendert haben muss, damit es die Oberflaeche erfaehrt. */
function fingerabdruck(zeilen: Awaited<ReturnType<typeof verification.listQueue>>): string {
  return zeilen
    .map((zeile) => `${zeile.id}:${zeile.status}:${zeile.messageCount}:${zeile.aiVerdict ?? '-'}`)
    .join('|');
}

export async function GET(request: Request): Promise<Response> {
  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    return new Response('Nicht angemeldet.', { status: 401 });
  }
  // Dieselbe Berechtigung wie die Seite selbst.
  if (
    !can(context, verification.VERIFICATION_PERMISSIONS.review) &&
    !can(context, verification.VERIFICATION_PERMISSIONS.view)
  ) {
    return new Response('Keine Berechtigung.', { status: 403 });
  }

  const encoder = new TextEncoder();
  let letzter = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const beginn = Date.now();
      let offen = true;

      const senden = (ereignis: string, daten: unknown): void => {
        if (!offen) {
          return;
        }
        controller.enqueue(encoder.encode(`event: ${ereignis}\ndata: ${JSON.stringify(daten)}\n\n`));
      };

      const schliessen = (): void => {
        if (!offen) {
          return;
        }
        offen = false;
        clearInterval(takt);
        clearInterval(herzschlag);
        try {
          controller.close();
        } catch {
          // Der Browser war schneller - das ist der Normalfall beim
          // Seitenwechsel und kein Fehler.
        }
      };

      const pruefen = async (): Promise<void> => {
        try {
          const zeilen = await verification.listQueue(50);
          const abdruck = fingerabdruck(zeilen);
          if (abdruck !== letzter) {
            letzter = abdruck;
            senden('queue', { zeilen, stand: new Date().toISOString() });
          }
          if (Date.now() - beginn > HOECHSTDAUER_MS) {
            schliessen();
          }
        } catch (error) {
          log.warn('Live-Abfrage fehlgeschlagen', { error });
        }
      };

      const takt = setInterval(() => void pruefen(), INTERVALL_MS);
      const herzschlag = setInterval(() => {
        if (offen) {
          controller.enqueue(encoder.encode(': ping\n\n'));
        }
      }, HERZSCHLAG_MS);

      request.signal.addEventListener('abort', schliessen);
      await pruefen();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // nginx puffert SSE sonst und der Strom kommt in Schueben an.
      'X-Accel-Buffering': 'no',
    },
  });
}
