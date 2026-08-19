import { Prisma } from '@prisma/client';
import { prisma } from './client';
import type { ActionStatus } from '@prisma/client';

/**
 * Idempotenz fuer kritische Aktionen.
 *
 * Doppelklicks, Retries und Browser-Refreshes duerfen keine zweite
 * Moderationsaktion ausloesen. Der Client sendet dafuer einen Idempotency Key;
 * der Server reserviert ihn per Unique-Constraint, bevor er handelt.
 */
export interface IdempotencyClaim {
  status: 'claimed' | 'duplicate';
  /** Bei `duplicate`: Status und Referenz des bereits vorhandenen Vorgangs. */
  existing?: { status: ActionStatus; resultRef: string | null; createdAt: Date };
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

/** Reserviert den Schluessel. Gibt `duplicate` zurueck, wenn er bereits vergeben ist. */
export async function claimIdempotencyKey(
  scope: string,
  key: string,
  actorDiscordId: string,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
): Promise<IdempotencyClaim> {
  const fullKey = storageKey(scope, key);
  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: fullKey,
        scope,
        actorDiscordId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return { status: 'claimed' };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key: fullKey },
        select: { status: true, resultRef: true, createdAt: true },
      });
      return { status: 'duplicate', existing: existing ?? undefined };
    }
    throw error;
  }
}

export async function completeIdempotencyKey(
  scope: string,
  key: string,
  status: ActionStatus,
  resultRef?: string,
): Promise<void> {
  await prisma.idempotencyRecord.update({
    where: { key: storageKey(scope, key) },
    data: { status, resultRef: resultRef ?? null },
  });
}

/**
 * Gibt einen Schluessel wieder frei, wenn die Aktion gar nicht erst gestartet
 * werden konnte (z.B. Validierungsfehler) - sonst blockiert ein fehlerhafter
 * Versuch den erneuten, korrigierten Versuch.
 */
export async function releaseIdempotencyKey(scope: string, key: string): Promise<void> {
  await prisma.idempotencyRecord.delete({ where: { key: storageKey(scope, key) } }).catch(() => undefined);
}

/** Entfernt abgelaufene Schluessel (vom Bot periodisch aufgerufen). */
export async function purgeExpiredIdempotencyKeys(): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
