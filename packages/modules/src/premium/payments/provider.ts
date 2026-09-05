import { env, isProduction } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import type { PaymentProvider } from './types';
import { MockProvider } from './providers/mock.provider';
import { StripeProvider } from './providers/stripe.provider';

const logger = createLogger('premium:payments');

let zwischengespeichert: PaymentProvider | null = null;

/**
 * Der konfigurierte Zahlungsanbieter.
 *
 * Der Mock ist in Production ausdruecklich verboten. Das wird hier hart
 * durchgesetzt und nicht bloss dokumentiert: ein versehentlich stehen
 * gebliebenes `PAYMENT_PROVIDER=mock` wuerde sonst Abonnements freischalten,
 * fuer die nie jemand bezahlt hat.
 */
export function resolvePaymentProvider(): PaymentProvider {
  if (zwischengespeichert) {
    return zwischengespeichert;
  }

  const name = (env.PAYMENT_PROVIDER ?? 'mock').trim().toLowerCase();

  if (name === 'mock') {
    if (isProduction()) {
      throw new Error(
        'PAYMENT_PROVIDER=mock ist in Production nicht zulässig. Bitte einen echten Zahlungsanbieter konfigurieren.',
      );
    }
    logger.warn('Mock-Zahlungsanbieter aktiv - es fliesst kein Geld.');
    zwischengespeichert = new MockProvider(env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret');
    return zwischengespeichert;
  }

  if (name === 'stripe') {
    if (!env.PAYMENT_API_KEY || !env.PAYMENT_WEBHOOK_SECRET) {
      throw new Error('PAYMENT_API_KEY und PAYMENT_WEBHOOK_SECRET werden für Stripe benötigt.');
    }
    zwischengespeichert = new StripeProvider(env.PAYMENT_API_KEY, env.PAYMENT_WEBHOOK_SECRET);
    return zwischengespeichert;
  }

  throw new Error(`Unbekannter Zahlungsanbieter "${name}". Erlaubt sind "stripe" und "mock".`);
}

/** Nur fuer Tests: den gemerkten Anbieter vergessen. */
export function resetPaymentProvider(): void {
  zwischengespeichert = null;
}

/**
 * Ist Premium betriebsbereit?
 *
 * Wird beim Start geprueft, damit ein halb konfiguriertes Premium nicht erst
 * beim ersten Checkout auffaellt.
 */
export function assertPremiumPaymentsConfigured(): void {
  const provider = resolvePaymentProvider();
  if (isProduction() && !provider.productionReady) {
    throw new Error(`Der Zahlungsanbieter "${provider.name}" ist für Production nicht zugelassen.`);
  }
}
