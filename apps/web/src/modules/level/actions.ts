'use server';

import { revalidatePath } from 'next/cache';
import { level } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = level.LEVEL_MODULE_ID;
const PERMISSIONS = level.LEVEL_PERMISSIONS;

/**
 * Server Actions des Level-Systems.
 *
 * Authentifizierung, Mitgliedschaft, CSRF, Rate Limit, Validierung und
 * Autorisierung erledigt `defineAction`. Die Fachlogik liegt vollständig im
 * Modul - dieselben Funktionen, die auch der Slash Command aufruft.
 */

function revalidateLevel(): void {
  revalidatePath('/level');
  revalidatePath('/level/mitglieder');
  revalidatePath('/level/rangliste');
  revalidatePath('/level/statistiken');
  revalidatePath('/dashboard');
}

export const adjustXpAction = defineAction(
  {
    name: 'level.xp.adjust',
    module: MODULE_ID,
    permission: PERMISSIONS.membersManage,
    schema: level.adjustXpSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await level.adjustXp(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      {
        target: { discordId: input.discordId },
        amount: input.amount,
        reason: input.reason ?? null,
      },
    );

    revalidateLevel();
    return {
      xpBefore: result.xpBefore,
      xpAfter: result.xpAfter,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
      applied: result.delta,
      decayed: result.decayed,
      rolesAdded: result.rolesAdded,
      rolesRemoved: result.rolesRemoved,
    };
  },
);

export const upsertMilestoneAction = defineAction(
  {
    name: 'level.milestones.upsert',
    module: MODULE_ID,
    permission: PERMISSIONS.rolesManage,
    schema: level.milestoneSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const milestone = await level.upsertMilestone(input);
    revalidatePath('/level/rollen');
    return { level: milestone.level, roleId: milestone.roleId, enabled: milestone.enabled };
  },
);

export const deleteMilestoneAction = defineAction(
  {
    name: 'level.milestones.delete',
    module: MODULE_ID,
    permission: PERMISSIONS.rolesManage,
    schema: level.milestoneDeleteSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ input }) => {
    await level.deleteMilestone(input.level);
    revalidatePath('/level/rollen');
    return { level: input.level };
  },
);

/**
 * Gleicht die Level-Rollen aller Mitglieder ab.
 *
 * Eigenes Rate Limit, weil ein Durchgang je Mitglied Discord anfragt.
 */
export const reconcileMilestonesAction = defineAction(
  {
    name: 'level.milestones.reconcile',
    module: MODULE_ID,
    permission: PERMISSIONS.rolesManage,
    schema: level.reconcileSchema,
    rateLimit: 'reconciliation',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const settings = await level.readLevelSettings();
    const result = await level.reconcileMilestones({
      limit: input.limit,
      maxLevelTotalXp: settings.maxLevelTotalXp,
    });
    revalidatePath('/level/rollen');
    return result;
  },
);

/** Führt den Inaktivitäts-Abzug sofort aus, statt auf den Zeitplan zu warten. */
export const runDecayAction = defineAction(
  {
    name: 'level.decay.run',
    module: MODULE_ID,
    permission: PERMISSIONS.decayManage,
    schema: level.runDecaySchema,
    rateLimit: 'reconciliation',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await level.runDecaySweep({ limit: input.limit });
    revalidatePath('/level/inaktivitaet');
    revalidateLevel();
    return result;
  },
);

/** Bricht eine laufende Partie ab und gibt die Einsätze zurück. */
export const cancelGameAction = defineAction(
  {
    name: 'level.games.cancel',
    module: MODULE_ID,
    permission: PERMISSIONS.gamesManage,
    schema: level.cancelGameSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const match = await level.closeGame(
      input.matchId,
      'CANCELLED',
      input.reason ?? 'Vom Dashboard abgebrochen',
    );
    revalidatePath('/level/spiele');
    revalidateLevel();
    return { matchId: match.id, status: match.status };
  },
);

export const confirmLevelImportAction = defineAction(
  {
    name: 'level.import.confirm',
    module: MODULE_ID,
    permission: PERMISSIONS.import,
    schema: level.importConfirmSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const result = await level.executeLevelImport(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.importId,
      { legacyBotStopped: input.legacyBotStopped, importSettings: input.importSettings },
    );
    revalidatePath('/level/import');
    revalidateLevel();
    return result;
  },
);

export const discardLevelImportAction = defineAction(
  {
    name: 'level.import.discard',
    module: MODULE_ID,
    permission: PERMISSIONS.import,
    schema: level.importDiscardSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await level.discardLevelImport(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.importId,
    );
    revalidatePath('/level/import');
    return { importId: input.importId };
  },
);
