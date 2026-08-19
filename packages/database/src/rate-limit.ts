import { prisma } from './client';

/**
 * Serverseitiges Rate Limiting (Fixed Window) auf Basis der Datenbank.
 *
 * Bewusst ohne In-Memory-Zähler: die WebApp kann in mehreren Instanzen laufen,
 * und ein Limit, das sich durch einen Prozessneustart zurücksetzen lässt, ist
 * kein Limit.
 */
export interface RateLimitRule {
  /** Erlaubte Anzahl Treffer pro Fenster. */
  limit: number;
  /** Fenstergrösse in Millisekunden. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterMs: number;
}

const CLEANUP_PROBABILITY = 0.02;

export async function consumeRateLimit(bucket: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / rule.windowMs) * rule.windowMs);
  const resetAt = new Date(windowStart.getTime() + rule.windowMs);

  const counter = await prisma.rateLimitCounter.upsert({
    where: { bucket_windowStart: { bucket, windowStart } },
    create: { bucket, windowStart, count: 1, expiresAt: resetAt },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  if (Math.random() < CLEANUP_PROBABILITY) {
    void prisma.rateLimitCounter
      .deleteMany({ where: { expiresAt: { lt: new Date(now - rule.windowMs) } } })
      .catch(() => undefined);
  }

  const allowed = counter.count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - counter.count),
    resetAt,
    retryAfterMs: allowed ? 0 : resetAt.getTime() - now,
  };
}

/** Liest den aktuellen Stand, ohne ihn zu erhöhen (z.B. für Anzeigen). */
export async function peekRateLimit(bucket: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / rule.windowMs) * rule.windowMs);
  const resetAt = new Date(windowStart.getTime() + rule.windowMs);
  const counter = await prisma.rateLimitCounter.findUnique({
    where: { bucket_windowStart: { bucket, windowStart } },
    select: { count: true },
  });
  const count = counter?.count ?? 0;
  return {
    allowed: count < rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
    retryAfterMs: count < rule.limit ? 0 : resetAt.getTime() - now,
  };
}
