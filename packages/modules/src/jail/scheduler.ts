import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { loadJailContext } from './context';
import { releaseJail } from './service';

const log = createLogger('jail:scheduler');

/** Als "hängen geblieben" gilt ein Vorgang nach dieser Zeit. */
const STUCK_AFTER_MS = 5 * 60 * 1000;

export interface SweepResult {
  processed: number;
  released: number;
  failed: number;
}

/**
 * Gibt abgelaufene Jails frei.
 *
 * Die Datenbank ist Source of Truth: es wird nicht auf `setTimeout` vertraut,
 * sondern regelmässig nach fälligen Einträgen gesucht. Dadurch funktionieren
 * automatische Freilassungen auch nach Neustart, Deployment oder Crash.
 */
export async function releaseExpiredJails(
  limit = 25,
  gateway: DiscordGateway = defaultDiscord,
): Promise<SweepResult> {
  const due = await prisma.jailEntry.findMany({
    where: {
      releasedAt: null,
      // Nur zeitlich begrenzte Jails laufen ab. Permanente Jails haben kein
      // `endsAt` und werden hier bewusst nie erfasst - sie enden ausschliesslich
      // durch eine manuelle Freilassung.
      type: 'TEMPORARY',
      endsAt: { not: null, lte: new Date() },
      status: { in: ['COMPLETED', 'PARTIAL'] },
    },
    orderBy: { endsAt: 'asc' },
    take: limit,
    select: { id: true, targetDiscordId: true },
  });

  if (due.length === 0) {
    return { processed: 0, released: 0, failed: 0 };
  }

  // Kontext einmal laden - schont die Discord Rate Limits.
  const context = await loadJailContext(gateway);
  let released = 0;
  let failed = 0;

  for (const entry of due) {
    try {
      await releaseJail(entry.id, { releaseType: 'AUTOMATIC', gateway, context });
      released += 1;
    } catch (error) {
      failed += 1;
      log.error('Automatische Freilassung fehlgeschlagen', {
        error,
        jailId: entry.id,
        target: entry.targetDiscordId,
      });
    }
  }

  log.info('Jail-Sweep abgeschlossen', { processed: due.length, released, failed });
  return { processed: due.length, released, failed };
}

/**
 * Setzt Vorgänge zurück, die durch einen Absturz mitten in der Ausführung
 * stehen geblieben sind, damit sie erneut versucht werden können.
 */
export async function recoverStuckJails(): Promise<{ stuckCreates: number; stuckReleases: number }> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);

  const stuckCreates = await prisma.jailEntry.updateMany({
    where: { status: { in: ['PENDING', 'EXECUTING'] }, updatedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      activeKey: null,
      errorCode: 'INTERRUPTED',
      errorMessage: 'Vorgang wurde unterbrochen (Neustart oder Absturz).',
    },
  });

  const stuckReleases = await prisma.jailEntry.updateMany({
    where: { releaseStatus: 'EXECUTING', releasedAt: null, updatedAt: { lt: cutoff } },
    data: { releaseStatus: 'FAILED' },
  });

  if (stuckCreates.count > 0 || stuckReleases.count > 0) {
    log.warn('Hängende Jail-Vorgänge zurückgesetzt', {
      stuckCreates: stuckCreates.count,
      stuckReleases: stuckReleases.count,
    });
  }

  return { stuckCreates: stuckCreates.count, stuckReleases: stuckReleases.count };
}
