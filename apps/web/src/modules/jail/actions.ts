'use server';

import { revalidatePath } from 'next/cache';
import { jail } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = jail.JAIL_MODULE_ID;

/**
 * Server Actions des Jail-Moduls.
 *
 * Authentifizierung, Mitgliedschaft, CSRF, Rate Limit, Validierung und
 * Autorisierung erledigt `defineAction`; die Moderation Policy prueft der
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
      input,
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
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
      endsAt: result.jail.endsAt.toISOString(),
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
