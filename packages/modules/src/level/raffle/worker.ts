import { prisma } from '@swisshub/database';
import type { XpRaffle } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { closeEntries, openEntries } from './service';

const logger = createLogger('level.raffle.worker');

/**
 * Zeitsteuerung der Verlosungen.
 *
 * Der Zustand steht ausschliesslich in der Datenbank; dieser Lauf holt nur
 * nach, was fällig geworden ist. Bewusst kein `setTimeout` über mehrere Tage:
 * ein Neustart würde jede so gemerkte Frist verlieren, und nach einem
 * Ausfall über Nacht stünde eine Verlosung immer noch offen.
 */

export interface RaffleTickResult {
  opened: string[];
  closed: string[];
  /** Verlosungen, die zur selbsttätigen Ziehung bereitstehen. */
  readyToDraw: XpRaffle[];
}

export async function runRaffleTick(now = new Date()): Promise<RaffleTickResult> {
  const opened: string[] = [];
  const closed: string[] = [];

  // Geplante Verlosungen, deren Startzeitpunkt erreicht ist.
  const due = await prisma.xpRaffle.findMany({
    where: { status: 'SCHEDULED', entryStartsAt: { not: null, lte: now } },
    select: { id: true },
  });
  for (const raffle of due) {
    try {
      await openEntries(null, raffle.id, now);
      opened.push(raffle.id);
    } catch (error) {
      logger.warn('Teilnahme konnte nicht geöffnet werden', { raffleId: raffle.id, error });
    }
  }

  // Offene Verlosungen, deren Frist abgelaufen ist.
  const expired = await prisma.xpRaffle.findMany({
    where: { status: 'ENTRY_OPEN', entryEndsAt: { not: null, lte: now } },
    select: { id: true },
  });
  for (const raffle of expired) {
    try {
      await closeEntries(null, raffle.id, now);
      closed.push(raffle.id);
    } catch (error) {
      logger.warn('Teilnahme konnte nicht geschlossen werden', { raffleId: raffle.id, error });
    }
  }

  // Verlosungen, bei denen die Verwaltung die Ziehung selbsttätig wünscht.
  const readyToDraw = await prisma.xpRaffle.findMany({
    where: {
      status: 'ENTRY_CLOSED',
      autoDraw: true,
      drawScheduledAt: { not: null, lte: now },
    },
  });

  if (opened.length > 0 || closed.length > 0 || readyToDraw.length > 0) {
    logger.info('Verlosungen fortgeschrieben', {
      opened: opened.length,
      closed: closed.length,
      readyToDraw: readyToDraw.length,
    });
  }

  return { opened, closed, readyToDraw };
}
