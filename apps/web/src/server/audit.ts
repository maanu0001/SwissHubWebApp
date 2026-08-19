import 'server-only';
import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, verifyAuditChain } from '@swisshub/database';
import { paginate, sanitizeText, toSkipTake, type Paginated } from '@swisshub/shared';
import type { AuditLog, Prisma } from '@swisshub/database';

/** Filter der Audit-Log-Ansicht. Alle Werte werden serverseitig validiert. */
export const auditFilterSchema = z.object({
  actor: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
  target: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
  action: z.string().max(64).optional(),
  module: z.string().max(64).optional(),
  outcome: z.enum(['all', 'success', 'error']).default('all'),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;

export const AUDIT_ACTION_OPTIONS = Object.values(AUDIT_ACTIONS);

export async function loadAuditLog(filter: AuditFilter): Promise<Paginated<AuditLog>> {
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.module ? { module: filter.module } : {}),
    ...(filter.outcome === 'all' ? {} : { success: filter.outcome === 'success' }),
    ...(filter.actor
      ? {
          OR: [
            { actorUsername: { contains: filter.actor, mode: 'insensitive' } },
            { actorDiscordId: filter.actor },
          ],
        }
      : {}),
    ...(filter.target
      ? {
          AND: [
            {
              OR: [
                { targetLabel: { contains: filter.target, mode: 'insensitive' } },
                { targetDiscordId: filter.target },
              ],
            },
          ],
        }
      : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
            ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const { skip, take } = toSkipTake({ page: filter.page, pageSize: filter.pageSize });
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { sequence: 'desc' }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);

  return paginate(items, total, { page: filter.page, pageSize: filter.pageSize });
}

/** Integritätsprüfung der Hash-Chain für die Anzeige im Audit Log. */
export async function checkAuditIntegrity(): Promise<{ valid: boolean; checked: number }> {
  const result = await verifyAuditChain(500);
  return { valid: result.valid, checked: result.checked };
}
