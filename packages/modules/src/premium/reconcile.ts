import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { isModuleEnabled } from '../module-state';
import { PREMIUM_MODULE_ID } from './config';
import { syncDiscordEntitlements } from './discord';
import { seedProducts } from './products';
import { expireSubscription, findExpiredSubscriptions } from './service';

const logger = createLogger('premium:reconcile');

export interface ReconcileResult {
  expired: number;
  synced: number;
  failed: number;
}

/**
 * Regelmaessiger Abgleich.
 *
 * Er holt nach, was zwischendurch schiefgegangen ist:
 *
 *  - abgelaufene Abonnements beenden und deren Anspruechen entfernen,
 *  - fehlgeschlagene Discord-Abgleiche erneut versuchen,
 *  - laufende Abonnements gegen den tatsaechlichen Discord-Zustand pruefen
 *    (jemand hat eine Rolle von Hand entfernt, ein Kanal wurde geloescht).
 *
 * Laeuft im bestehenden Job-Runner des Bots - es gibt keinen zweiten
 * Zeitplaner.
 */
export async function reconcilePremium(now = new Date()): Promise<ReconcileResult> {
  if (!(await isModuleEnabled(PREMIUM_MODULE_ID))) {
    return { expired: 0, synced: 0, failed: 0 };
  }

  const ergebnis: ReconcileResult = { expired: 0, synced: 0, failed: 0 };

  // 0. Standardangebote sicherstellen.
  //
  //    Ohne Angebote ist die oeffentliche Seite leer und niemand kann
  //    abonnieren - und angelegt werden koennen sie nirgends sonst, die
  //    Verwaltung darf bestehende nur bearbeiten. Der Seed gehoert deshalb
  //    hierher und nicht in eine einmalige Migration: er laeuft idempotent
  //    bei jedem Abgleich, ueberschreibt nie eine gepflegte Angabe und
  //    repariert sich damit auch, wenn jemand ein Angebot versehentlich
  //    entfernt.
  const angelegt = await seedProducts();
  if (angelegt > 0) {
    logger.info('Standardangebote angelegt', { angelegt });
  }

  // 1. Abgelaufenes beenden.
  for (const subscription of await findExpiredSubscriptions(now)) {
    await expireSubscription(subscription.id, now);
    ergebnis.expired += 1;
    logger.info('Abonnement abgelaufen', {
      subscriptionId: subscription.id,
      produkt: subscription.product.slug,
    });
  }

  // 2. Alles abgleichen, dessen Discord-Zustand offen oder fehlerhaft ist -
  //    dazu jedes laufende Abonnement, damit von Hand entfernte Rollen und
  //    geloeschte Kanaele wieder zurechtgerueckt werden.
  const zuPruefen = await prisma.premiumSubscription.findMany({
    where: {
      OR: [
        { discordSyncStatus: { in: ['PENDING', 'FAILED'] } },
        { activeUserKey: { not: null } },
      ],
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  for (const eintrag of zuPruefen) {
    const sync = await syncDiscordEntitlements(eintrag.userId);
    if (sync.ok) {
      ergebnis.synced += 1;
    } else {
      ergebnis.failed += 1;
    }
  }

  if (ergebnis.expired > 0 || ergebnis.failed > 0) {
    logger.info('Premium abgeglichen', { ...ergebnis });
  }
  return ergebnis;
}
