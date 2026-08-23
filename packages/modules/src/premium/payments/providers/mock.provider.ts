import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@swisshub/logger';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderEvent,
  ProviderSubscriptionView,
} from '../types';

const logger = createLogger('premium:mock-provider');

/**
 * Zahlungsanbieter fuer die Entwicklung.
 *
 * Er bildet den Ablauf vollstaendig ab - Checkout, Webhook, Signatur - aber
 * ohne echtes Geld. Wichtig ist, dass er sich nicht bequemer verhaelt als der
 * echte Anbieter: auch hier wird eine Signatur geprueft und auch hier gilt
 * eine Zahlung erst als erfolgreich, wenn das Ereignis serverseitig eingeht.
 * Sonst faellt der Unterschied erst in Production auf.
 *
 * In Production ist dieser Anbieter verboten; `resolvePaymentProvider` bricht
 * den Start ab, bevor er zum Einsatz kaeme.
 */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly productionReady = false;

  constructor(private readonly webhookSecret: string) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const sessionId = `mock_cs_${randomUUID()}`;
    logger.warn('Mock-Checkout - es fliesst kein Geld', {
      subscriptionId: request.subscriptionId,
      produkt: request.product.slug,
    });
    // Führt auf eine eigene Seite, die den Webhook auslöst. Der Browser meldet
    // nirgends selbst einen Erfolg.
    const url = `/premium/checkout/mock?session=${encodeURIComponent(sessionId)}&abo=${encodeURIComponent(request.subscriptionId)}`;
    return { url, providerSessionId: sessionId, providerCustomerId: `mock_cus_${request.userId}` };
  }

  async cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    logger.info('Mock: Abonnement gekündigt', { providerSubscriptionId, atPeriodEnd });
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    logger.info('Mock: Kündigung zurückgenommen', { providerSubscriptionId });
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionView | null> {
    return {
      providerSubscriptionId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
    };
  }

  async refundPayment(providerPaymentId: string): Promise<void> {
    logger.info('Mock: Zahlung zurückerstattet', { providerPaymentId });
  }

  /** Signatur wie beim echten Anbieter: HMAC ueber den unveraenderten Koerper. */
  sign(rawBody: string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<ProviderEvent> {
    const erwartet = this.sign(rawBody);
    const a = Buffer.from(erwartet, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Ungültige Webhook-Signatur.');
    }

    const daten = JSON.parse(rawBody) as Record<string, unknown>;
    const now = new Date();
    return {
      id: String(daten.id ?? randomUUID()),
      type: String(daten.type ?? 'mock.event'),
      kind: (daten.kind as ProviderEvent['kind']) ?? 'unknown',
      subscriptionId: (daten.subscriptionId as string | null) ?? null,
      providerSubscriptionId: (daten.providerSubscriptionId as string | null) ?? null,
      providerCustomerId: (daten.providerCustomerId as string | null) ?? null,
      providerPaymentId: (daten.providerPaymentId as string | null) ?? null,
      amountMinor: (daten.amountMinor as number | null) ?? null,
      currency: (daten.currency as string | null) ?? 'CHF',
      periodStart: daten.periodStart ? new Date(String(daten.periodStart)) : now,
      periodEnd: daten.periodEnd
        ? new Date(String(daten.periodEnd))
        : new Date(now.getTime() + 30 * 86_400_000),
      failureReason: (daten.failureReason as string | null) ?? null,
      payload: { id: daten.id, type: daten.type },
    };
  }
}
