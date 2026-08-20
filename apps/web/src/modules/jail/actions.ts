'use server';

import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { jail } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = jail.JAIL_MODULE_ID;

/**
 * Server Actions des Jail-Moduls.
 *
 * Authentifizierung, Mitgliedschaft, CSRF, Rate Limit, Validierung und
 * Autorisierung erledigt `defineAction`; die Moderation Policy prüft der
 * Service selbst nochmals gegen die aktuellen Discord-Rollen.
 */
export const createJailAction = defineAction(
  {
    name: 'jail.create',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.create,
    schema: jail.createJailSchema,
    rateLimit: 'jailCreate',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await jail.createJail(
      // Herkunft ist fest: dieselbe Aktion aus dem Dashboard.
      { ...input, source: 'DASHBOARD' },
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
        roleIds: ctx.roleIds,
        isOwner: ctx.user.isOwner,
        moderationLevel: ctx.moderationLevel,
      },
      { metadata },
    );

    revalidatePath('/jail');
    revalidatePath('/dashboard');
    revalidatePath(`/members/${input.targetDiscordId}`);

    return {
      jailId: result.jail.id,
      endsAt: result.jail.endsAt?.toISOString() ?? null,
      permanent: result.jail.type === 'PERMANENT',
      silent: result.jail.silent,
      warnings: result.warnings,
      duplicate: result.duplicate,
    };
  },
);

export const releaseJailAction = defineAction(
  {
    name: 'jail.release',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.release,
    schema: jail.releaseJailSchema,
    rateLimit: 'jailRelease',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await jail.releaseJail(input.jailId, {
      releaseType: 'MANUAL',
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      metadata,
      actor: {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
        roleIds: ctx.roleIds,
        isOwner: ctx.user.isOwner,
        moderationLevel: ctx.moderationLevel,
      },
    });

    revalidatePath('/jail');
    revalidatePath('/dashboard');
    revalidatePath(`/members/${result.jail.targetDiscordId}`);

    return {
      jailId: result.jail.id,
      restoredRoles: result.restoredRoleIds.length,
      failedRoles: result.failedRoleIds.length,
      warnings: result.warnings,
      memberLeftGuild: result.memberLeftGuild,
    };
  },
);

/**
 * Vote Jail starten.
 *
 * Die Abstimmung ist eine Vorstufe des regulären Jails - die eigentliche
 * Ausführung übernimmt später `createJail`. Deshalb genügt hier die
 * Berechtigung `jail.vote.start`; alle weiteren Prüfungen macht der Service.
 */
export const startVoteJailAction = defineAction(
  {
    name: 'jail.vote.start',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.voteStart,
    schema: jail.startVoteJailSchema,
    rateLimit: 'voteJailStart',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const vote = await jail.startVoteJail(
      input,
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
        roleIds: ctx.roleIds,
        isOwner: ctx.user.isOwner,
        moderationLevel: ctx.moderationLevel,
        // Sperrfrist ist eine gewöhnliche Berechtigung, keine feste Rolle.
        bypassCooldown: can(ctx, jail.JAIL_PERMISSIONS.voteBypassCooldown),
      },
      { metadata },
    );

    revalidatePath('/jail/votes');
    revalidatePath('/jail');
    return {
      voteJailId: vote.id,
      requiredVotes: vote.requiredVotes,
      expiresAt: vote.expiresAt.toISOString(),
    };
  },
);

/**
 * Übernahme des analysierten Imports.
 *
 * Getrennt vom Upload: die Analyse allein verändert nichts, erst hier
 * entstehen Jail-Einträge. Die Bestätigung, dass der alte Bot gestoppt ist,
 * ist Pflicht - zwei gleichzeitig laufende Bots würden sich gegenseitig
 * überschreiben.
 */
export const confirmJailImportAction = defineAction(
  {
    name: 'jail.import.confirm',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.import,
    schema: jail.confirmJailImportSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await jail.executeLegacyImport(
      input.importId,
      { discordId: ctx.user.discordId, username: ctx.user.username },
      { legacyBotStopped: input.legacyBotStopped },
    );

    revalidatePath('/jail');
    revalidatePath('/jail/import');
    revalidatePath('/dashboard');

    return {
      importId: result.importRecord.id,
      imported: result.imported,
      cooldowns: result.cooldowns,
      reconciliation: result.reconciliation,
    };
  },
);

/** Verwirft eine Analyse, ohne etwas zu übernehmen. */
export const discardJailImportAction = defineAction(
  {
    name: 'jail.import.discard',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.import,
    schema: jail.discardJailImportSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await jail.discardLegacyImport(input.importId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/jail/import');
    return { importId: input.importId };
  },
);
