import Stripe from 'stripe';
import { createLogger } from '@swisshub/logger';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderEvent,
  ProviderEventKind,
  ProviderSubscriptionView,
} from '../types';

const logger = createLogger('premium:stripe');

/**
 * Stripe als Zahlungsanbieter, mit TWINT.
 *
 * Warum Stripe: TWINT allein kennt keine Abonnements. Bis Mai 2026 liess sich
 * TWINT bei Stripe ausschliesslich fuer Einzelzahlungen verwenden; seit dem
 * 27. Mai 2026 unterstuetzt Stripe TWINT auch fuer wiederkehrende Zahlungen,
 * Abonnements und Zahlungen ohne anwesenden Kunden. Damit ist der Ablauf, den
 * dieses Modul braucht, offiziell dokumentiert und muss nicht nachgebaut
 * werden.
 *
 * Eine Eigenheit von TWINT bestimmt die Architektur mit: es gibt hoechstens
 * ein aktives Mandat je Haendler und Kunde. Ein zweites anzulegen beantwortet
 * Stripe mit einem Fehler. Das passt zur Regel dieses Moduls, dass ein
 * Mitglied genau ein laufendes Abonnement hat - beides muss zusammenpassen,
 * sonst laeuft der Checkout beim Anbieter auf.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly productionReady = true;

  private readonly client: Stripe;
  private readonly webhookSecret: string;

  constructor(apiKey: string, webhookSecret: string) {
    this.client = new Stripe(apiKey);
    this.webhookSecret = webhookSecret;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    if (!request.product.providerPriceId) {
      throw new Error(
        `Für "${request.product.name}" ist keine Stripe-Preis-ID hinterlegt. Bitte in der Produktverwaltung eintragen.`,
      );
    }

    const session = await this.client.checkout.sessions.create({
      mode: 'subscription',
      // TWINT und Karte. Stripe blendet aus, was zur Währung nicht passt.
      payment_method_types: ['twint', 'card'],
      currency: request.product.currency.toLowerCase(),
      line_items: [{ price: request.product.providerPriceId, quantity: 1 }],
      ...(request.providerCustomerId ? { customer: request.providerCustomerId } : {}),
      client_reference_id: request.subscriptionId,
      // Die Metadaten sind die Brücke zurück: der Webhook findet darüber das
      // eigene Abonnement, ohne sich auf Reihenfolge oder Zeit zu verlassen.
      metadata: {
        swisshubSubscriptionId: request.subscriptionId,
        swisshubUserId: request.userId,
        swisshubDiscordId: request.discordId,
      },
      subscription_data: {
        metadata: {
          swisshubSubscriptionId: request.subscriptionId,
          swisshubUserId: request.userId,
          swisshubDiscordId: request.discordId,
        },
      },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      locale: 'de',
    });

    if (!session.url) {
      throw new Error('Stripe hat keine Checkout-Adresse geliefert.');
    }

    return {
      url: session.url,
      providerSessionId: session.id,
      providerCustomerId: typeof session.customer === 'string' ? session.customer : null,
    };
  }

  async cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (atPeriodEnd) {
      await this.client.subscriptions.update(providerSubscriptionId, { cancel_at_period_end: true });
      return;
    }
    await this.client.subscriptions.cancel(providerSubscriptionId);
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    await this.client.subscriptions.update(providerSubscriptionId, { cancel_at_period_end: false });
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionView | null> {
    try {
      const subscription = await this.client.subscriptions.retrieve(providerSubscriptionId);
      return {
        providerSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodStart: sekundenZuDatum(readPeriod(subscription, 'current_period_start')),
        currentPeriodEnd: sekundenZuDatum(readPeriod(subscription, 'current_period_end')),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    } catch (error) {
      logger.warn('Abonnement bei Stripe nicht abrufbar', { providerSubscriptionId, error });
      return null;
    }
  }

  async refundPayment(providerPaymentId: string): Promise<void> {
    await this.client.refunds.create({ payment_intent: providerPaymentId });
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<ProviderEvent> {
    // Wirft bei falscher Signatur - genau so ist es gewollt. Der Rohkörper darf
    // vorher nicht angefasst worden sein, sonst stimmt die Prüfsumme nicht.
    const event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return uebersetze(event);
  }
}

/**
 * Der Zeitraum steht je nach API-Fassung am Abonnement oder an dessen Position.
 * Beide Wege werden gelesen, damit ein Versionswechsel bei Stripe nicht zu
 * einem Abonnement ohne Laufzeit fuehrt.
 */
function readPeriod(subscription: Stripe.Subscription, feld: 'current_period_start' | 'current_period_end'): number | null {
  const direkt = (subscription as unknown as Record<string, unknown>)[feld];
  if (typeof direkt === 'number') {
    return direkt;
  }
  const position = subscription.items?.data?.[0] as unknown as Record<string, unknown> | undefined;
  const ausPosition = position?.[feld];
  return typeof ausPosition === 'number' ? ausPosition : null;
}

const sekundenZuDatum = (wert: number | null | undefined): Date | null =>
  typeof wert === 'number' ? new Date(wert * 1000) : null;

const KIND: Record<string, ProviderEventKind> = {
  'checkout.session.completed': 'subscription.activated',
  'customer.subscription.created': 'subscription.activated',
  'customer.subscription.updated': 'subscription.renewed',
  'customer.subscription.deleted': 'subscription.cancelled',
  'invoice.paid': 'payment.succeeded',
  'invoice.payment_succeeded': 'payment.succeeded',
  'invoice.payment_failed': 'payment.failed',
};

/** Uebersetzt ein Stripe-Ereignis in die Sprache dieses Moduls. */
function uebersetze(event: Stripe.Event): ProviderEvent {
  const objekt = event.data.object as unknown as Record<string, unknown>;
  const metadata = (objekt.metadata ?? {}) as Record<string, string>;

  const basis: ProviderEvent = {
    id: event.id,
    type: event.type,
    kind: KIND[event.type] ?? 'unknown',
    subscriptionId: metadata.swisshubSubscriptionId ?? null,
    providerSubscriptionId: null,
    providerCustomerId: typeof objekt.customer === 'string' ? objekt.customer : null,
    providerPaymentId: null,
    amountMinor: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    failureReason: null,
    // Bewusst nur wenige Felder: der vollständige Stripe-Körper enthält
    // Angaben zum Zahlungsmittel, die hier nichts zu suchen haben.
    payload: { id: event.id, type: event.type, created: event.created },
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      ...basis,
      subscriptionId: session.client_reference_id ?? basis.subscriptionId,
      providerSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
      amountMinor: session.amount_total ?? null,
      currency: session.currency?.toUpperCase() ?? null,
    };
  }

  if (event.type.startsWith('customer.subscription.')) {
    const subscription = event.data.object as Stripe.Subscription;
    const gekuendigt = subscription.cancel_at_period_end;
    return {
      ...basis,
      kind:
        event.type === 'customer.subscription.deleted'
          ? 'subscription.cancelled'
          : gekuendigt
            ? 'subscription.cancel_at_period_end'
            : 'subscription.renewed',
      providerSubscriptionId: subscription.id,
      periodStart: sekundenZuDatum(readPeriod(subscription, 'current_period_start')),
      periodEnd: sekundenZuDatum(readPeriod(subscription, 'current_period_end')),
    };
  }

  if (event.type.startsWith('invoice.')) {
    const invoice = event.data.object as unknown as Record<string, unknown>;
    const subscriptionId = invoice.subscription;
    const zahlung = invoice.payment_intent;
    return {
      ...basis,
      providerSubscriptionId: typeof subscriptionId === 'string' ? subscriptionId : null,
      providerPaymentId: typeof zahlung === 'string' ? zahlung : (invoice.id as string | null) ?? null,
      amountMinor: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
      currency: typeof invoice.currency === 'string' ? invoice.currency.toUpperCase() : null,
      periodStart: sekundenZuDatum(invoice.period_start as number | undefined),
      periodEnd: sekundenZuDatum(invoice.period_end as number | undefined),
      failureReason:
        event.type === 'invoice.payment_failed'
          ? ((invoice.last_finalization_error as Record<string, unknown> | undefined)?.message as string) ??
            'Zahlung fehlgeschlagen'
          : null,
    };
  }

  return basis;
}
