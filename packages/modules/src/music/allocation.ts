import { prisma } from '@swisshub/database';
import type { MusicBotInstance, MusicSession, Prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { MUSIC_MODULE_ID, type MusicSettings } from './config';

const logger = createLogger('music:allocation');

/** Ein Bot gilt als tot, wenn er sich so lange nicht gemeldet hat. */
export const HEARTBEAT_TIMEOUT_MS = 90_000;

export interface AllocationRequest {
  guildId: string;
  voiceChannelId: string;
  voiceChannelName?: string | null;
  requesterDiscordUserId: string;
  /** Discord-Rollen des Anfragenden - entscheidet die Zuweisungspolitik. */
  requesterRoleIds: string[];
}

/**
 * Ist der Bot gerade einsetzbar?
 *
 * Ein Eintrag in der Datenbank genuegt ausdruecklich nicht: der Legacy-Bot
 * konnte "online" nur behaupten, weil ein Token in der Konfiguration stand.
 * Hier zaehlt, dass sich die Laufzeit kuerzlich gemeldet hat.
 */
export function botIstVerfuegbar(bot: MusicBotInstance, jetzt = new Date()): boolean {
  if (!bot.enabled || bot.status === 'DISABLED' || bot.status === 'DRAINING') {
    return false;
  }
  if (!bot.lastHeartbeatAt) {
    return false;
  }
  return jetzt.getTime() - bot.lastHeartbeatAt.getTime() < HEARTBEAT_TIMEOUT_MS;
}

const kanalSchluessel = (guildId: string, voiceChannelId: string): string =>
  `${guildId}:${voiceChannelId}`;

/**
 * Eine Session fuer einen Voice-Kanal beschaffen.
 *
 * Die Legacy-Politik bleibt: wer die Worker-only-Rolle traegt, bekommt
 * niemals den Controller; sonst zuerst der Controller, wenn er frei ist, und
 * danach ein Worker. Neu ist, *wie* zugewiesen wird.
 *
 * `active_session[(guild, channel)]` war eine gewoehnliche Zuordnung im
 * Arbeitsspeicher. Zwei gleichzeitige `/join` lasen beide "frei" und
 * schrieben beide - der zweite ueberschrieb den ersten, und derselbe Worker
 * stand in zwei Kanaelen. Hier entscheidet die Datenbank: `activeChannelKey`
 * und `activeBotKey` sind eindeutig, und der Versuch, sie doppelt zu
 * belegen, scheitert. Die Schleife nimmt dann den naechsten Bot.
 */
export async function allocateSession(
  anfrage: AllocationRequest,
): Promise<{ session: MusicSession; wiederverwendet: boolean }> {
  const settings = await getModuleSettings<MusicSettings>(MUSIC_MODULE_ID);

  // 1. Laeuft in diesem Kanal bereits etwas? Dann ist das die Session.
  const vorhanden = await prisma.musicSession.findUnique({
    where: { activeChannelKey: kanalSchluessel(anfrage.guildId, anfrage.voiceChannelId) },
  });
  if (vorhanden) {
    return { session: vorhanden, wiederverwendet: true };
  }

  const nurWorker = Boolean(
    settings.workerOnlyRoleId && anfrage.requesterRoleIds.includes(settings.workerOnlyRoleId),
  );

  const bots = await prisma.musicBotInstance.findMany({ orderBy: { key: 'asc' } });
  const jetzt = new Date();
  const verfuegbar = bots.filter((bot) => botIstVerfuegbar(bot, jetzt));

  // 2. Reihenfolge nach Legacy-Politik.
  const controller = verfuegbar.filter((bot) => bot.type === 'CONTROLLER');
  const worker = verfuegbar.filter((bot) => bot.type === 'WORKER');
  const reihenfolge =
    nurWorker || !settings.controllerPlaysMusic ? worker : [...controller, ...worker];

  if (reihenfolge.length === 0) {
    throw new AppError('CONFLICT', {
      userMessage: verfuegbar.length === 0
        ? 'Derzeit ist kein Musik-Bot erreichbar.'
        : 'Alle Musik-Bots sind momentan belegt.',
    });
  }

  // 3. Der Reihe nach versuchen. Wer schon in einer Session steht, scheitert
  //    am eindeutigen Schluessel - dann kommt der naechste dran.
  for (const bot of reihenfolge) {
    try {
      const session = await prisma.musicSession.create({
        data: {
          guildId: anfrage.guildId,
          voiceChannelId: anfrage.voiceChannelId,
          voiceChannelName: anfrage.voiceChannelName ?? null,
          botInstanceId: bot.id,
          status: 'STARTING',
          activeChannelKey: kanalSchluessel(anfrage.guildId, anfrage.voiceChannelId),
          activeBotKey: bot.id,
          volume: Math.min(settings.defaultVolume, settings.maxVolume),
          startedByDiscordUserId: anfrage.requesterDiscordUserId,
        },
      });
      await prisma.musicBotInstance.update({
        where: { id: bot.id },
        data: { status: 'BUSY' },
      });
      logger.info('Musik-Session zugewiesen', {
        sessionId: session.id,
        botKey: bot.key,
        guildId: anfrage.guildId,
        voiceChannelId: anfrage.voiceChannelId,
      });
      return { session, wiederverwendet: false };
    } catch (error) {
      if (istEindeutigkeitsfehler(error)) {
        // Entweder war der Bot schneller anderweitig vergeben, oder ein
        // paralleler Aufruf hat die Session fuer diesen Kanal bereits
        // angelegt. Im zweiten Fall ist genau sie das Ergebnis.
        const inzwischen = await prisma.musicSession.findUnique({
          where: { activeChannelKey: kanalSchluessel(anfrage.guildId, anfrage.voiceChannelId) },
        });
        if (inzwischen) {
          return { session: inzwischen, wiederverwendet: true };
        }
        continue;
      }
      throw error;
    }
  }

  throw new AppError('CONFLICT', {
    userMessage: 'Alle Musik-Bots sind momentan belegt.',
  });
}

function istEindeutigkeitsfehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}

export interface PoolCapacity {
  total: number;
  verfuegbar: number;
  belegt: number;
  frei: number;
  offline: number;
}

/** Auslastung des Pools - Grundlage der Kapazitaetsanzeige. */
export async function getPoolCapacity(): Promise<PoolCapacity> {
  const bots = await prisma.musicBotInstance.findMany();
  const jetzt = new Date();
  const verfuegbar = bots.filter((bot) => botIstVerfuegbar(bot, jetzt));
  const belegt = await prisma.musicSession.count({ where: { activeBotKey: { not: null } } });
  return {
    total: bots.length,
    verfuegbar: verfuegbar.length,
    belegt,
    frei: Math.max(0, verfuegbar.length - belegt),
    offline: bots.length - verfuegbar.length,
  };
}
