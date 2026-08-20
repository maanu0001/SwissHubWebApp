'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { communication } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = communication.COMMUNICATION_MODULE_ID;

/**
 * Server Actions des Kommunikationsmoduls.
 *
 * Der Discord-Payload entsteht ausschliesslich serverseitig aus den validierten
 * Eingaben - die Live-Vorschau im Browser ist reine Darstellung und hat auf das
 * Ergebnis keinen Einfluss.
 */
function actorFrom(ctx: {
  user: { discordId: string; username: string; avatarHash: string | null; isOwner: boolean };
  permissionKeys: string[];
}): communication.CommunicationActor {
  return {
    discordId: ctx.user.discordId,
    username: ctx.user.username,
    avatarHash: ctx.user.avatarHash,
    permissionKeys: ctx.permissionKeys,
    isOwner: ctx.user.isOwner,
  };
}

export const sendNewsAction = defineAction(
  {
    name: 'communication.news.send',
    module: MODULE_ID,
    permission: communication.COMMUNICATION_PERMISSIONS.news,
    schema: communication.sendNewsSchema,
    rateLimit: 'communicationSend',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await communication.sendNews(input, actorFrom(ctx), { metadata });

    revalidatePath('/communication');
    revalidatePath('/communication/history');
    return {
      id: result.message.id,
      warnings: result.warnings,
      duplicate: result.duplicate,
      discordUrl: result.discordUrl,
    };
  },
);

export const sendEventAction = defineAction(
  {
    name: 'communication.event.send',
    module: MODULE_ID,
    permission: communication.COMMUNICATION_PERMISSIONS.event,
    schema: communication.sendEventSchema,
    rateLimit: 'communicationSend',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await communication.sendEvent(input, actorFrom(ctx), { metadata });

    revalidatePath('/communication');
    revalidatePath('/communication/history');
    return {
      id: result.message.id,
      warnings: result.warnings,
      duplicate: result.duplicate,
      discordUrl: result.discordUrl,
    };
  },
);

export const sendPollAction = defineAction(
  {
    name: 'communication.poll.send',
    module: MODULE_ID,
    permission: communication.COMMUNICATION_PERMISSIONS.poll,
    schema: communication.sendPollSchema,
    rateLimit: 'communicationSend',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await communication.sendPoll(input, actorFrom(ctx), { metadata });

    revalidatePath('/communication');
    revalidatePath('/communication/history');
    return {
      id: result.message.id,
      warnings: result.warnings,
      duplicate: result.duplicate,
      discordUrl: result.discordUrl,
    };
  },
);

/** Löscht eine bereits gesendete Nachricht auf Discord. */
export const deleteCommunicationMessageAction = defineAction(
  {
    name: 'communication.message.delete',
    module: MODULE_ID,
    permission: communication.COMMUNICATION_PERMISSIONS.manage,
    schema: z.object({ id: z.string().cuid('Ungültige ID') }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const record = await communication.deleteCommunicationMessage(input.id, actorFrom(ctx), { metadata });
    if (!record.deletedAt) {
      throw new AppError('INTERNAL', { userMessage: 'Die Nachricht konnte nicht gelöscht werden.' });
    }

    revalidatePath('/communication/history');
    return { deleted: true };
  },
);
