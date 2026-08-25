'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { voiceHub } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { voiceKontext } from '@/server/voice';

/**
 * Die Voice-Aktionen des Dashboards.
 *
 * Jede ist ein duenner Adapter auf denselben Dienst, den auch der Knopf im
 * Discord-Bedienfeld aufruft. Die Zugriffspruefung liegt dort - hier steht
 * kein zweites Regelwerk, das mit dem ersten auseinanderlaufen koennte.
 *
 * `selfService` heisst hier: die Aktion wirkt auf einen Talk, und ob sie
 * erlaubt ist, entscheidet der Dienst aus Besitz und Rechten. Eine feste
 * Berechtigung an dieser Stelle waere falsch - sie unterschiede nicht
 * zwischen dem eigenen Talk und einem fremden.
 */

const kanalSchema = z.object({ kanalId: z.string().cuid() });
const mitgliedSchema = kanalSchema.extend({
  discordId: z.string().regex(/^\d{17,20}$/u),
  username: z.string().max(100).nullable().optional(),
});

export const renameTalkAction = defineAction(
  {
    name: 'voice.rename',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ name: z.string().min(1).max(100) }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const kanal = await voiceHub.renameTalk(voiceKontext(ctx), input.kanalId, input.name);
    revalidatePath('/voice');
    return { name: kanal.name };
  },
);

export const setLimitAction = defineAction(
  {
    name: 'voice.limit',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ limit: z.number().int().min(0).max(99) }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const kanal = await voiceHub.setTalkLimit(voiceKontext(ctx), input.kanalId, input.limit);
    revalidatePath('/voice');
    return { limit: kanal.userLimit };
  },
);

export const setLockedAction = defineAction(
  {
    name: 'voice.lock',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ locked: z.boolean() }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const kanal = await voiceHub.setTalkLocked(voiceKontext(ctx), input.kanalId, input.locked);
    revalidatePath('/voice');
    return { locked: kanal.locked };
  },
);

export const setHiddenAction = defineAction(
  {
    name: 'voice.hide',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ hidden: z.boolean() }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const kanal = await voiceHub.setTalkHidden(voiceKontext(ctx), input.kanalId, input.hidden);
    revalidatePath('/voice');
    return { hidden: kanal.hidden };
  },
);

export const setGameAction = defineAction(
  {
    name: 'voice.game',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ spiel: z.string().max(60).nullable() }),
    rateLimit: 'voiceOwn',
  },
  async ({ ctx, input }) => {
    await voiceHub.setTalkGame(voiceKontext(ctx), input.kanalId, input.spiel);
    revalidatePath('/voice');
    return { ok: true };
  },
);

export const allowMemberAction = defineAction(
  {
    name: 'voice.allow',
    module: 'voiceHub',
    selfService: true,
    schema: mitgliedSchema,
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await voiceHub.allowInTalk(voiceKontext(ctx), input.kanalId, {
      discordId: input.discordId,
      username: input.username ?? null,
    });
    revalidatePath('/voice');
    return { ok: true };
  },
);

export const denyMemberAction = defineAction(
  {
    name: 'voice.deny',
    module: 'voiceHub',
    selfService: true,
    schema: mitgliedSchema.extend({ auchEntfernen: z.boolean().default(false) }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await voiceHub.denyInTalk(
      voiceKontext(ctx),
      input.kanalId,
      { discordId: input.discordId, username: input.username ?? null },
      { auchEntfernen: input.auchEntfernen },
    );
    revalidatePath('/voice');
    return ergebnis;
  },
);

export const clearAccessAction = defineAction(
  {
    name: 'voice.access.clear',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await voiceHub.clearTalkAccess(voiceKontext(ctx), input.kanalId, input.discordId);
    revalidatePath('/voice');
    return { ok: true };
  },
);

export const kickMemberAction = defineAction(
  {
    name: 'voice.kick',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema.extend({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const entfernt = await voiceHub.kickFromTalk(voiceKontext(ctx), input.kanalId, input.discordId);
    revalidatePath('/voice');
    return { entfernt };
  },
);

export const transferTalkAction = defineAction(
  {
    name: 'voice.transfer',
    module: 'voiceHub',
    selfService: true,
    schema: mitgliedSchema.extend({ username: z.string().min(1).max(100) }),
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const kanal = await voiceHub.transferTalk(voiceKontext(ctx), input.kanalId, {
      discordId: input.discordId,
      username: input.username,
    });

    // Nur, wenn jemand einen fremden Talk umhaengt - der eigene geht das
    // Protokoll nichts an.
    if (kanal.ownerDiscordId !== ctx.user.discordId) {
      await safeRecordAudit({
        action: AUDIT_ACTIONS.VOICE_OWNER_CHANGED,
        module: 'voiceHub',
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetDiscordId: input.discordId,
        targetLabel: kanal.name,
        success: true,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });
    }

    revalidatePath('/voice');
    return { ok: true };
  },
);

export const deleteTalkAction = defineAction(
  {
    name: 'voice.delete',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema,
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { prisma } = await import('@swisshub/database');
    const vorher = await prisma.temporaryVoiceChannel.findUnique({
      where: { id: input.kanalId },
      select: { name: true, ownerDiscordId: true },
    });

    await voiceHub.deleteTalk(voiceKontext(ctx), input.kanalId);

    // Einen fremden Talk zu schliessen ist ein Eingriff und gehoert ins
    // Protokoll. Den eigenen zu schliessen ist Alltag.
    if (vorher && vorher.ownerDiscordId !== ctx.user.discordId) {
      await safeRecordAudit({
        action: AUDIT_ACTIONS.VOICE_TALK_DELETED,
        module: 'voiceHub',
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetDiscordId: vorher.ownerDiscordId,
        targetLabel: vorher.name,
        success: true,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });
    }

    revalidatePath('/voice');
    return { ok: true };
  },
);

export const repairPanelAction = defineAction(
  {
    name: 'voice.panel.repair',
    module: 'voiceHub',
    selfService: true,
    schema: kanalSchema,
    rateLimit: 'voiceOwn',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ok = await voiceHub.repairTalkPanel(voiceKontext(ctx), input.kanalId);
    revalidatePath('/voice');
    return { ok };
  },
);

// --- Persoenliche Voreinstellungen -----------------------------------------

export const savePreferencesAction = defineAction(
  {
    name: 'voice.preferences',
    module: 'voiceHub',
    // Die eigenen Vorlieben - es gibt nichts zu pruefen ausser der Anmeldung.
    selfService: true,
    schema: z.object({
      preferredName: z.string().max(100).nullable(),
      preferredLimit: z.number().int().min(0).max(99).nullable(),
      preferredBitrate: z.number().int().min(8000).max(384000).nullable(),
      applyPreferences: z.boolean(),
      autoAllowTrusted: z.boolean(),
    }),
    rateLimit: 'voiceOwn',
  },
  async ({ ctx, input }) => {
    await voiceHub.savePreferences(ctx.user.discordId, input);
    revalidatePath('/voice');
    return { ok: true };
  },
);

export const addTrustedAction = defineAction(
  {
    name: 'voice.trusted.add',
    module: 'voiceHub',
    selfService: true,
    schema: z.object({
      discordId: z.string().regex(/^\d{17,20}$/u),
      username: z.string().max(100).nullable().optional(),
    }),
    rateLimit: 'voiceOwn',
  },
  async ({ ctx, input }) => {
    await voiceHub.addTrusted(ctx.user.discordId, {
      discordId: input.discordId,
      username: input.username ?? null,
    });
    revalidatePath('/voice');
    return { ok: true };
  },
);

export const removeTrustedAction = defineAction(
  {
    name: 'voice.trusted.remove',
    module: 'voiceHub',
    selfService: true,
    schema: z.object({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'voiceOwn',
  },
  async ({ ctx, input }) => {
    await voiceHub.removeTrusted(ctx.user.discordId, input.discordId);
    revalidatePath('/voice');
    return { ok: true };
  },
);
