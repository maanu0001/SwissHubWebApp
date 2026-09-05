import type { PremiumEntitlement, PremiumSubscriptionStatus } from '@swisshub/database';

/**
 * Anspruechen statt Produktnamen.
 *
 * Die Discord-Logik fragt ausschliesslich, ob ein Mitglied einen bestimmten
 * Anspruch hat - nie, welches Angebot es gebucht hat. Kommt spaeter ein
 * viertes Angebot dazu, aendert sich nur die Zuordnung in der Datenbank und
 * keine einzige Verzweigung im Code.
 */
export const ENTITLEMENTS = {
  premiumRole: 'PREMIUM_ROLE',
  stuebliRole: 'PREMIUM_STUEBLI_ROLE',
  privateVoice: 'PRIVATE_VOICE',
} as const satisfies Record<string, PremiumEntitlement>;

export const ALL_ENTITLEMENTS: readonly PremiumEntitlement[] = [
  'PREMIUM_ROLE',
  'PREMIUM_STUEBLI_ROLE',
  'PRIVATE_VOICE',
];

export const ENTITLEMENT_LABEL: Record<PremiumEntitlement, string> = {
  PREMIUM_ROLE: 'Premium-Rolle',
  PREMIUM_STUEBLI_ROLE: 'Premium-Stübli-Rolle',
  PRIVATE_VOICE: 'Eigener Sprachkanal',
};

/**
 * Zustaende, in denen die Anspruechen bestehen bleiben.
 *
 * `PAST_DUE` und `PAYMENT_FAILED` gehoeren bewusst dazu: waehrend der
 * Schonfrist behaelt das Mitglied seine Vorteile. Wer wegen einer verspaeteten
 * Zahlung sofort seinen Sprachkanal verliert, kommt nicht wieder.
 *
 * `CANCEL_AT_PERIOD_END` ebenfalls: gekuendigt ist bezahlt bis zum
 * Periodenende.
 */
const ANSPRUCH_STATUS: readonly PremiumSubscriptionStatus[] = [
  'ACTIVE',
  'PAST_DUE',
  'PAYMENT_FAILED',
  'CANCEL_AT_PERIOD_END',
];

/** Gewaehrt dieses Abonnement derzeit Anspruechen? */
export function grantsEntitlements(status: PremiumSubscriptionStatus): boolean {
  return ANSPRUCH_STATUS.includes(status);
}

/** Zustaende, die als laufend gelten (fuer Listen und Kennzahlen). */
export const LIVE_STATUSES: readonly PremiumSubscriptionStatus[] = [
  'ACTIVE',
  'PAST_DUE',
  'PAYMENT_FAILED',
  'CANCEL_AT_PERIOD_END',
];

export const STATUS_LABEL: Record<PremiumSubscriptionStatus, string> = {
  PENDING: 'Zahlung ausstehend',
  ACTIVE: 'Aktiv',
  PAST_DUE: 'Zahlung offen',
  PAYMENT_FAILED: 'Zahlung fehlgeschlagen',
  CANCEL_AT_PERIOD_END: 'Gekündigt auf Periodenende',
  CANCELLED: 'Beendet',
  EXPIRED: 'Abgelaufen',
};

/** Hat das Abonnement diesen Anspruch - und gilt er gerade? */
export function hasEntitlement(
  subscription: { status: PremiumSubscriptionStatus; product: { entitlements: PremiumEntitlement[] } },
  entitlement: PremiumEntitlement,
): boolean {
  return grantsEntitlements(subscription.status) && subscription.product.entitlements.includes(entitlement);
}
