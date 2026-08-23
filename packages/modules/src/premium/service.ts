import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type {
  PremiumProduct,
  PremiumSubscription,
  PremiumSubscriptionStatus,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { PREMIUM_MODULE_ID, type PremiumSettings } from './config';
import { grantsEntitlements, LIVE_STATUSES } from './entitlements';

const logger = createLogger('premium');

/**
 * Der Lebenszyklus eines Abonnements.
 *
 * Dies ist die einzige Stelle, an der ein Abonnement entsteht, seinen Zustand
 * wechselt oder endet. Die oeffentliche Seite, der Webhook des Zahlungs-
 * anbieters, die Verwaltung und der Bot rufen dieselben Funktionen auf - es
 * gibt keine zweite Fassung der Regeln je Oberflaeche.
 *
 * Grundsatz: der Browser bestimmt niemals einen Zahlungszustand. `ACTIVE`
 * entsteht ausschliesslich aus einem serverseitig geprueften Ereignis des
 * Anbieters.
 */

export type SubscriptionWithProduct = PremiumSubscription & { product: PremiumProduct };

export interface SubscriptionActor {
  discordId: string;
  username: string;
}

/** Eine Transaktion, wie Prisma sie an den Rumpf von `$transaction` uebergibt. */
export type PremiumTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Das offene Abonnement gesperrt lesen.
 *
 * Jeder Zustandswechsel muss das zuerst tun. Ohne die Sperre lesen zwei
 * gleichzeitige Anfragen denselben Zustand, halten beide ihre Pruefung fuer
 * bestanden und fuehren beide aus - beim Checkout waeren das zwei Abonnements,
 * beim Webhook zwei Zahlungen.
 */
export async function lockSubscription(
  tx: PremiumTx,
  subscriptionId: string,
): Promise<SubscriptionWithProduct> {
  await tx.$queryRaw`SELECT "id" FROM "PremiumSubscription" WHERE "id" = ${subscriptionId} FOR UPDATE`;
  const subscription = await tx.premiumSubscription.findUnique({
    where: { id: subscriptionId },
    include: { product: true },
  });
  if (!subscription) {
    throw notFound(`Abonnement ${subscriptionId} nicht gefunden`, 'Dieses Abonnement gibt es nicht.');
  }
  return subscription;
}

/** Das derzeit offene Abonnement eines Mitglieds. */
export async function getActiveSubscription(userId: string): Promise<SubscriptionWithProduct | null> {
  return prisma.premiumSubscription.findFirst({
    where: { userId, activeUserKey: { not: null } },
    include: { product: true },
  });
}

/** Sämtliche Abonnements eines Mitglieds, neueste zuerst. */
export async function listSubscriptionsOf(userId: string): Promise<SubscriptionWithProduct[]> {
  return prisma.premiumSubscription.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
  });
}

export interface StartCheckoutInput {
  userId: string;
  discordId: string;
  productId: string;
  provider: string;
}

/**
 * Legt das noch unbezahlte Abonnement an.
 *
 * Es entsteht als `PENDING` und gewaehrt damit noch keinen einzigen Anspruch.
 * Erst die bestaetigte Zahlung schaltet es frei.
 *
 * Bricht ein Mitglied den Checkout ab und beginnt neu, wird der bestehende
 * offene Versuch wiederverwendet statt ein zweiter angelegt - sonst blockierte
 * der erste Versuch dauerhaft den Schluessel fuer "genau ein Abonnement".
 */
export async function startCheckout(input: StartCheckoutInput): Promise<SubscriptionWithProduct> {
  return prisma.$transaction(async (tx) => {
    // Der Benutzer wird gesperrt, nicht das Abonnement: es gibt ja noch keines.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;

    const offen = await tx.premiumSubscription.findFirst({
      where: { userId: input.userId, activeUserKey: { not: null } },
      include: { product: true },
    });

    if (offen && grantsEntitlements(offen.status)) {
      throw conflict(
        'Du hast bereits ein laufendes Abonnement. Bitte verwalte es unter "Mein Abo".',
      );
    }

    const produkt = await tx.premiumProduct.findUnique({ where: { id: input.productId } });
    if (!produkt || !produkt.active) {
      throw notFound('Angebot nicht gefunden', 'Dieses Angebot steht nicht zur Verfügung.');
    }

    if (offen) {
      // Ein liegengebliebener Versuch: auf das neue Angebot umschreiben.
      const aktualisiert = await tx.premiumSubscription.update({
        where: { id: offen.id },
        data: { productId: produkt.id, provider: input.provider, status: 'PENDING' },
        include: { product: true },
      });
      return aktualisiert;
    }

    return tx.premiumSubscription.create({
      data: {
        userId: input.userId,
        discordId: input.discordId,
        productId: produkt.id,
        status: 'PENDING',
        activeUserKey: input.userId,
        provider: input.provider,
      },
      include: { product: true },
    });
  });
}

export interface ActivateInput {
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
}

/**
 * Schaltet ein Abonnement frei.
 *
 * Wird ausschliesslich aus einem geprueften Anbieter-Ereignis heraus
 * aufgerufen. Der Aufruf ist idempotent: dasselbe Ereignis ein zweites Mal
 * aendert nichts mehr.
 */
export async function activateSubscription(input: ActivateInput): Promise<SubscriptionWithProduct> {
  const result = await prisma.$transaction(async (tx) => {
    const subscription = await lockSubscription(tx, input.subscriptionId);

    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      throw conflict('Dieses Abonnement ist bereits beendet.');
    }

    return tx.premiumSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: input.periodStart,
        currentPeriodEnd: input.periodEnd,
        graceUntil: null,
        // Eine erfolgreiche Zahlung hebt eine frühere Kündigung nicht auf;
        // die setzt der Anbieter über sein eigenes Ereignis.
        providerCustomerId: input.providerCustomerId ?? subscription.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId ?? subscription.providerSubscriptionId,
        activeUserKey: subscription.userId,
        // Discord ist jetzt im Rückstand - der Sync holt das nach.
        discordSyncStatus: 'PENDING',
      },
      include: { product: true },
    });
  });

  logger.info('Abonnement freigeschaltet', {
    subscriptionId: result.id,
    produkt: result.product.slug,
  });
  return result;
}

/**
 * Kuendigung durch das Mitglied.
 *
 * Standard ist das Ende der bezahlten Periode. Es wird bewusst nichts sofort
 * entzogen: bezahlt ist bezahlt. Erst der Ablauf entfernt die Anspruechen.
 */
export async function cancelAtPeriodEnd(
  subscriptionId: string,
  actor: SubscriptionActor,
  now = new Date(),
): Promise<SubscriptionWithProduct> {
  const result = await prisma.$transaction(async (tx) => {
    const subscription = await lockSubscription(tx, subscriptionId);

    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      throw conflict('Dieses Abonnement ist bereits beendet.');
    }
    if (subscription.status === 'CANCEL_AT_PERIOD_END') {
      // Zweiter Klick auf denselben Knopf ist kein Fehler.
      return subscription;
    }
    if (subscription.status === 'PENDING') {
      // Nie bezahlt - es gibt keine Periode, die noch laufen müsste.
      return tx.premiumSubscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', cancelledAt: now, endedAt: now, activeUserKey: null },
        include: { product: true },
      });
    }

    return tx.premiumSubscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCEL_AT_PERIOD_END', cancelledAt: now },
      include: { product: true },
    });
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PREMIUM_SUBSCRIPTION_CANCELLED,
    module: PREMIUM_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: result.product.name,
    success: true,
    metadata: { subscriptionId: result.id, status: result.status },
  });
  return result;
}

/** Nimmt eine Kuendigung zurueck, solange die Periode noch laeuft. */
export async function resumeSubscription(
  subscriptionId: string,
  actor: SubscriptionActor,
): Promise<SubscriptionWithProduct> {
  const result = await prisma.$transaction(async (tx) => {
    const subscription = await lockSubscription(tx, subscriptionId);
    if (subscription.status !== 'CANCEL_AT_PERIOD_END') {
      throw conflict('Dieses Abonnement ist nicht gekündigt.');
    }
    return tx.premiumSubscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', cancelledAt: null },
      include: { product: true },
    });
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PREMIUM_SUBSCRIPTION_RESUMED,
    module: PREMIUM_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: result.product.name,
    success: true,
    metadata: { subscriptionId: result.id },
  });
  return result;
}

/**
 * Eine Folgezahlung ist fehlgeschlagen.
 *
 * Die Anspruechen bleiben - die Schonfrist laeuft. Erst wenn sie verstreicht,
 * entfernt `expireDueSubscriptions` die Vorteile.
 */
export async function markPaymentFailed(
  subscriptionId: string,
  reason: string | null,
  now = new Date(),
): Promise<SubscriptionWithProduct> {
  const settings = await getModuleSettings<PremiumSettings>(PREMIUM_MODULE_ID);
  const graceUntil = new Date(now.getTime() + settings.gracePeriodSeconds * 1000);

  return prisma.$transaction(async (tx) => {
    const subscription = await lockSubscription(tx, subscriptionId);
    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      return subscription;
    }
    return tx.premiumSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'PAYMENT_FAILED',
        // Eine bereits laufende Schonfrist wird nicht verlängert: sonst
        // liesse sich mit wiederholt fehlschlagenden Zahlungen unbegrenzt
        // weiternutzen.
        graceUntil: subscription.graceUntil ?? graceUntil,
        lastSyncError: reason,
      },
      include: { product: true },
    });
  });
}

/** Beendet ein Abonnement endgueltig - Anspruechen entfallen danach. */
export async function expireSubscription(
  subscriptionId: string,
  now = new Date(),
): Promise<SubscriptionWithProduct> {
  return prisma.$transaction(async (tx) => {
    const subscription = await lockSubscription(tx, subscriptionId);
    return tx.premiumSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'EXPIRED',
        endedAt: subscription.endedAt ?? now,
        // Der Schlüssel wird frei: das Mitglied darf neu abschliessen.
        activeUserKey: null,
        discordSyncStatus: 'PENDING',
      },
      include: { product: true },
    });
  });
}

/** Beendet ein Abonnement durch die Verwaltung, mit Protokolleintrag. */
export async function endSubscriptionAdministratively(
  subscriptionId: string,
  actor: SubscriptionActor,
  reason: string,
  now = new Date(),
): Promise<SubscriptionWithProduct> {
  const result = await prisma.$transaction(async (tx) => {
    const subscription = await lockSubscription(tx, subscriptionId);
    return tx.premiumSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: subscription.cancelledAt ?? now,
        endedAt: now,
        activeUserKey: null,
        discordSyncStatus: 'PENDING',
      },
      include: { product: true },
    });
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PREMIUM_SUBSCRIPTION_CANCELLED,
    module: PREMIUM_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: result.product.name,
    success: true,
    metadata: { subscriptionId: result.id, reason, administrativ: true },
  });
  return result;
}

/**
 * Abgelaufene Abonnements aufraeumen.
 *
 * Faellig ist, wessen Periode vorbei ist und wessen Schonfrist ebenfalls
 * abgelaufen ist. Laeuft im Bot als regelmaessiger Job.
 */
export async function findExpiredSubscriptions(now = new Date()): Promise<SubscriptionWithProduct[]> {
  const kandidaten = await prisma.premiumSubscription.findMany({
    where: { status: { in: [...LIVE_STATUSES] } },
    include: { product: true },
  });

  return kandidaten.filter((subscription) => {
    const periodeVorbei = subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd <= now;
    const schonfristVorbei = subscription.graceUntil === null || subscription.graceUntil <= now;

    if (subscription.status === 'CANCEL_AT_PERIOD_END') {
      return periodeVorbei;
    }
    if (subscription.status === 'PAST_DUE' || subscription.status === 'PAYMENT_FAILED') {
      return periodeVorbei && schonfristVorbei;
    }
    // `ACTIVE` ohne erneuerte Periode: der Anbieter hat nicht verlängert.
    return periodeVorbei && schonfristVorbei;
  });
}

/** Menschlich lesbarer Zustand fuer Oberflaechen. */
export function isLive(status: PremiumSubscriptionStatus): boolean {
  return LIVE_STATUSES.includes(status);
}
