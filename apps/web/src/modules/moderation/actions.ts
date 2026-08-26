'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { moderation } from '@swisshub/modules';
import { snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { moderationActor } from '@/server/moderation';

/**
 * Die Aktionen des Moderation Center.
 *
 * Jede ist ein duenner Adapter auf den Dienst, der Berechtigung und Rangfolge
 * selbst prueft. Hier steht kein zweites Regelwerk - und `freshness: 'critical'`
 * ueberall, weil eine Massnahme mit Rollen von vorhin die falsche Rangfolge
 * verwenden koennte.
 */

const grundSchema = z.string().min(3).max(400);

const zielSchema = z.object({
  discordId: snowflakeSchema,
  reason: grundSchema,
  note: z.string().max(1000).nullish(),
});

export const banMemberAction = defineAction(
  {
    name: 'moderation.ban',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.ban,
    schema: zielSchema.extend({
      // Discord erlaubt hoechstens sieben Tage.
      deleteMessageSeconds: z.number().int().min(0).max(604_800).optional(),
    }),
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.banMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
      deleteMessageSeconds: input.deleteMessageSeconds,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const unbanMemberAction = defineAction(
  {
    name: 'moderation.unban',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.unban,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.unbanMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });
    revalidatePath('/moderation/banns');
    return { id: eintrag.id };
  },
);

export const kickMemberAction = defineAction(
  {
    name: 'moderation.kick',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.kick,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.kickMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const timeoutMemberAction = defineAction(
  {
    name: 'moderation.timeout',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.timeout,
    schema: zielSchema.extend({
      seconds: z.number().int().min(60).max(moderation.MAX_TIMEOUT_SECONDS),
    }),
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.timeoutMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
      seconds: input.seconds,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const removeTimeoutAction = defineAction(
  {
    name: 'moderation.timeout.remove',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.timeoutRemove,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.removeTimeout({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const addModerationNoteAction = defineAction(
  {
    name: 'moderation.note',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.notesCreate,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.addModerationNote({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);
