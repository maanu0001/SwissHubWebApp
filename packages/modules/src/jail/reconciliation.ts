import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import type { Prisma, ReconciliationMode } from '@swisshub/database';
import { JAIL_MODULE_ID } from './config';
import { loadJailContext } from './context';
import { releaseJail } from './service';

const log = createLogger('jail:reconciliation');

export type JailDriftType = 'MEMBER_LEFT' | 'JAIL_ROLE_MISSING' | 'ORPHAN_JAIL_ROLE' | 'EXPIRED_NOT_RELEASED';

export interface JailDrift {
  type: JailDriftType;
  jailId?: string;
  discordId: string;
  label: string;
  repaired: boolean;
  detail?: string;
}

export interface ReconciliationSummary {
  runId: string;
  checked: number;
  drift: JailDrift[];
  repaired: number;
  failed: number;
}

export interface ReconcileOptions {
  mode?: ReconciliationMode;
  triggeredBy?: string | null;
  /** Abweichungen automatisch korrigieren. */
  repair?: boolean;
  /** Mitglieder mit Jail-Rolle ohne aktiven Jail suchen (teurer). */
  scanOrphans?: boolean;
  gateway?: DiscordGateway;
}

const ORPHAN_SCAN_LIMIT = 1000;

/**
 * Gleicht Datenbank- und Discord-Zustand ab.
 *
 * Discord-Aktionen und Datenbank lassen sich nicht in einer gemeinsamen
 * Transaktion ausfuehren. Reconciliation erkennt deshalb Abweichungen
 * (z.B. "DB sagt gejailt, Jail-Rolle fehlt") und korrigiert sie kontrolliert.
 */
export async function reconcileJails(options: ReconcileOptions = {}): Promise<ReconciliationSummary> {
  const gateway = options.gateway ?? defaultDiscord;
  const repair = options.repair ?? true;
  const run = await prisma.reconciliationRun.create({
    data: {
      module: JAIL_MODULE_ID,
      mode: options.mode ?? 'AUTOMATIC',
      triggeredBy: options.triggeredBy ?? null,
    },
  });

  const drift: JailDrift[] = [];
  let repaired = 0;
  let failed = 0;
  let checked = 0;

  try {
    const context = await loadJailContext(gateway);
    const jailRoleId = context.settings.jailRoleId;
    if (!jailRoleId) {
      throw new Error('Keine Jail-Rolle konfiguriert');
    }

    const activeJails = await prisma.jailEntry.findMany({
      where: { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] } },
      orderBy: { startedAt: 'asc' },
      take: 500,
    });

    const activeByDiscordId = new Map(activeJails.map((jail) => [jail.targetDiscordId, jail]));

    for (const jail of activeJails) {
      checked += 1;
      const member = await gateway.members.get(jail.targetDiscordId).catch(() => null);

      if (!member) {
        const entry: JailDrift = {
          type: 'MEMBER_LEFT',
          jailId: jail.id,
          discordId: jail.targetDiscordId,
          label: jail.targetUsername,
          repaired: false,
          detail: 'Mitglied ist nicht mehr auf dem Server.',
        };
        drift.push(entry);
        if (repair) {
          try {
            await releaseJail(jail.id, { releaseType: 'RECONCILED', gateway, context });
            entry.repaired = true;
            repaired += 1;
          } catch (error) {
            failed += 1;
            log.warn('Reconciliation konnte Eintrag nicht schliessen', { error, jailId: jail.id });
          }
        }
        continue;
      }

      if (!member.roleIds.includes(jailRoleId)) {
        const expired = jail.endsAt <= new Date();
        const entry: JailDrift = {
          type: expired ? 'EXPIRED_NOT_RELEASED' : 'JAIL_ROLE_MISSING',
          jailId: jail.id,
          discordId: jail.targetDiscordId,
          label: member.displayName,
          repaired: false,
          detail: expired
            ? 'Jail ist abgelaufen, wurde aber noch nicht sauber beendet.'
            : 'Jail-Rolle fehlt auf Discord.',
        };
        drift.push(entry);

        if (repair) {
          try {
            if (expired) {
              await releaseJail(jail.id, { releaseType: 'RECONCILED', gateway, context });
            } else {
              await gateway.roles.add(
                member.discordId,
                jailRoleId,
                'Reconciliation: Jail-Rolle wiederhergestellt',
              );
            }
            entry.repaired = true;
            repaired += 1;
          } catch (error) {
            failed += 1;
            log.warn('Reconciliation-Reparatur fehlgeschlagen', { error, jailId: jail.id });
          }
        }
      }
    }

    if (options.scanOrphans) {
      const orphans = await findOrphanJailRoleHolders(gateway, jailRoleId, activeByDiscordId);
      checked += orphans.checked;
      for (const orphan of orphans.members) {
        drift.push({
          type: 'ORPHAN_JAIL_ROLE',
          discordId: orphan.discordId,
          label: orphan.displayName,
          repaired: false,
          detail: 'Traegt die Jail-Rolle, obwohl kein aktiver Jail existiert.',
        });
      }
    }

    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        checked,
        drift: drift.length,
        repaired,
        failed,
        details: { drift } as unknown as Prisma.InputJsonValue,
      },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.RECONCILIATION_RUN,
      module: JAIL_MODULE_ID,
      actorDiscordId: options.triggeredBy ?? null,
      actorUsername: options.triggeredBy ? undefined : 'system',
      success: true,
      metadata: { runId: run.id, checked, drift: drift.length, repaired, failed },
    });

    log.info('Jail-Reconciliation abgeschlossen', { checked, drift: drift.length, repaired, failed });
    return { runId: run.id, checked, drift, repaired, failed };
  } catch (error) {
    await prisma.reconciliationRun
      .update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          checked,
          drift: drift.length,
          repaired,
          failed: failed + 1,
          details: { error: error instanceof Error ? error.message : 'unbekannt' } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Sucht Mitglieder, die die Jail-Rolle tragen, ohne dass ein aktiver Jail
 * existiert. Der Scan ist bewusst begrenzt, um Discord nicht zu ueberlasten.
 */
async function findOrphanJailRoleHolders(
  gateway: DiscordGateway,
  jailRoleId: string,
  activeByDiscordId: Map<string, unknown>,
): Promise<{ checked: number; members: Array<{ discordId: string; displayName: string }> }> {
  const found: Array<{ discordId: string; displayName: string }> = [];
  let after: string | undefined;
  let checked = 0;

  while (checked < ORPHAN_SCAN_LIMIT) {
    const batch = await gateway.members.list({ limit: 200, after });
    if (batch.length === 0) {
      break;
    }
    checked += batch.length;
    for (const member of batch) {
      if (member.roleIds.includes(jailRoleId) && !activeByDiscordId.has(member.discordId)) {
        found.push({ discordId: member.discordId, displayName: member.displayName });
      }
    }
    after = batch[batch.length - 1]?.discordId;
    if (batch.length < 200) {
      break;
    }
  }

  return { checked, members: found };
}
