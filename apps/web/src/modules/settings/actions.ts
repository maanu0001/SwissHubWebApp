'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { invalidateRoleConfiguration, isKnownPermission, listPermissions } from '@swisshub/permissions';
import {
  coreSettingsSchema,
  getModuleDefinition,
  jail,
  setCoreSettings,
  setModuleEnabled,
  setModuleSettings,
} from '@swisshub/modules';
import { AppError, sanitizeText, snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Einstellungen ändern.
 *
 * Jede Änderung wird validiert, autorisiert, gespeichert und im Audit Log
 * protokolliert. Discord-IDs werden zusätzlich gegen die Guild geprüft -
 * eine erfundene Rollen-ID lässt sich so nicht speichern.
 */
async function assertRoleExists(roleId: string | undefined, label: string): Promise<void> {
  if (!roleId) {
    return;
  }
  const roles = await discord.roles.list({ force: true });
  if (!roles.some((role) => role.id === roleId)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `${label}: Diese Rolle existiert auf dem Discord-Server nicht.`,
    });
  }
}

async function assertChannelExists(channelId: string | undefined, label: string): Promise<void> {
  if (!channelId) {
    return;
  }
  const channels = await discord.channels.list({ force: true });
  if (!channels.some((channel) => channel.id === channelId)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `${label}: Dieser Channel existiert nicht oder ist kein Textkanal.`,
    });
  }
}

export const updateCoreSettingsAction = defineAction(
  {
    name: 'settings.core.update',
    module: 'settings',
    permission: 'settings.edit',
    schema: coreSettingsSchema,
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertChannelExists(input.moderationLogChannelId, 'Moderations-Log');

    const saved = await setCoreSettings(input, ctx.user.discordId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.SETTING_CHANGED,
      module: 'settings',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      success: true,
      metadata: { scope: 'core', keys: Object.keys(saved) },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/settings');
    return { saved: true };
  },
);

export const updateJailSettingsAction = defineAction(
  {
    name: 'settings.jail.update',
    module: jail.JAIL_MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.settings,
    schema: jail.jailSettingsSchema,
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertRoleExists(input.jailRoleId, 'Jail-Rolle');
    await assertChannelExists(input.jailChannelId, 'Jail-Channel');
    await assertChannelExists(input.moderationLogChannelId, 'Moderations-Log');

    // Die Jail-Rolle muss unterhalb der Bot-Rolle liegen, sonst kann der Bot
    // sie nicht vergeben.
    if (input.jailRoleId) {
      const [roles, botPosition] = await Promise.all([
        discord.roles.list({ force: true }),
        discord.bot.highestRolePosition(),
      ]);
      const role = roles.find((entry) => entry.id === input.jailRoleId);
      if (role && role.position >= botPosition) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage:
            'Die Jail-Rolle liegt über der Rolle des Bots. Bitte die Bot-Rolle auf Discord höher einordnen.',
        });
      }
    }

    await setModuleSettings(jail.JAIL_MODULE_ID, input, ctx.user.discordId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.MODULE_SETTINGS_CHANGED,
      module: jail.JAIL_MODULE_ID,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      success: true,
      metadata: { jailRoleId: input.jailRoleId ?? null, maxDurationSeconds: input.maxDurationSeconds },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/settings');
    revalidatePath('/jail');
    return { saved: true };
  },
);

const managedRoleSchema = z.object({
  discordRoleId: snowflakeSchema,
  label: z
    .string()
    .min(1)
    .max(64)
    .transform((value) => sanitizeText(value, 64)),
  isProtected: z.boolean().default(false),
  keepOnJail: z.boolean().default(false),
  moderationLevel: z.number().int().min(0).max(1000).default(0),
  permissions: z.array(z.string().max(64)).max(64).default([]),
});

export const upsertManagedRoleAction = defineAction(
  {
    name: 'settings.role.upsert',
    module: 'settings',
    permission: 'permissions.manage',
    schema: managedRoleSchema,
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertRoleExists(input.discordRoleId, 'Rolle');

    const unknown = input.permissions.filter((permission) => !isKnownPermission(permission));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Unbekannte Berechtigung: ${unknown.join(', ')}`,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.managedRole.upsert({
        where: { discordRoleId: input.discordRoleId },
        create: {
          discordRoleId: input.discordRoleId,
          label: input.label,
          isProtected: input.isProtected,
          keepOnJail: input.keepOnJail,
          moderationLevel: input.moderationLevel,
        },
        update: {
          label: input.label,
          isProtected: input.isProtected,
          keepOnJail: input.keepOnJail,
          moderationLevel: input.moderationLevel,
        },
      });

      await tx.rolePermission.deleteMany({
        where: { discordRoleId: input.discordRoleId, permission: { notIn: input.permissions } },
      });

      for (const permission of input.permissions) {
        await tx.rolePermission.upsert({
          where: { discordRoleId_permission: { discordRoleId: input.discordRoleId, permission } },
          create: { discordRoleId: input.discordRoleId, permission, createdBy: ctx.user.discordId },
          update: {},
        });
      }
    });

    invalidateRoleConfiguration();

    await safeRecordAudit({
      action: AUDIT_ACTIONS.ROLE_MAPPING_CHANGED,
      module: 'settings',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: input.label,
      success: true,
      metadata: {
        discordRoleId: input.discordRoleId,
        permissions: input.permissions,
        isProtected: input.isProtected,
        moderationLevel: input.moderationLevel,
      },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/settings');
    return { saved: true, permissions: listPermissions().length };
  },
);

export const deleteManagedRoleAction = defineAction(
  {
    name: 'settings.role.delete',
    module: 'settings',
    permission: 'permissions.manage',
    schema: z.object({ discordRoleId: snowflakeSchema }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await prisma.managedRole.delete({ where: { discordRoleId: input.discordRoleId } }).catch(() => undefined);
    invalidateRoleConfiguration();

    await safeRecordAudit({
      action: AUDIT_ACTIONS.ROLE_MAPPING_CHANGED,
      module: 'settings',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      success: true,
      metadata: { discordRoleId: input.discordRoleId, removed: true },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/settings');
    return { removed: true };
  },
);

export const setModuleEnabledAction = defineAction(
  {
    name: 'settings.module.toggle',
    module: 'modules',
    permission: 'modules.manage',
    schema: z.object({ moduleId: z.string().min(1).max(64), enabled: z.boolean() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const definition = getModuleDefinition(input.moduleId);
    if (!definition) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Modul existiert nicht.' });
    }
    if (definition.core) {
      throw new AppError('FORBIDDEN', { userMessage: 'Kernbereiche können nicht deaktiviert werden.' });
    }

    await setModuleEnabled(input.moduleId, input.enabled, ctx.user.discordId);
    await safeRecordAudit({
      action: input.enabled ? AUDIT_ACTIONS.MODULE_ENABLED : AUDIT_ACTIONS.MODULE_DISABLED,
      module: input.moduleId,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/modules');
    revalidatePath('/dashboard');
    return { enabled: input.enabled };
  },
);

export const runJailReconciliationAction = defineAction(
  {
    name: 'settings.reconciliation.run',
    module: jail.JAIL_MODULE_ID,
    permission: 'system.manage',
    schema: z.object({ scanOrphans: z.boolean().default(false) }),
    rateLimit: 'reconciliation',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const summary = await jail.reconcileJails({
      mode: 'MANUAL',
      triggeredBy: ctx.user.discordId,
      repair: true,
      scanOrphans: input.scanOrphans,
    });

    revalidatePath('/settings');
    revalidatePath('/jail');
    return {
      checked: summary.checked,
      drift: summary.drift.length,
      repaired: summary.repaired,
      failed: summary.failed,
    };
  },
);
