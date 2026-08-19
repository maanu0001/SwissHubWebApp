import { createLogger } from '@swisshub/logger';
import { prisma } from './client';
import type { Prisma, SecuritySeverity } from '@prisma/client';

const log = createLogger('security');

/** Bekannte Sicherheitsereignisse. Module duerfen weitere Typen ergaenzen. */
export const SECURITY_EVENTS = {
  INVALID_SESSION: 'INVALID_SESSION',
  SESSION_REUSE: 'SESSION_REUSE',
  CSRF_FAILED: 'CSRF_FAILED',
  OAUTH_STATE_MISMATCH: 'OAUTH_STATE_MISMATCH',
  OAUTH_FAILED: 'OAUTH_FAILED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_INPUT: 'INVALID_INPUT',
  BLOCKED_ACCOUNT: 'BLOCKED_ACCOUNT',
  AUDIT_CHAIN_BROKEN: 'AUDIT_CHAIN_BROKEN',
} as const;

export type SecurityEventType = (typeof SECURITY_EVENTS)[keyof typeof SECURITY_EVENTS] | (string & {});

export interface SecurityEventInput {
  type: SecurityEventType;
  severity?: SecuritySeverity;
  discordId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Protokolliert ein Sicherheitsereignis.
 *
 * Bewusst ohne automatische Sperre: die Ereignisse dienen der Beobachtung,
 * damit legitime Administratoren sich nicht selbst aussperren koennen.
 */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        type: input.type,
        severity: input.severity ?? 'LOW',
        discordId: input.discordId ?? null,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
        path: input.path ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    log.error('Security Event konnte nicht gespeichert werden', { error, type: input.type });
  }
}

/** Zaehlt Ereignisse eines Typs im angegebenen Zeitfenster (fuer Auffaelligkeiten). */
export async function countRecentSecurityEvents(
  type: SecurityEventType,
  windowMs: number,
  discordId?: string,
): Promise<number> {
  return prisma.securityEvent.count({
    where: {
      type,
      createdAt: { gte: new Date(Date.now() - windowMs) },
      ...(discordId ? { discordId } : {}),
    },
  });
}
