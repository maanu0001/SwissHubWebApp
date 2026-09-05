import { prisma, recordAudit, AUDIT_ACTIONS, Prisma } from '@swisshub/database';
import type { MigrationRun, MigrationRunStatus } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import type { MigrationPackage } from './package';
import type { Mappings, MigrationsPlan } from './plan';

/**
 * Der Lauf als Vorgang.
 *
 * Er steht in der Datenbank, weil eine Übertragung mehrere Sitzungen
 * überdauert: Rollen zuordnen, Kanäle zuordnen, Probelauf ansehen, jemanden
 * fragen, am nächsten Tag anwenden. Ein Assistent, der das im Browser hält,
 * verliert alles beim Neuladen - und beim Neustart der Anwendung ohnehin.
 */

export interface LaufAnlegen {
  sourceGuildId: string;
  sourceGuildName: string;
  targetGuildId: string;
  paket: MigrationPackage;
  actor: { discordId: string; username: string };
}

export async function legeLaufAn(eingabe: LaufAnlegen): Promise<MigrationRun> {
  const lauf = await prisma.migrationRun.create({
    data: {
      sourceGuildId: eingabe.sourceGuildId,
      targetGuildId: eingabe.targetGuildId,
      status: 'DRAFT',
      package: eingabe.paket as never,
      mappings: { roles: [], channels: [] } as never,
      createdByDiscordId: eingabe.actor.discordId,
      createdByUsername: eingabe.actor.username,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.MIGRATION_CREATED,
    module: 'migration',
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetLabel: `${eingabe.sourceGuildName} → ${eingabe.targetGuildId}`,
    metadata: {
      runId: lauf.id,
      module: eingabe.paket.modules.length,
      rollen: eingabe.paket.roles.length,
      automationen: eingabe.paket.automations.length,
    },
  });

  return lauf;
}

/**
 * Einen Lauf holen - und dabei prüfen, dass er hierher gehört.
 *
 * Die Guild steht in der Bedingung und nicht bloss im Ergebnis. Sonst liesse
 * sich mit einer fremden Lauf-ID der Zustand einer anderen Installation
 * lesen: eine ID ist keine Berechtigung.
 */
export async function holeLauf(runId: string, sourceGuildId: string): Promise<MigrationRun> {
  const lauf = await prisma.migrationRun.findFirst({ where: { id: runId, sourceGuildId } });
  if (!lauf) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Übertragung gibt es nicht.' });
  }
  return lauf;
}

export async function listeLaeufe(sourceGuildId: string, limit = 25): Promise<MigrationRun[]> {
  return prisma.migrationRun.findMany({
    where: { sourceGuildId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

/**
 * Die Zuordnung speichern.
 *
 * Nur solange der Lauf noch nicht angewendet wurde. Eine Zuordnung nach dem
 * Anwenden zu ändern hiesse, den Bericht von seinem Gegenstand zu lösen -
 * dort stünde dann, was gemappt wurde, und hier etwas anderes.
 */
export async function speichereZuordnung(
  runId: string,
  sourceGuildId: string,
  mappings: Mappings,
  actor: { discordId: string; username: string },
): Promise<MigrationRun> {
  const lauf = await holeLauf(runId, sourceGuildId);
  if (!AENDERBAR.has(lauf.status)) {
    throw new AppError('CONFLICT', {
      userMessage: 'Diese Übertragung wurde bereits angewendet und lässt sich nicht mehr ändern.',
    });
  }

  const aktualisiert = await prisma.migrationRun.update({
    where: { id: runId },
    // `plan` wird verworfen: eine geaenderte Zuordnung macht den alten
    // Probelauf falsch, und ein falscher Probelauf ist schlimmer als keiner.
    data: { mappings: mappings as never, status: 'DRAFT', plan: Prisma.DbNull },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.MIGRATION_MAPPED,
    module: 'migration',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: `Zuordnung geändert (${runId})`,
    metadata: {
      runId,
      rollen: mappings.roles.filter((eintrag) => eintrag.art === 'MAP').length,
      kanaele: mappings.channels.filter((eintrag) => eintrag.art === 'MAP').length,
    },
  });

  return aktualisiert;
}

/** Zustände, in denen sich am Lauf noch etwas ändern lässt. */
const AENDERBAR = new Set<MigrationRunStatus>(['DRAFT', 'VALIDATING', 'READY']);

export function istAenderbar(status: MigrationRunStatus): boolean {
  return AENDERBAR.has(status);
}

export async function speicherePlan(
  runId: string,
  plan: MigrationsPlan,
  actor: { discordId: string; username: string },
): Promise<void> {
  await prisma.migrationRun.update({
    where: { id: runId },
    data: { plan: plan as never, status: 'READY' },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.MIGRATION_DRY_RUN,
    module: 'migration',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: `Probelauf (${runId})`,
    metadata: {
      runId,
      module: plan.module.length,
      automationen: plan.automationen.length,
      warnungen: plan.warnungen.length,
    },
  });
}

/** Das Paket eines Laufs, wieder als Typ statt als `Json`. */
export function paketVon(lauf: MigrationRun): MigrationPackage {
  return lauf.package as unknown as MigrationPackage;
}

export function zuordnungVon(lauf: MigrationRun): Mappings {
  const roh = lauf.mappings as unknown as Partial<Mappings> | null;
  return { roles: roh?.roles ?? [], channels: roh?.channels ?? [] };
}

export function planVon(lauf: MigrationRun): MigrationsPlan | null {
  return (lauf.plan as unknown as MigrationsPlan | null) ?? null;
}
