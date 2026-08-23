import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { env } from '@swisshub/config';
import { premium } from '@swisshub/modules';
import { getOptionalAuthContext } from '@/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Loest in der Entwicklung ein signiertes Zahlungsereignis aus.
 *
 * Der Weg ist derselbe wie in Production: die Route baut ein Ereignis, signiert
 * es und schickt es durch dieselbe Webhook-Verarbeitung. Sie ruft niemals
 * `activateSubscription` direkt auf - sonst waere der Mock-Pfad ein anderer als
 * der echte, und die Unterschiede fielen erst in Production auf.
 *
 * Ausserhalb der Entwicklung gibt es diese Route nicht.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const provider = premium.resolvePaymentProvider();
  if (provider.productionReady) {
    return NextResponse.json({ error: 'Nicht verfügbar' }, { status: 404 });
  }

  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  }

  const { subscriptionId } = (await request.json()) as { subscriptionId?: string };
  if (!subscriptionId) {
    return NextResponse.json({ error: 'subscriptionId fehlt' }, { status: 400 });
  }

  const mock = new premium.MockProvider(env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret');
  const body = JSON.stringify({
    id: `mock_evt_${randomUUID()}`,
    type: 'payment.succeeded',
    kind: 'payment.succeeded',
    subscriptionId,
    providerSubscriptionId: `mock_sub_${subscriptionId}`,
    providerPaymentId: `mock_pi_${randomUUID()}`,
    currency: 'CHF',
  });

  const ergebnis = await premium.handleWebhook(body, mock.sign(body));
  return NextResponse.json({ status: ergebnis.status });
}
