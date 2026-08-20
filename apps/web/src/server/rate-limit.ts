import { consumeRateLimit, type RateLimitRule } from '@swisshub/database';
import { AppError } from '@swisshub/shared';

/**
 * Serverseitige Rate Limits.
 *
 * Die Limits sind bewusst grosszügig genug für echte Moderationsarbeit, aber
 * eng genug, um Automatisierung und Missbrauch zu bremsen.
 */
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 10 * 60 * 1000 },
  oauthCallback: { limit: 20, windowMs: 10 * 60 * 1000 },
  memberSearch: { limit: 40, windowMs: 60 * 1000 },
  jailCreate: { limit: 10, windowMs: 5 * 60 * 1000 },
  jailRelease: { limit: 20, windowMs: 5 * 60 * 1000 },
  settingsWrite: { limit: 30, windowMs: 5 * 60 * 1000 },
  discordAction: { limit: 60, windowMs: 5 * 60 * 1000 },
  reconciliation: { limit: 5, windowMs: 15 * 60 * 1000 },
  discordSync: { limit: 10, windowMs: 5 * 60 * 1000 },
  setupWrite: { limit: 20, windowMs: 15 * 60 * 1000 },
  voteJailStart: { limit: 10, windowMs: 10 * 60 * 1000 },
  communicationSend: { limit: 15, windowMs: 10 * 60 * 1000 },
  brandingUpload: { limit: 10, windowMs: 30 * 60 * 1000 },
  jailImport: { limit: 10, windowMs: 30 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Verbraucht ein Kontingent und wirft bei Überschreitung `RATE_LIMITED`. */
export async function enforceRateLimit(name: RateLimitName, identity: string): Promise<void> {
  const rule = RATE_LIMITS[name];
  const result = await consumeRateLimit(`${name}:${identity}`, rule);
  if (!result.allowed) {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    throw new AppError('RATE_LIMITED', {
      userMessage: `Zu viele Anfragen. Bitte in ${seconds} Sekunden erneut versuchen.`,
      details: { retryAfterSeconds: seconds },
    });
  }
}
