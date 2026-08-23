import type { PremiumProduct } from '@swisshub/database';

/**
 * Die Grenze zum Zahlungsanbieter.
 *
 * Alles oberhalb dieser Schnittstelle kennt weder Stripe noch TWINT. Dadurch
 * bleibt ein Anbieterwechsel eine Datei und nicht ein Umbau des Moduls - und
 * die Geschaeftslogik laesst sich ohne Netzzugriff testen.
 */

export interface CheckoutRequest {
  subscriptionId: string;
  product: PremiumProduct;
  /** Interne Benutzer-ID; landet als Metadatum beim Anbieter. */
  userId: string;
  discordId: string;
  username: string;
  /** Bereits vorhandene Kundennummer beim Anbieter, falls bekannt. */
  providerCustomerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Adresse, auf die der Browser weitergeleitet wird. */
  url: string;
  providerSessionId: string;
  providerCustomerId: string | null;
}

export interface ProviderSubscriptionView {
  providerSubscriptionId: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Ein Ereignis des Anbieters, uebersetzt in die Sprache dieses Moduls.
 *
 * Bewusst eine kleine Aufzaehlung statt der Roh-Ereignisse: was das Modul
 * nicht versteht, soll es auch nicht verarbeiten.
 */
export type ProviderEventKind =
  | 'subscription.activated'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'subscription.cancel_at_period_end'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'unknown';

export interface ProviderEvent {
  /** Eindeutige ID des Anbieters - Grundlage der Idempotenz. */
  id: string;
  type: string;
  kind: ProviderEventKind;
  /** Unser eigenes Abonnement, aus den Metadaten des Anbieters. */
  subscriptionId: string | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  providerPaymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  failureReason: string | null;
  /** Rohdaten fuer die Ablage - ohne Zahlungsmittel-Details. */
  payload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  /** Darf dieser Anbieter in Production laufen? */
  readonly productionReady: boolean;

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  resumeSubscription(providerSubscriptionId: string): Promise<void>;
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionView | null>;
  refundPayment(providerPaymentId: string): Promise<void>;

  /**
   * Prueft die Signatur und liefert das uebersetzte Ereignis.
   *
   * Wirft, wenn die Signatur nicht stimmt. Der Rohkoerper wird unveraendert
   * uebergeben: jede Umformung vorher zerstoert die Signatur.
   */
  verifyWebhook(rawBody: string, signature: string): Promise<ProviderEvent>;
}
