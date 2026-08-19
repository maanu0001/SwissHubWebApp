import { createHash } from 'node:crypto';
import { createLogger } from '@swisshub/logger';
import { prisma } from './client';
import type { Prisma, PrismaClient } from '@prisma/client';

const log = createLogger('audit');

/**
 * Zentrale Audit-Aktionen.
 *
 * Module duerfen eigene Aktionen ergaenzen; das Feld bleibt bewusst ein String,
 * damit neue Module nichts an der Kernstruktur aendern muessen.
 */
export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGIN_DENIED: 'LOGIN_DENIED',
  LOGOUT: 'LOGOUT',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  SETTING_CHANGED: 'SETTING_CHANGED',
  ROLE_MAPPING_CHANGED: 'ROLE_MAPPING_CHANGED',
  MODULE_ENABLED: 'MODULE_ENABLED',
  MODULE_DISABLED: 'MODULE_DISABLED',
  MODULE_SETTINGS_CHANGED: 'MODULE_SETTINGS_CHANGED',
  DISCORD_ACTION_FAILED: 'DISCORD_ACTION_FAILED',
  JAIL_CREATED: 'JAIL_CREATED',
  JAIL_RELEASED: 'JAIL_RELEASED',
  JAIL_FAILED: 'JAIL_FAILED',
  JAIL_RECONCILED: 'JAIL_RECONCILED',
  MEMBERS_SEARCHED: 'MEMBERS_SEARCHED',
  RECONCILIATION_RUN: 'RECONCILIATION_RUN',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

export interface AuditInput {
  action: AuditAction;
  module?: string | null;
  actorDiscordId?: string | null;
  actorUsername?: string | null;
  targetDiscordId?: string | null;
  targetLabel?: string | null;
  success?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
}

/** Advisory lock id - serialises audit inserts so the hash chain stays linear. */
const AUDIT_LOCK_ID = 7_734_010_1;

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Deterministic serialisation so the hash can be recomputed later. */
function canonicalise(entry: {
  createdAt: Date;
  action: string;
  module: string | null;
  actorDiscordId: string | null;
  targetDiscordId: string | null;
  success: boolean;
  errorCode: string | null;
  metadata: unknown;
}): string {
  return JSON.stringify([
    entry.createdAt.toISOString(),
    entry.action,
    entry.module ?? '',
    entry.actorDiscordId ?? '',
    entry.targetDiscordId ?? '',
    entry.success ? 1 : 0,
    entry.errorCode ?? '',
    stableStringify(entry.metadata),
  ]);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export function computeAuditHash(previousHash: string | null, payload: string): string {
  return createHash('sha256')
    .update(`${previousHash ?? 'GENESIS'}|${payload}`, 'utf8')
    .digest('hex');
}

/**
 * Schreibt einen Audit-Eintrag inklusive Hash-Chain.
 *
 * Der Eintrag verweist per `previousHash` auf seinen Vorgaenger. Nachtraegliche
 * Manipulationen einzelner Zeilen brechen dadurch die Kette und werden von
 * `verifyAuditChain()` erkannt.
 */
export async function recordAudit(input: AuditInput): Promise<{ id: string; hash: string }> {
  const createdAt = new Date();
  const metadata = (input.metadata ?? {}) as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx: TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_ID}::bigint)`;
    const previous = await tx.auditLog.findFirst({
      orderBy: { sequence: 'desc' },
      select: { hash: true },
    });

    const payload = canonicalise({
      createdAt,
      action: input.action,
      module: input.module ?? null,
      actorDiscordId: input.actorDiscordId ?? null,
      targetDiscordId: input.targetDiscordId ?? null,
      success: input.success ?? true,
      errorCode: input.errorCode ?? null,
      metadata: input.metadata ?? {},
    });
    const hash = computeAuditHash(previous?.hash ?? null, payload);

    const created = await tx.auditLog.create({
      data: {
        createdAt,
        action: input.action,
        module: input.module ?? null,
        actorDiscordId: input.actorDiscordId ?? null,
        actorUsername: input.actorUsername ?? null,
        targetDiscordId: input.targetDiscordId ?? null,
        targetLabel: input.targetLabel ?? null,
        success: input.success ?? true,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
        previousHash: previous?.hash ?? null,
        hash,
      },
      select: { id: true, hash: true },
    });

    return created;
  });
}

/**
 * Audit-Schreibvorgang, der niemals den Aufrufer scheitern laesst.
 *
 * Eine bereits ausgefuehrte Discord-Aktion darf nicht nachtraeglich "fehlschlagen",
 * nur weil das Logging nicht moeglich war - der Fehler wird stattdessen laut
 * protokolliert.
 */
export async function safeRecordAudit(input: AuditInput): Promise<void> {
  try {
    await recordAudit(input);
  } catch (error) {
    log.error('Audit-Eintrag konnte nicht geschrieben werden', { error, action: input.action });
  }
}

export interface AuditChainVerification {
  checked: number;
  valid: boolean;
  brokenAt?: { id: string; sequence: string };
}

/** Prueft die Hash-Chain der letzten `limit` Eintraege. */
export async function verifyAuditChain(limit = 1000): Promise<AuditChainVerification> {
  const entries = await prisma.auditLog.findMany({
    orderBy: { sequence: 'desc' },
    take: limit,
  });
  const ascending = entries.reverse();

  let expectedPrevious: string | null = ascending[0]?.previousHash ?? null;
  for (const entry of ascending) {
    const payload = canonicalise({
      createdAt: entry.createdAt,
      action: entry.action,
      module: entry.module,
      actorDiscordId: entry.actorDiscordId,
      targetDiscordId: entry.targetDiscordId,
      success: entry.success,
      errorCode: entry.errorCode,
      metadata: entry.metadata,
    });
    const expectedHash = computeAuditHash(expectedPrevious, payload);
    if (entry.previousHash !== expectedPrevious || entry.hash !== expectedHash) {
      return {
        checked: ascending.length,
        valid: false,
        brokenAt: { id: entry.id, sequence: entry.sequence.toString() },
      };
    }
    expectedPrevious = entry.hash;
  }

  return { checked: ascending.length, valid: true };
}
