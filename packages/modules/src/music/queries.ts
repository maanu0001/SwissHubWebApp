import { prisma } from '@swisshub/database';
import type { MusicBotInstance, MusicQueueItem, MusicSession } from '@swisshub/database';
import { botIstVerfuegbar } from './allocation';
import { getModuleSettings } from '../module-state';
import { MUSIC_MODULE_ID, type MusicSettings } from './config';

/** Der vollstaendige Zustand einer Session - eine Struktur fuer Web und Bot. */
export interface PlayerState {
  session: MusicSession;
  bot: Pick<MusicBotInstance, 'id' | 'key' | 'type' | 'name' | 'status' | 'discordUserId' | 'avatarHash'> | null;
  /** Ob der zugewiesene Bot sich kuerzlich gemeldet hat. */
  botErreichbar: boolean;
  currentItem: MusicQueueItem | null;
  queue: MusicQueueItem[];
  /**
   * Wiedergabeposition in Sekunden im Moment der Abfrage.
   *
   * Der Browser rechnet ab hier selbst weiter, statt sekuendlich zu fragen -
   * dafuer reichen Startzeitpunkt, Pausendauer und der Pausenzustand.
   */
  positionSeconds: number;
  isPaused: boolean;
}

export function berechnePosition(session: MusicSession, jetzt = new Date()): number {
  if (!session.trackStartedAt) {
    return 0;
  }
  const ende = session.pausedAt ?? jetzt;
  const ms = ende.getTime() - session.trackStartedAt.getTime() - session.pausedMs;
  return Math.max(0, Math.floor(ms / 1000));
}

export async function getPlayerState(sessionId: string): Promise<PlayerState | null> {
  const session = await prisma.musicSession.findUnique({
    where: { id: sessionId },
    include: { botInstance: true },
  });
  if (!session) {
    return null;
  }

  const [queue, currentItem] = await Promise.all([
    prisma.musicQueueItem.findMany({ where: { sessionId }, orderBy: { position: 'asc' } }),
    session.currentItemId
      ? prisma.musicQueueItem.findUnique({ where: { id: session.currentItemId } })
      : Promise.resolve(null),
  ]);

  const { botInstance, ...rest } = session;
  return {
    session: rest,
    bot: botInstance
      ? {
          id: botInstance.id,
          key: botInstance.key,
          type: botInstance.type,
          name: botInstance.name,
          status: botInstance.status,
          discordUserId: botInstance.discordUserId,
          avatarHash: botInstance.avatarHash,
        }
      : null,
    botErreichbar: botInstance ? botIstVerfuegbar(botInstance) : false,
    currentItem: currentItem ?? null,
    queue: queue.filter((eintrag) => eintrag.id !== session.currentItemId),
    positionSeconds: berechnePosition(rest),
    isPaused: rest.pausedAt !== null,
  };
}

/** Die laufende Session eines Voice-Kanals. */
export async function getSessionForChannel(
  guildId: string,
  voiceChannelId: string,
): Promise<MusicSession | null> {
  return prisma.musicSession.findUnique({
    where: { activeChannelKey: `${guildId}:${voiceChannelId}` },
  });
}

export interface SessionOverviewRow {
  session: MusicSession;
  botName: string | null;
  botKey: string | null;
  currentTitle: string | null;
  queueLength: number;
}

/** Alle laufenden Sessions - fuer die Verwaltung. */
export async function listActiveSessions(guildId?: string): Promise<SessionOverviewRow[]> {
  const sessions = await prisma.musicSession.findMany({
    where: { endedAt: null, ...(guildId ? { guildId } : {}) },
    include: { botInstance: true },
    orderBy: { createdAt: 'asc' },
  });

  const zaehler = await prisma.musicQueueItem.groupBy({
    by: ['sessionId'],
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    _count: { _all: true },
  });
  const nachSession = new Map(zaehler.map((e) => [e.sessionId, e._count._all]));

  const aktuelle = await prisma.musicQueueItem.findMany({
    where: { id: { in: sessions.map((s) => s.currentItemId).filter((id): id is string => id !== null) } },
    select: { id: true, title: true },
  });
  const titel = new Map(aktuelle.map((e) => [e.id, e.title]));

  return sessions.map((session) => {
    const { botInstance, ...rest } = session;
    return {
      session: rest,
      botName: botInstance?.name ?? null,
      botKey: botInstance?.key ?? null,
      currentTitle: rest.currentItemId ? (titel.get(rest.currentItemId) ?? null) : null,
      queueLength: nachSession.get(session.id) ?? 0,
    };
  });
}

export interface BotRow extends MusicBotInstance {
  erreichbar: boolean;
  sessionId: string | null;
  voiceChannelName: string | null;
}

/** Der Bot-Pool mit seinem tatsaechlichen Zustand. */
export async function listBots(): Promise<BotRow[]> {
  const [bots, sessions] = await Promise.all([
    prisma.musicBotInstance.findMany({ orderBy: [{ type: 'asc' }, { key: 'asc' }] }),
    prisma.musicSession.findMany({
      where: { endedAt: null },
      select: { id: true, botInstanceId: true, voiceChannelName: true },
    }),
  ]);
  const nachBot = new Map(
    sessions.filter((s) => s.botInstanceId).map((s) => [s.botInstanceId!, s]),
  );

  return bots.map((bot) => ({
    ...bot,
    erreichbar: botIstVerfuegbar(bot),
    sessionId: nachBot.get(bot.id)?.id ?? null,
    voiceChannelName: nachBot.get(bot.id)?.voiceChannelName ?? null,
  }));
}

/** Zuletzt gespielte Titel einer Guild. */
export async function listHistory(options: {
  guildId: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: Awaited<ReturnType<typeof prisma.musicPlaybackHistory.findMany>>; total: number }> {
  const where = { guildId: options.guildId };
  const [rows, total] = await Promise.all([
    prisma.musicPlaybackHistory.findMany({
      where,
      orderBy: { playedAt: 'desc' },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    prisma.musicPlaybackHistory.count({ where }),
  ]);
  return { rows, total };
}

/** Die Moduleinstellungen - eine Stelle fuer Web, Bot und Laufzeit. */
export async function getMusicSettings(): Promise<MusicSettings> {
  return getModuleSettings<MusicSettings>(MUSIC_MODULE_ID);
}
