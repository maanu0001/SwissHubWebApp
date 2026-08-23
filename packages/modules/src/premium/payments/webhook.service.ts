import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { activateSubscription, markPaymentFailed } from '../service';
import { syncDiscordEntitlements } from '../discord';
import { resolvePaymentProvider } from './provider';
import type { ProviderEvent } from './types';

const logger = createLogger('premium:webhook');

export interface WebhookOutcome {
  status: 'processed' | 'duplicate' | 'ignored' | 'failed';
  eventId: string;
  detail?: string;
}

/**
 * Ein Ereignis des Zahlungsanbieters verarbeiten.
 *
 * Drei Eigenschaften sind hier entscheidend:
 *
 *  1. **Signatur zuerst.** Ohne gueltige Signatur wird nichts gespeichert und
 *     nichts veraendert. Der Rohkoerper geht unveraendert an den Anbieter -
 *     jede vorherige Umformung zerstoert die Pruefsumme.
 *  2. **Idempotenz ueber die Datenbank, nicht ueber eine Variable.** Anbieter
 *     stellen dasselbe Ereignis mehrfach zu, und es laufen mehrere Instanzen.
 *     Der eindeutige Schluessel `(provider, providerEventId)` ist die einzige
 *     Stelle, die das zuverlaessig entscheidet.
 *  3. **Discord haengt hinten dran.** Ein Discord-Fehler darf die Zahlung
 *     nicht zuruecknehmen; er hinterlaesst einen fehlerhaften Sync, den der
 *     regelmaessige Abgleich nachholt.
 */
export async function handleWebhook(rawBody: string, signature: string): Promise<WebhookOutcome> {
  const provider = resolvePaymentProvider();

  let event: ProviderEvent;
  try {
    event = await provider.verifyWebhook(rawBody, signature);
  } catch (error) {
    // Bewusst nichts speichern: ohne gültige Signatur ist die Herkunft unklar,
    // und eine Ablage wäre ein offenes Tor zum Vollschreiben der Tabelle.
    logger.warn('Webhook mit ungültiger Signatur abgewiesen');
    throw error;
  }

  // Das Anlegen IST die Idempotenzprüfung: der eindeutige Schlüssel
  // `(provider, providerEventId)` entscheidet, und zwar in der Datenbank.
  // Eine Prüfung in der Anwendung verlöre gegen zwei gleichzeitige
  // Zustellungen - und mehrere Instanzen der WebApp sind der Normalfall.
  //
  // Bewusst `createMany` mit `skipDuplicates` statt `create` im try/catch:
  // eine wiederholte Zustellung ist Normalbetrieb (jeder Anbieter wiederholt,
  // bis er eine 2xx-Antwort sieht) und soll keine Fehlerzeile hinterlassen.
  // Sonst steht das Protokoll voll mit Fehlern, die keine sind - und die
  // echten gehen darin unter.
  const { count } = await prisma.premiumPaymentEvent.createMany({
    data: [
      {
        provider: provider.name,
        providerEventId: event.id,
        eventType: event.type,
        processingStatus: 'RECEIVED',
        payload: event.payload as object,
      },
    ],
    skipDuplicates: true,
  });

  if (count === 0) {
    logger.info('Ereignis bereits verarbeitet', { eventId: event.id, type: event.type });
    return { status: 'duplicate', eventId: event.id };
  }

  try {
    const behandelt = await verarbeite(event, provider.name);
    await prisma.premiumPaymentEvent.update({
      where: { provider_providerEventId: { provider: provider.name, providerEventId: event.id } },
      data: {
        processingStatus: behandelt ? 'PROCESSED' : 'IGNORED',
        processedAt: new Date(),
      },
    });
    return { status: behandelt ? 'processed' : 'ignored', eventId: event.id };
  } catch (error) {
    const meldung = error instanceof Error ? error.message : String(error);
    await prisma.premiumPaymentEvent.update({
      where: { provider_providerEventId: { provider: provider.name, providerEventId: event.id } },
      data: { processingStatus: 'FAILED', processedAt: new Date(), error: meldung },
    });
    logger.error('Ereignis konnte nicht verarbeitet werden', { eventId: event.id, error: meldung });
    return { status: 'failed', eventId: event.id, detail: meldung };
  }
}

/** Findet das eigene Abonnement zum Ereignis. */
async function findeAbonnement(event: ProviderEvent): Promise<string | null> {
  if (event.subscriptionId) {
    const treffer = await prisma.premiumSubscription.findUnique({
      where: { id: event.subscriptionId },
      select: { id: true },
    });
    if (treffer) {
      return treffer.id;
    }
  }
  if (event.providerSubscriptionId) {
    const treffer = await prisma.premiumSubscription.findUnique({
      where: { providerSubscriptionId: event.providerSubscriptionId },
      select: { id: true },
    });
    if (treffer) {
      return treffer.id;
    }
  }
  return null;
}

/** Liefert `true`, wenn das Ereignis tatsaechlich etwas bewirkt hat. */
async function verarbeite(event: ProviderEvent, providerName: string): Promise<boolean> {
  if (event.kind === 'unknown') {
    return false;
  }

  const subscriptionId = await findeAbonnement(event);
  if (!subscriptionId) {
    logger.warn('Ereignis ohne zugehöriges Abonnement', { eventId: event.id, type: event.type });
    return false;
  }

  const jetzt = new Date();

  if (event.kind === 'subscription.activated' || event.kind === 'subscription.renewed') {
    const subscription = await activateSubscription({
      subscriptionId,
      periodStart: event.periodStart ?? jetzt,
      periodEnd: event.periodEnd ?? new Date(jetzt.getTime() + 30 * 86_400_000),
      providerCustomerId: event.providerCustomerId,
      providerSubscriptionId: event.providerSubscriptionId,
    });
    await syncNachZahlung(subscription.userId);
    return true;
  }

  if (event.kind === 'payment.succeeded') {
    await zahlungSpeichern(event, providerName, subscriptionId, 'PAID');
    const subscription = await activateSubscription({
      subscriptionId,
      periodStart: event.periodStart ?? jetzt,
      periodEnd: event.periodEnd ?? new Date(jetzt.getTime() + 30 * 86_400_000),
      providerCustomerId: event.providerCustomerId,
      providerSubscriptionId: event.providerSubscriptionId,
    });
    await syncNachZahlung(subscription.userId);
    return true;
  }

  if (event.kind === 'payment.failed') {
    await zahlungSpeichern(event, providerName, subscriptionId, 'FAILED');
    await markPaymentFailed(subscriptionId, event.failureReason, jetzt);
    return true;
  }

  if (event.kind === 'subscription.cancel_at_period_end') {
    await prisma.premiumSubscription.updateMany({
      where: { id: subscriptionId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
      data: { status: 'CANCEL_AT_PERIOD_END', cancelledAt: jetzt },
    });
    return true;
  }

  if (event.kind === 'subscription.cancelled') {
    // Der Anbieter hat endgültig beendet. Die Ansprüche entfallen damit, und
    // der Abgleich räumt Rolle und Stübli ab.
    const subscription = await prisma.premiumSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'EXPIRED',
        endedAt: jetzt,
        activeUserKey: null,
        discordSyncStatus: 'PENDING',
      },
    });
    await syncNachZahlung(subscription.userId);
    return true;
  }

  return false;
}

async function zahlungSpeichern(
  event: ProviderEvent,
  providerName: string,
  subscriptionId: string,
  status: 'PAID' | 'FAILED',
): Promise<void> {
  const subscription = await prisma.premiumSubscription.findUnique({
    where: { id: subscriptionId },
    select: { userId: true, product: { select: { priceMinor: true, currency: true } } },
  });
  if (!subscription) {
    return;
  }
  const jetzt = new Date();

  // Der Anbieter darf dieselbe Zahlung mehrfach melden - der eindeutige
  // Schlüssel entscheidet, ob sie neu ist.
  await prisma.premiumPayment.upsert({
    where: {
      provider_providerPaymentId: {
        provider: providerName,
        providerPaymentId: event.providerPaymentId ?? event.id,
      },
    },
    create: {
      userId: subscription.userId,
      subscriptionId,
      provider: providerName,
      providerPaymentId: event.providerPaymentId ?? event.id,
      amountMinor: event.amountMinor ?? subscription.product.priceMinor,
      currency: event.currency ?? subscription.product.currency,
      status,
      paidAt: status === 'PAID' ? jetzt : null,
      failedAt: status === 'FAILED' ? jetzt : null,
      failureReason: event.failureReason,
    },
    update: {
      status,
      paidAt: status === 'PAID' ? jetzt : null,
      failedAt: status === 'FAILED' ? jetzt : null,
      failureReason: event.failureReason,
    },
  });
}

/**
 * Discord nach einer Zahlung abgleichen.
 *
 * Fehler werden hier absichtlich verschluckt: das Ereignis des Anbieters gilt
 * als verarbeitet, sobald die Zahlung verbucht ist. Ein nicht erreichbares
 * Discord darf daran nichts aendern - `discordSyncStatus` steht dann auf
 * `FAILED` und der regelmaessige Abgleich holt es nach.
 */
async function syncNachZahlung(userId: string): Promise<void> {
  try {
    await syncDiscordEntitlements(userId);
  } catch (error) {
    logger.warn('Discord-Abgleich nach Zahlung fehlgeschlagen', { userId, error });
  }
}
