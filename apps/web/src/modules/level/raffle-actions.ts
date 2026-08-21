'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { level } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = level.LEVEL_MODULE_ID;
const PERMISSIONS = level.LEVEL_PERMISSIONS;
const R = level.raffle;

/**
 * Server Actions der XP-Verlosungen.
 *
 * Alle rufen dieselben Funktionen auf wie der Knopf auf Discord. Die
 * Berechtigung wird hier serverseitig geprüft - dass ein Knopf im Browser
 * fehlt, ist reine Bequemlichkeit und keine Absicherung.
 */

function revalidateRaffle(raffleId?: string): void {
  revalidatePath('/level');
  revalidatePath('/level/gluecksrad');
  revalidatePath('/level/statistiken');
  revalidatePath('/xp-gluecksrad');
  if (raffleId) {
    revalidatePath(`/level/gluecksrad/${raffleId}`);
  }
}

const raffleIdSchema = z.object({ raffleId: z.string().min(1) });

export const createRaffleAction = defineAction(
  {
    name: 'level.raffle.create',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleCreate,
    schema: R.raffleSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const raffle = await R.createRaffle(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input,
    );
    revalidateRaffle(raffle.id);
    return { raffleId: raffle.id };
  },
);

export const updateRaffleAction = defineAction(
  {
    name: 'level.raffle.update',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleEdit,
    schema: z.object({ raffleId: z.string().min(1) }).and(R.raffleSchema),
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const { raffleId, ...rest } = input;
    const raffle = await R.updateRaffle(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      raffleId,
      rest as level.raffle.RaffleInput,
    );
    revalidateRaffle(raffle.id);
    return { raffleId: raffle.id };
  },
);

export const publishRaffleAction = defineAction(
  {
    name: 'level.raffle.publish',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleCreate,
    schema: raffleIdSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const actor = { discordId: ctx.user.discordId, username: ctx.user.username };
    const raffle = await R.publishRaffle(actor, input.raffleId);
    // Die Ankündigung ist Beiwerk: scheitert sie, bleibt die Verlosung gültig.
    const announced = await R.announceRaffle(raffle.id).catch(() => null);
    revalidateRaffle(raffle.id);
    return { status: raffle.status, announced: announced !== null };
  },
);

export const openEntriesAction = defineAction(
  {
    name: 'level.raffle.open',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleOpen,
    schema: raffleIdSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const raffle = await R.openEntries(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.raffleId,
    );
    await R.refreshAnnouncement(raffle.id).catch(() => undefined);
    revalidateRaffle(raffle.id);
    return { status: raffle.status };
  },
);

export const closeEntriesAction = defineAction(
  {
    name: 'level.raffle.close',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleClose,
    schema: raffleIdSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const raffle = await R.closeEntries(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.raffleId,
    );
    await R.refreshAnnouncement(raffle.id).catch(() => undefined);
    revalidateRaffle(raffle.id);
    return { status: raffle.status };
  },
);

export const startDrawAction = defineAction(
  {
    name: 'level.raffle.draw',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleDraw,
    schema: raffleIdSchema,
    rateLimit: 'raffleDraw',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const { draw } = await R.startDraw(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.raffleId,
    );
    revalidateRaffle(input.raffleId);
    return { drawId: draw.id, version: draw.version, winnerDiscordId: draw.winnerDiscordId };
  },
);

export const redrawAction = defineAction(
  {
    name: 'level.raffle.redraw',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleRedraw,
    schema: R.redrawSchema,
    rateLimit: 'raffleDraw',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const { draw } = await R.redraw(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.raffleId,
      { reason: input.reason, excludePreviousWinner: input.excludePreviousWinner },
    );
    revalidateRaffle(input.raffleId);
    return { drawId: draw.id, version: draw.version, winnerDiscordId: draw.winnerDiscordId };
  },
);

export const confirmWinnerAction = defineAction(
  {
    name: 'level.raffle.confirm',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleDraw,
    schema: raffleIdSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const actor = { discordId: ctx.user.discordId, username: ctx.user.username };
    const result = await R.confirmWinner(actor, input.raffleId);
    const announced = result.raffle.autoAnnounceWinner
      ? await R.announceWinner(input.raffleId).catch(() => null)
      : null;
    revalidateRaffle(input.raffleId);
    return {
      winnerDiscordId: result.draw.winnerDiscordId,
      prizeXpAwarded: result.prizeXpAwarded,
      announced: announced !== null,
    };
  },
);

export const cancelRaffleAction = defineAction(
  {
    name: 'level.raffle.cancel',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleCancel,
    schema: R.cancelRaffleSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await R.cancelRaffle(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.raffleId,
      input.reason,
    );
    await R.refreshAnnouncement(input.raffleId).catch(() => undefined);
    revalidateRaffle(input.raffleId);
    return { refundedEntries: result.refundedEntries, refundedXp: result.refundedXp };
  },
);

export const removeEntryAction = defineAction(
  {
    name: 'level.raffle.entry.remove',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleManage,
    schema: R.removeEntrySchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await R.removeEntry(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.entryId,
      input.reason,
    );
    revalidateRaffle();
    return { refunded: result.refunded };
  },
);

export const republishAnnouncementAction = defineAction(
  {
    name: 'level.raffle.announce',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleManage,
    schema: raffleIdSchema,
    rateLimit: 'raffleManage',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const message = await R.announceRaffle(input.raffleId, {
      actor: { discordId: ctx.user.discordId, username: ctx.user.username },
      republish: true,
    });
    revalidateRaffle(input.raffleId);
    return { messageId: message?.id ?? null };
  },
);

/**
 * Teilnahme über die Webseite.
 *
 * Ruft exakt dieselbe Funktion auf wie der Knopf auf Discord - Preis, Gewicht
 * und Gewinnchance entstehen an einer einzigen Stelle.
 */
export const enterRaffleAction = defineAction(
  {
    name: 'level.raffle.enter',
    module: MODULE_ID,
    permission: PERMISSIONS.raffleParticipate,
    schema: raffleIdSchema,
    rateLimit: 'raffleEnter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await R.enterRaffle(
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        displayName: ctx.user.displayName ?? null,
      },
      input.raffleId,
    );

    await R.scheduleAnnouncementRefresh(input.raffleId);
    revalidateRaffle(input.raffleId);

    return {
      alreadyEntered: result.alreadyEntered,
      entryXp: result.entry.entryXp,
      xpAfter: result.xpAfter,
      chance: result.chance,
      entryCount: result.entryCount,
      potXp: result.potXp,
    };
  },
);
