import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { premium } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';

const log = createLogger('web:premium-webhook');

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Der Webhook des Zahlungsanbieters.
 *
 * Bewusst kein CSRF-Schutz und keine Sitzung: der Aufruf kommt vom
 * Zahlungsanbieter, nicht aus einem Browser. Die Echtheit haengt allein an der
 * Signatur - und die wird ueber den **unveraenderten** Rohkoerper geprueft.
 * Deshalb wird hier `request.text()` gelesen und nicht `request.json()`: schon
 * das Umformen in ein Objekt und zurueck aendert Reihenfolge und Abstaende und
 * macht die Pruefsumme wertlos.
 *
 * Antwortverhalten: Zahlungsanbieter wiederholen, bis sie eine 2xx-Antwort
 * sehen. Deshalb wird ein bereits verarbeitetes Ereignis mit 200 quittiert -
 * sonst laeuft die Zustellung endlos weiter. Nur eine ungueltige Signatur und
 * ein echter Verarbeitungsfehler antworten mit einem Fehlercode.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const signature =
    request.headers.get('stripe-signature') ?? request.headers.get('x-swisshub-signature') ?? '';

  if (!signature) {
    return NextResponse.json({ error: 'Signatur fehlt' }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    const ergebnis = await premium.handleWebhook(rawBody, signature);

    if (ergebnis.status === 'failed') {
      // Bewusst 500: der Anbieter soll es erneut versuchen.
      return NextResponse.json({ status: ergebnis.status }, { status: 500 });
    }
    return NextResponse.json({ status: ergebnis.status }, { status: 200 });
  } catch (error) {
    // Ungültige Signatur - nichts wurde gespeichert und nichts verändert.
    log.warn('Webhook abgewiesen', { grund: error instanceof Error ? error.message : 'unbekannt' });
    return NextResponse.json({ error: 'Ungültige Signatur' }, { status: 400 });
  }
}
