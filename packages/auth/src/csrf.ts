import { env } from '@swisshub/config';
import { hmacSha256, safeEqual } from '@swisshub/shared/crypto';

/**
 * CSRF-Schutz (Double Submit + sessiongebundener HMAC).
 *
 * Next.js prüft bei Server Actions bereits den Origin-Header. Der Token hier
 * ist die zweite Verteidigungslinie (Defense in Depth) und schützt zusätzlich
 * die Route Handler.
 */
export function issueCsrfToken(sessionId: string): string {
  return hmacSha256(env.AUTH_SECRET, `csrf:${sessionId}`);
}

export function verifyCsrfToken(sessionId: string, token: string | null | undefined): boolean {
  if (!token) {
    return false;
  }
  return safeEqual(issueCsrfToken(sessionId), token);
}
