'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { clearGuildIdCache } from '@swisshub/discord';
import { bootstrapConfig } from '@swisshub/config';
import {
  checkLockout,
  getPermissionPreset,
  invalidateRoleConfiguration,
  isKnownPermission,
  isRecoveryNeeded,
  resolvePreset,
} from '@swisshub/permissions';
import {
  completeSetup,
  connectGuild,
  getGuildConfig,
  isDiscordAdministrator,
  syncDiscord,
  writeModuleSettings,
} from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText, snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';

const log = createLogger('web:configuration');

/**
 * Konfigurationsaktionen des Dashboards.
 *
 * Alles, was hier geschrieben wird, läuft durch dieselbe Sicherheitskette wie
 * jede andere Server Action: Anmeldung, Mitgliedschaft, CSRF, Rate Limit,
 * Validierung, Berechtigung. Der Browser schreibt nie direkt in die Datenbank.
 */

/** Discord-Abgleich anstossen (Rollen, Channels, Servermetadaten). */
export const syncDiscordAction = defineAction(
  {
    name: 'configuration.discord.sync',
    module: 'settings',
    schema: z.object({}),
    rateLimit: 'discordSync',
    freshness: 'critical',
  },
  async ({ ctx }) => {
    await assertConfigurationAccess(ctx, 'settings.edit');

    const summary = await syncDiscord({ trigger: 'manual', triggeredBy: ctx.user.discordId });
    if (!summary.success) {
      throw new AppError('DISCORD_UNAVAILABLE', {
        userMessage: 'Der Abgleich mit Discord ist fehlgeschlagen. Bitte später erneut versuchen.',
        internalMessage: summary.error,
      });
    }

    revalidatePath('/server');
    revalidatePath('/server/roles');
    revalidatePath('/server/channels');
    revalidatePath('/system/discord');
    return {
      roles: summary.roles,
      channels: summary.channels,
      removedRoles: summary.removedRoles,
      removedChannels: summary.removedChannels,
    };
  },
);

/**
 * Verbindet einen Discord-Server.
 *
 * Solange die Einrichtung nicht abgeschlossen ist, genügt ein Discord-Admin;
 * danach ist `settings.edit` erforderlich. So kommt der erste Administrator
 * überhaupt hinein, ohne dass die Prüfung dauerhaft aufgeweicht wird.
 */
export const connectGuildAction = defineAction(
  {
    name: 'configuration.guild.connect',
    module: 'settings',
    schema: z.object({ guildId: snowflakeSchema }),
    rateLimit: 'setupWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertSetupAccess(ctx.user.discordId, ctx.permissionKeys, ctx.user.isOwner);

    const guild = await connectGuild({ guildId: input.guildId, updatedBy: ctx.user.discordId });
    clearGuildIdCache();
    await syncDiscord({ trigger: 'manual', triggeredBy: ctx.user.discordId }).catch(() => undefined);

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SETTING_CHANGED,
      module: 'settings',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      success: true,
      metadata: { scope: 'guild', guildId: guild.guildId, name: guild.name },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/setup');
    revalidatePath('/server');
    return { guildId: guild.guildId, name: guild.name };
  },
);

/** Schliesst den Einrichtungsassistenten ab. */
export const completeSetupAction = defineAction(
  {
    name: 'configuration.setup.complete',
    module: 'settings',
    schema: z.object({}),
    rateLimit: 'setupWrite',
    freshness: 'critical',
  },
  async ({ ctx, metadata }) => {
    await assertSetupAccess(ctx.user.discordId, ctx.permissionKeys, ctx.user.isOwner);

    // Mit dem Abschluss endet der Erstzugang für Discord-Administratoren. Wer
    // vorher keiner Rolle Berechtigungen gegeben hat, käme danach nicht mehr
    // hinein - deshalb hier blockieren statt aussperren.
    if ((await isRecoveryNeeded()) && !bootstrapConfig.ownerDiscordId) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage:
          'Es darf noch keine Discord-Rolle das Dashboard verwalten. Bitte zuerst unter "Berechtigungen" eine Rolle mit Vollzugriff festlegen - sonst sperrst du dich mit dem Abschluss aus.',
      });
    }

    await completeSetup(ctx.user.discordId);

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SETTING_CHANGED,
      module: 'settings',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      success: true,
      metadata: { scope: 'setup', completed: true },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/setup');
    revalidatePath('/dashboard');
    return { completed: true };
  },
);

/**
 * Generische Moduleinstellungen.
 *
 * Die Werte kommen als JSON aus der automatisch erzeugten Oberfläche und werden
 * serverseitig gegen das Zod-Schema des Moduls und den echten Discord-Zustand
 * geprüft - das Frontend kann also keine ungültige Konfiguration erzwingen.
 */
export const updateModuleSettingsAction = defineAction(
  {
    name: 'configuration.module.settings',
    module: 'modules',
    schema: z.object({
      moduleId: z.string().min(1).max(64),
      values: z.record(z.unknown()),
    }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { getModuleDefinition } = await import('@swisshub/modules');
    const definition = getModuleDefinition(input.moduleId);
    if (!definition) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Modul existiert nicht.' });
    }

    // Modulspezifische Einstellungsberechtigung, sonst `modules.manage`.
    const permission = definition.permissions.some(
      (entry) => entry.key === `${definition.permissionPrefix}.settings`,
    )
      ? `${definition.permissionPrefix}.settings`
      : 'modules.manage';
    await assertConfigurationAccess(ctx, permission, definition.id);

    const result = await writeModuleSettings(input.moduleId, input.values, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    revalidatePath(`/modules/${input.moduleId}`);
    revalidatePath('/modules');
    revalidatePath('/dashboard');
    return { saved: true, warnings: result.warnings };
  },
);

const roleLabelSchema = z
  .string()
  .min(1)
  .max(64)
  .transform((value) => sanitizeText(value, 64));

const rolePermissionsSchema = z.object({
  discordRoleId: snowflakeSchema,
  label: roleLabelSchema,
  permissions: z.array(z.string().max(64)).max(128).default([]),
  isProtected: z.boolean().default(false),
  keepOnJail: z.boolean().default(false),
  moderationLevel: z.number().int().min(0).max(1000).default(0),
});

/**
 * Berechtigungen einer Rolle setzen.
 *
 * Enthält den Aussperrschutz: die letzte Rolle, die Berechtigungen verwalten
 * darf, lässt sich nicht entwerten.
 */
export const setRolePermissionsAction = defineAction(
  {
    name: 'configuration.permissions.set',
    module: 'settings',
    schema: rolePermissionsSchema,
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertConfigurationAccess(ctx, 'permissions.manage');

    const unknown = input.permissions.filter((permission) => !isKnownPermission(permission));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Unbekannte Berechtigung: ${unknown.join(', ')}`,
      });
    }

    await assertRoleIsSynced(input.discordRoleId);

    const lockout = await checkLockout(input.discordRoleId, input.permissions);
    if (lockout.wouldLockOut) {
      throw new AppError('FORBIDDEN', { userMessage: lockout.reason });
    }

    const before = await prisma.rolePermission.findMany({
      where: { discordRoleId: input.discordRoleId },
      select: { permission: true },
    });

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
        before: before.map((entry) => entry.permission).sort(),
        after: [...input.permissions].sort(),
        isProtected: input.isProtected,
        moderationLevel: input.moderationLevel,
      },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/server/permissions');
    revalidatePath('/settings');
    return { saved: true, remainingManagerRoles: lockout.remainingManagerRoles };
  },
);

const applyPresetSchema = z.object({
  discordRoleId: snowflakeSchema,
  label: roleLabelSchema,
  presetId: z.string().min(1).max(64),
});

/** Wendet eine Vorlage auf eine Rolle an (Vorlage wird zu Permissions aufgelöst). */
export const applyPermissionPresetAction = defineAction(
  {
    name: 'configuration.permissions.preset',
    module: 'settings',
    schema: applyPresetSchema,
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertConfigurationAccess(ctx, 'permissions.manage');

    const preset = getPermissionPreset(input.presetId);
    if (!preset) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Vorlage existiert nicht.' });
    }

    await assertRoleIsSynced(input.discordRoleId);
    const permissions = resolvePreset(preset);

    const lockout = await checkLockout(input.discordRoleId, permissions);
    if (lockout.wouldLockOut) {
      throw new AppError('FORBIDDEN', { userMessage: lockout.reason });
    }

    await prisma.$transaction(async (tx) => {
      await tx.managedRole.upsert({
        where: { discordRoleId: input.discordRoleId },
        create: {
          discordRoleId: input.discordRoleId,
          label: input.label,
          moderationLevel: preset.moderationLevel,
          notes: `Vorlage "${preset.label}" angewendet.`,
        },
        update: { label: input.label, moderationLevel: preset.moderationLevel },
      });
      await tx.rolePermission.deleteMany({
        where: { discordRoleId: input.discordRoleId, permission: { notIn: permissions } },
      });
      for (const permission of permissions) {
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
      metadata: { discordRoleId: input.discordRoleId, preset: preset.id, permissions },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/server/permissions');
    return { saved: true, permissions };
  },
);

/** Entfernt eine Rolle aus der Dashboard-Verwaltung. */
export const removeManagedRoleAction = defineAction(
  {
    name: 'configuration.permissions.remove',
    module: 'settings',
    permission: 'permissions.manage',
    schema: z.object({ discordRoleId: snowflakeSchema }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const lockout = await checkLockout(input.discordRoleId, null);
    if (lockout.wouldLockOut) {
      throw new AppError('FORBIDDEN', { userMessage: lockout.reason });
    }

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

    revalidatePath('/server/permissions');
    return { removed: true };
  },
);

/**
 * Berechtigungsprüfung für Konfigurationsaktionen.
 *
 * Normalfall: die genannte Dashboard-Berechtigung entscheidet. Solange die
 * Einrichtung nicht abgeschlossen ist, darf zusätzlich ein Discord-Administrator
 * konfigurieren - sonst könnte niemand die allerersten Berechtigungen vergeben
 * (Henne-Ei-Problem). Die Ausnahme endet mit dem Abschluss der Einrichtung.
 */
async function assertConfigurationAccess(
  ctx: { user: { discordId: string; username: string; isOwner: boolean }; permissionKeys: string[] },
  permission: string,
  module?: string,
): Promise<void> {
  if (ctx.user.isOwner || ctx.permissionKeys.includes(permission)) {
    return;
  }

  const guild = await getGuildConfig();
  if (guild.setupCompletedAt === null && (await isDiscordAdministrator(ctx.user.discordId))) {
    log.warn('Konfigurationszugriff über den Erstzugang', {
      discordId: ctx.user.discordId,
      permission,
      module: module ?? null,
    });
    return;
  }

  const { assertPermission } = await import('@swisshub/auth');
  await assertPermission(ctx as never, permission, { module: module ?? null, path: 'configuration' });
}

/**
 * Erstzugang: vor Abschluss der Einrichtung genügt ein Discord-Administrator,
 * danach zählt ausschliesslich die Dashboard-Berechtigung.
 */
async function assertSetupAccess(
  discordId: string,
  permissionKeys: readonly string[],
  isOwner: boolean,
): Promise<void> {
  if (isOwner || permissionKeys.includes('settings.edit') || permissionKeys.includes('admin.full')) {
    return;
  }

  const guild = await getGuildConfig();
  if (guild.setupCompletedAt !== null) {
    throw new AppError('FORBIDDEN', {
      userMessage:
        'Die Einrichtung ist abgeschlossen. Änderungen erfordern die Berechtigung "settings.edit".',
    });
  }

  if (!(await isDiscordAdministrator(discordId))) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Nur ein Discord-Administrator kann die Einrichtung durchführen.',
    });
  }
}

/** Nur synchronisierte, echte Rollen dürfen konfiguriert werden. */
async function assertRoleIsSynced(roleId: string): Promise<void> {
  const role = await prisma.discordRoleCache.findUnique({ where: { roleId } });
  if (!role || role.deletedAt !== null) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Diese Rolle ist nicht bekannt. Bitte zuerst unter System -> Discord-Sync synchronisieren.',
    });
  }
}
