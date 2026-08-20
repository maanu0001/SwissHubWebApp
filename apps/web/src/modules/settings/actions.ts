'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import {
  coreSettingsSchema,
  findCachedChannel,
  getModuleDefinition,
  jail,
  setCoreSettings,
  setModuleEnabled,
} from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Einstellungen ändern.
 *
 * Jede Änderung wird validiert, autorisiert, gespeichert und im Audit Log
 * protokolliert. Discord-IDs werden zusätzlich gegen die Guild geprüft -
 * eine erfundene Channel-ID lässt sich so nicht speichern.
 *
 * Moduleinstellungen und Rollenberechtigungen liegen in
 * `@/modules/configuration/actions` - sie entstehen generisch aus der
 * Modulbeschreibung.
 */
/**
 * Prüft gegen den synchronisierten Discord-Zustand - dieselbe Grundlage, aus
 * der die Auswahlliste im Dashboard entsteht. Dadurch bleibt das Speichern auch
 * dann möglich, wenn Discord gerade nicht erreichbar ist.
 */
async function assertChannelExists(channelId: string | undefined, label: string): Promise<void> {
  if (!channelId) {
    return;
  }
  const channel = await findCachedChannel(channelId);
  if (!channel || channel.deleted) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `${label}: Dieser Channel existiert auf dem Discord-Server nicht (mehr).`,
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
