'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { voiceHub } from '@swisshub/modules';
import { defineAction } from '@/server/action';

/**
 * Verwaltung von Hub-Channels und Presets.
 *
 * Anders als die Talk-Aktionen tragen diese eine feste Berechtigung: hier
 * geht es nicht um den eigenen Talk, sondern um die Einrichtung des Moduls
 * fuer alle.
 */

const presetSchema = z.object({
  name: z.string().min(1).max(60),
  nameTemplate: z.string().min(1).max(100),
  userLimit: z.number().int().min(0).max(99),
  maxUserLimit: z.number().int().min(1).max(99),
  bitrate: z.number().int().min(8000).max(384000).nullable(),
  lockedDefault: z.boolean(),
  hiddenDefault: z.boolean(),
  targetCategoryId: z.string().nullable(),
  allowedRoleIds: z.array(z.string()).max(20),
  blockedRoleIds: z.array(z.string()).max(20),
  deleteGraceSeconds: z.number().int().min(0).max(3600),
  renameCooldownSeconds: z.number().int().min(0).max(3600),
  ownerModeration: z.boolean(),
});

const hubSchema = z.object({
  name: z.string().min(1).max(60),
  discordChannelId: z.string().regex(/^\d{17,20}$/u),
  targetCategoryId: z.string().regex(/^\d{17,20}$/u),
  overflowCategoryId: z
    .string()
    .regex(/^\d{17,20}$/u)
    .nullable(),
  presetId: z.string().cuid(),
  allowedRoleIds: z.array(z.string()).max(20),
  blockedRoleIds: z.array(z.string()).max(20),
  enabled: z.boolean(),
});

export const createPresetAction = defineAction(
  {
    name: 'voice.presets.create',
    module: 'voiceHub',
    permission: voiceHub.VOICE_HUB_PERMISSIONS.presetsManage,
    schema: presetSchema,
    rateLimit: 'voiceAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const preset = await voiceHub.createPreset(input);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VOICE_PRESET_CHANGED,
      module: 'voiceHub',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: preset.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { angelegt: true },
    });
    revalidatePath('/voice/presets');
    return { id: preset.id };
  },
);

export const updatePresetAction = defineAction(
  {
    name: 'voice.presets.update',
    module: 'voiceHub',
    permission: voiceHub.VOICE_HUB_PERMISSIONS.presetsManage,
    schema: presetSchema.extend({ presetId: z.string().cuid() }),
    rateLimit: 'voiceAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { presetId, ...rest } = input;
    const preset = await voiceHub.updatePreset(presetId, rest);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VOICE_PRESET_CHANGED,
      module: 'voiceHub',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: preset.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/voice/presets');
    return { ok: true };
  },
);

export const deletePresetAction = defineAction(
  {
    name: 'voice.presets.delete',
    module: 'voiceHub',
    permission: voiceHub.VOICE_HUB_PERMISSIONS.presetsManage,
    schema: z.object({ presetId: z.string().cuid() }),
    rateLimit: 'voiceAdmin',
    freshness: 'critical',
  },
  async ({ input }) => {
    await voiceHub.deletePreset(input.presetId);
    revalidatePath('/voice/presets');
    return { ok: true };
  },
);

export const createHubAction = defineAction(
  {
    name: 'voice.hubs.create',
    module: 'voiceHub',
    permission: voiceHub.VOICE_HUB_PERMISSIONS.hubsManage,
    schema: hubSchema,
    rateLimit: 'voiceAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const hub = await voiceHub.createHub(input);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VOICE_HUB_CHANGED,
      module: 'voiceHub',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: hub.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { angelegt: true },
    });
    revalidatePath('/voice/hubs');
    return { id: hub.id };
  },
);

export const updateHubAction = defineAction(
  {
    name: 'voice.hubs.update',
    module: 'voiceHub',
    permission: voiceHub.VOICE_HUB_PERMISSIONS.hubsManage,
    schema: hubSchema.extend({ hubId: z.string().cuid() }),
    rateLimit: 'voiceAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { hubId, ...rest } = input;
    const hub = await voiceHub.updateHub(hubId, rest);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VOICE_HUB_CHANGED,
      module: 'voiceHub',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: hub.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/voice/hubs');
    return { ok: true };
  },
);

export const deleteHubAction = defineAction(
  {
    name: 'voice.hubs.delete',
    module: 'voiceHub',
    permission: voiceHub.VOICE_HUB_PERMISSIONS.hubsManage,
    schema: z.object({ hubId: z.string().cuid() }),
    rateLimit: 'voiceAdmin',
    freshness: 'critical',
  },
  async ({ input }) => {
    await voiceHub.deleteHub(input.hubId);
    revalidatePath('/voice/hubs');
    return { ok: true };
  },
);
