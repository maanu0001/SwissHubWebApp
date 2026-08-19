import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token (default 32 bytes of entropy). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

/** Constant time string comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison to keep the timing profile flat.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Pseudonymised IP address for audit logging.
 *
 * We never store raw IP addresses; the keyed hash is enough to correlate
 * suspicious activity while staying data minimal (GDPR/DSG).
 */
export function hashIp(secret: string, ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }
  return hmacSha256(secret, `ip:${ip}`).slice(0, 32);
}
