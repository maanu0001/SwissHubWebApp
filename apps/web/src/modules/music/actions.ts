'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { env } from '@swisshub/config';
import { music } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { darfSessionSteuern } from '@/server/music';

/**
 * Steuerung des Musikplayers.
 *
 * Jede Aktion prueft serverseitig, ob die aufrufende Person genau diese
 * Session steuern darf - eine Session-ID aus dem Browser sagt darueber
 * nichts aus. Danach laeuft alles durch `MusicSessionService`, dieselbe
 * Schicht, die auch die Slash-Befehle benutzen.
 *
 * Und: keine Aktion meldet Erfolg, weil sie einen Befehl abgelegt hat. Sie
 * wartet auf die Bestaetigung der Voice-Laufzeit. Bleibt die aus, sagt die
 * Oberflaeche das - statt "Pausiert" anzuzeigen, waehrend nichts passiert.
 */

const sessionSchema = z.object({ sessionId: z.string().cuid() });

/** Gemeinsame Vorpruefung: existiert die Session, und darf ich sie steuern? */
async function pruefeZugriff(
  context: Parameters<typeof darfSessionSteuern>[0],
  sessionId: string,
): Promise<void> {
  if (!(await darfSessionSteuern(context, sessionId))) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du kannst nur die Session deines eigenen Sprachkanals steuern.',
    });
  }
}

function actor(ctx: { user: { discordId: string; username: string } }) {
  return { discordUserId: ctx.user.discordId, username: ctx.user.username, origin: 'web' as const };
}

/** Ergebnis eines Befehls in eine Antwort uebersetzen. */
async function warte(commandId: string): Promise<{ ok: true } | never> {
  const ergebnis = await music.waitForCommand(commandId);
  const meldung = music.commandMeldung(ergebnis);
  if (meldung) {
    throw new AppError('CONFLICT', { userMessage: meldung });
  }
  return { ok: true };
}

export const pauseAction = defineAction(
  {
    name: 'music.pause',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.pause,
    schema: sessionSchema,
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.pause(input.sessionId, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

export const resumeAction = defineAction(
  {
    name: 'music.resume',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.pause,
    schema: sessionSchema,
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.resume(input.sessionId, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

export const skipAction = defineAction(
  {
    name: 'music.skip',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.skip,
    schema: sessionSchema,
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.skip(input.sessionId, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

/**
 * Innerhalb des laufenden Titels springen.
 *
 * Hängt an derselben Berechtigung wie «Überspringen»: wer den Titel ganz
 * wegschalten darf, darf ihn erst recht vorspulen. Eine eigene Berechtigung
 * wäre eine mehr zu pflegen, ohne dass sie je anders vergeben würde.
 *
 * Die Sekunde kommt aus dem Browser und wird deshalb hier geprüft und im
 * Service noch einmal gegen die tatsächliche Titellänge begrenzt. Was der
 * Browser schickt, ist ein Wunsch, keine Tatsache.
 */
export const seekAction = defineAction(
  {
    name: 'music.seek',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.skip,
    schema: sessionSchema.extend({
      positionSeconds: z.coerce
        .number()
        .int()
        .min(0)
        .max(24 * 3600),
    }),
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.seek(input.sessionId, input.positionSeconds, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

export const stopAction = defineAction(
  {
    name: 'music.stop',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.sessionStop,
    schema: sessionSchema,
    rateLimit: 'musicControl',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.stop(input.sessionId, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

export const leaveAction = defineAction(
  {
    name: 'music.leave',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.sessionStop,
    schema: sessionSchema,
    rateLimit: 'musicSession',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    await music.sessionService.endSession(input.sessionId, 'MANUAL', actor(ctx));
    revalidatePath('/musik');
    return { ok: true };
  },
);

export const setVolumeAction = defineAction(
  {
    name: 'music.volume',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.volume,
    schema: sessionSchema.extend({ volume: z.number().int().min(0).max(150) }),
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.setVolume(input.sessionId, input.volume, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

export const setLoopAction = defineAction(
  {
    name: 'music.loop',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.loop,
    schema: sessionSchema.extend({ mode: z.enum(['OFF', 'TRACK', 'QUEUE']) }),
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    const id = await music.sessionService.setLoop(input.sessionId, input.mode, actor(ctx));
    const antwort = await warte(id);
    revalidatePath('/musik');
    return antwort;
  },
);

export const removeItemAction = defineAction(
  {
    name: 'music.queue.remove',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.queueManage,
    schema: sessionSchema.extend({ queueItemId: z.string().cuid() }),
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    await music.sessionService.removeItem(input.sessionId, input.queueItemId, actor(ctx));
    revalidatePath('/musik');
    return { ok: true };
  },
);

export const moveItemAction = defineAction(
  {
    name: 'music.queue.move',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.queueManage,
    schema: sessionSchema.extend({
      queueItemId: z.string().cuid(),
      targetIndex: z.number().int().min(0).max(999),
    }),
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    await music.sessionService.moveItem(input.sessionId, input.queueItemId, input.targetIndex, actor(ctx));
    revalidatePath('/musik');
    return { ok: true };
  },
);

export const shuffleAction = defineAction(
  {
    name: 'music.queue.shuffle',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.queueManage,
    schema: sessionSchema,
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);
    await music.sessionService.shuffle(input.sessionId, actor(ctx));
    revalidatePath('/musik');
    return { ok: true };
  },
);

/** Der Provider, sobald er konfiguriert ist. */
function provider(): music.MusicProvider {
  const basis = env.MUSIC_RUNTIME_URL;
  const schluessel = env.MUSIC_RUNTIME_KEY;
  if (!basis || !schluessel) {
    throw new AppError('CONFLICT', {
      userMessage: 'Die Musiksuche ist nicht konfiguriert.',
    });
  }
  return new music.YouTubeMusicProvider(basis, schluessel);
}

export const searchAction = defineAction(
  {
    name: 'music.search',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.play,
    schema: z.object({ query: z.string().min(1).max(200) }),
    rateLimit: 'musicSearch',
  },
  async ({ input }) => {
    const p = provider();
    const begriff = input.query.trim();

    // Eine gueltige Adresse wird direkt aufgeloest - wie im Legacy-Bot, wo
    // eine URL ohne Auswahl direkt gespielt wurde.
    if (/^https?:\/\//iu.test(begriff)) {
      try {
        return { treffer: [await p.resolve(begriff)], direkt: true };
      } catch (fehler) {
        if (fehler instanceof music.MusicProviderInputError) {
          throw new AppError('VALIDATION_FAILED', { userMessage: fehler.message });
        }
        throw new AppError('CONFLICT', {
          userMessage: 'Die Musiksuche ist derzeit nicht erreichbar.',
        });
      }
    }

    try {
      const einstellungen = await music.getMusicSettings();
      return { treffer: await p.search(begriff, einstellungen.searchResultLimit), direkt: false };
    } catch {
      throw new AppError('CONFLICT', {
        userMessage: 'Die Musiksuche ist derzeit nicht erreichbar.',
      });
    }
  },
);

export const addTrackAction = defineAction(
  {
    name: 'music.queue.add',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.play,
    schema: sessionSchema.extend({ webpageUrl: z.string().url().max(2000) }),
    rateLimit: 'musicControl',
  },
  async ({ ctx, input }) => {
    await pruefeZugriff(ctx, input.sessionId);

    // Bewusst erneut aufloesen statt Titel und Dauer aus dem Browser zu
    // uebernehmen: sonst koennte jemand beliebige Angaben in die
    // Warteschlange schreiben.
    const p = provider();
    const treffer = await p.resolve(input.webpageUrl).catch(() => {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Dieser Titel konnte nicht geladen werden.',
      });
    });

    const eintrag = await music.sessionService.addTrack(input.sessionId, treffer, actor(ctx));
    revalidatePath('/musik');
    return { titel: eintrag.title };
  },
);

export const startSessionAction = defineAction(
  {
    name: 'music.session.start',
    module: 'music',
    permission: music.MUSIC_PERMISSIONS.sessionStart,
    schema: z.object({}),
    rateLimit: 'musicSession',
    freshness: 'critical',
  },
  async ({ ctx }) => {
    const praesenz = await prisma.voicePresence.findUnique({
      where: { discordId: ctx.user.discordId },
    });
    if (!praesenz) {
      throw new AppError('CONFLICT', {
        userMessage: 'Tritt zuerst einem Discord Voice-Channel bei.',
      });
    }

    const { session } = await music.allocateSession({
      guildId: praesenz.guildId,
      voiceChannelId: praesenz.channelId,
      voiceChannelName: praesenz.channelName,
      requesterDiscordUserId: ctx.user.discordId,
      requesterRoleIds: ctx.roleIds,
    });

    // Der Bot muss den Kanal betreten - das bestaetigt die Laufzeit.
    const commandId = await music.sessionService.join(session.id, actor(ctx));
    await warte(commandId);

    revalidatePath('/musik');
    return { sessionId: session.id };
  },
);
