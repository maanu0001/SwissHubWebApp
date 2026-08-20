import { prisma, type LevelMilestoneRole } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { levelFromXp } from './curve';

const logger = createLogger('level.milestones');

/**
 * Rollen, die an ein Level gebunden sind.
 *
 * Der Vorgänger las sie aus `MILESTONE_ROLES="5:ROLEID,10:ROLEID"` und vergab
 * bzw. entzog sie bei jeder XP-Buchung. Die Regel bleibt: wer das Level
 * erreicht hat, bekommt die Rolle - wer darunter fällt, verliert sie wieder.
 */
export interface MilestonePlan {
  /** Rollen, die vergeben werden müssen. */
  add: LevelMilestoneRole[];
  /** Rollen, die entzogen werden müssen. */
  remove: LevelMilestoneRole[];
}

/**
 * Vergleicht Soll und Ist, ohne etwas zu ändern.
 *
 * Getrennt vom Schreiben, damit das Dashboard denselben Plan als Vorschau
 * anzeigen kann, den der Bot anschliessend ausführt.
 */
export function planMilestones(
  milestones: readonly LevelMilestoneRole[],
  level: number,
  currentRoleIds: readonly string[],
): MilestonePlan {
  const owned = new Set(currentRoleIds);
  const add: LevelMilestoneRole[] = [];
  const remove: LevelMilestoneRole[] = [];

  for (const milestone of [...milestones].sort((a, b) => a.level - b.level)) {
    if (!milestone.enabled) {
      continue;
    }
    const shouldHave = level >= milestone.level;
    const hasRole = owned.has(milestone.roleId);
    if (shouldHave && !hasRole) {
      add.push(milestone);
    } else if (!shouldHave && hasRole) {
      remove.push(milestone);
    }
  }

  return { add, remove };
}

export async function listMilestones(): Promise<LevelMilestoneRole[]> {
  return prisma.levelMilestoneRole.findMany({ orderBy: { level: 'asc' } });
}

export interface SyncMilestonesResult {
  level: number;
  added: string[];
  removed: string[];
  /** Rollen, die der Bot nicht vergeben durfte. */
  failed: string[];
}

/**
 * Gleicht die Meilenstein-Rollen einer Person mit ihrem Level ab.
 *
 * Fehlschläge einzelner Rollen brechen den Abgleich nicht ab: eine Rolle über
 * dem Bot in der Hierarchie darf nicht dazu führen, dass die übrigen Rollen
 * ebenfalls ausbleiben.
 */
export async function syncMilestoneRoles(
  discordId: string,
  xp: number,
  options: {
    gateway?: DiscordGateway;
    maxLevelTotalXp?: number;
    /** Bereits bekannte Rollen - erspart eine Abfrage. */
    currentRoleIds?: readonly string[];
    milestones?: readonly LevelMilestoneRole[];
    reason?: string;
  } = {},
): Promise<SyncMilestonesResult> {
  const gateway = options.gateway ?? defaultDiscord;
  const level = levelFromXp(xp, options.maxLevelTotalXp);
  const milestones = options.milestones ?? (await listMilestones());

  const enabled = milestones.filter((entry) => entry.enabled);
  if (enabled.length === 0) {
    return { level, added: [], removed: [], failed: [] };
  }

  let currentRoleIds = options.currentRoleIds;
  if (!currentRoleIds) {
    const member = await gateway.members.get(discordId).catch(() => null);
    if (!member) {
      return { level, added: [], removed: [], failed: [] };
    }
    currentRoleIds = member.roleIds;
  }

  const plan = planMilestones(enabled, level, currentRoleIds ?? []);
  const reason = options.reason ?? `Level ${level}`;
  const added: string[] = [];
  const removed: string[] = [];
  const failed: string[] = [];

  for (const milestone of plan.add) {
    try {
      await gateway.roles.add(discordId, milestone.roleId, reason);
      added.push(milestone.roleId);
    } catch (error) {
      failed.push(milestone.roleId);
      logger.warn('Meilenstein-Rolle konnte nicht vergeben werden', {
        discordId,
        roleId: milestone.roleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const milestone of plan.remove) {
    try {
      await gateway.roles.remove(discordId, milestone.roleId, reason);
      removed.push(milestone.roleId);
    } catch (error) {
      failed.push(milestone.roleId);
      logger.warn('Meilenstein-Rolle konnte nicht entzogen werden', {
        discordId,
        roleId: milestone.roleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { level, added, removed, failed };
}

export interface ReconciliationEntry {
  discordId: string;
  username: string | null;
  displayName: string | null;
  xp: number;
  level: number;
  add: Array<{ level: number; roleId: string }>;
  remove: Array<{ level: number; roleId: string }>;
}

export interface ReconciliationPreview {
  entries: ReconciliationEntry[];
  /** Wie viele Profile geprüft wurden. */
  checked: number;
  /** Wie viele davon eine Änderung brauchen. */
  affected: number;
  /** Discord war nicht erreichbar - die Vorschau ist unvollständig. */
  incomplete: boolean;
}

/**
 * Vorschau des Abgleichs für alle Mitglieder.
 *
 * Ohne diese Vorschau wäre eine falsch eingetragene Rolle erst dann sichtbar,
 * wenn sie bereits hunderten Leuten vergeben wurde.
 */
export async function previewMilestoneReconciliation(
  options: { gateway?: DiscordGateway; maxLevelTotalXp?: number; limit?: number } = {},
): Promise<ReconciliationPreview> {
  const gateway = options.gateway ?? defaultDiscord;
  const milestones = (await listMilestones()).filter((entry) => entry.enabled);
  if (milestones.length === 0) {
    return { entries: [], checked: 0, affected: 0, incomplete: false };
  }

  const profiles = await prisma.levelProfile.findMany({
    orderBy: { xp: 'desc' },
    take: options.limit ?? 2000,
  });

  const entries: ReconciliationEntry[] = [];
  let incomplete = false;

  for (const profile of profiles) {
    const member = await gateway.members.get(profile.discordId).catch(() => null);
    if (!member) {
      // Wer den Server verlassen hat, braucht keinen Abgleich. Ein Ausfall
      // von Discord sieht an dieser Stelle allerdings genauso aus, deshalb
      // wird die Vorschau als unvollständig gekennzeichnet.
      incomplete = true;
      continue;
    }
    const level = levelFromXp(profile.xp, options.maxLevelTotalXp);
    const plan = planMilestones(milestones, level, member.roleIds);
    if (plan.add.length === 0 && plan.remove.length === 0) {
      continue;
    }
    entries.push({
      discordId: profile.discordId,
      username: profile.username,
      displayName: profile.displayName,
      xp: profile.xp,
      level,
      add: plan.add.map((entry) => ({ level: entry.level, roleId: entry.roleId })),
      remove: plan.remove.map((entry) => ({ level: entry.level, roleId: entry.roleId })),
    });
  }

  return {
    entries,
    checked: profiles.length,
    affected: entries.length,
    incomplete,
  };
}

// --- Verwaltung -------------------------------------------------------------

export interface MilestoneInput {
  level: number;
  roleId: string;
  enabled?: boolean;
}

/**
 * Legt eine Level-Rolle an oder ändert sie.
 *
 * Ein Level trägt genau eine Rolle - deshalb ist `level` der Schlüssel.
 */
export async function upsertMilestone(input: MilestoneInput): Promise<LevelMilestoneRole> {
  const { conflict } = await import('@swisshub/shared');
  const level = Math.trunc(input.level);
  if (level < 1 || level > 100) {
    throw conflict('Das Level muss zwischen 1 und 100 liegen.');
  }
  return prisma.levelMilestoneRole.upsert({
    where: { level },
    create: { level, roleId: input.roleId, enabled: input.enabled ?? true },
    update: { roleId: input.roleId, ...(input.enabled === undefined ? {} : { enabled: input.enabled }) },
  });
}

export async function deleteMilestone(level: number): Promise<void> {
  await prisma.levelMilestoneRole.deleteMany({ where: { level: Math.trunc(level) } });
}

export interface ReconciliationResult {
  processed: number;
  rolesAdded: number;
  rolesRemoved: number;
  failed: number;
}

/**
 * Gleicht die Level-Rollen aller Mitglieder ab.
 *
 * Nötig, weil der Bot Rollen nur bei einer XP-Änderung nachzieht: wer seit der
 * Einrichtung einer neuen Level-Rolle keine XP mehr gesammelt hat, bekäme sie
 * sonst nie.
 */
export async function reconcileMilestones(
  options: { gateway?: DiscordGateway; maxLevelTotalXp?: number; limit?: number } = {},
): Promise<ReconciliationResult> {
  const gateway = options.gateway ?? defaultDiscord;
  const milestones = (await listMilestones()).filter((entry) => entry.enabled);
  if (milestones.length === 0) {
    return { processed: 0, rolesAdded: 0, rolesRemoved: 0, failed: 0 };
  }

  const profiles = await prisma.levelProfile.findMany({
    orderBy: { xp: 'desc' },
    take: options.limit ?? 2000,
    select: { discordId: true, xp: true },
  });

  let processed = 0;
  let rolesAdded = 0;
  let rolesRemoved = 0;
  let failed = 0;

  for (const profile of profiles) {
    const result = await syncMilestoneRoles(profile.discordId, profile.xp, {
      gateway,
      maxLevelTotalXp: options.maxLevelTotalXp,
      milestones,
      reason: 'Abgleich der Level-Rollen',
    }).catch(() => null);

    if (!result) {
      failed += 1;
      continue;
    }
    processed += 1;
    rolesAdded += result.added.length;
    rolesRemoved += result.removed.length;
    failed += result.failed.length;
  }

  return { processed, rolesAdded, rolesRemoved, failed };
}
