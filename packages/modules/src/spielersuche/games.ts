import { AUDIT_ACTIONS, Prisma, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict } from '@swisshub/shared';
import type { SpielersucheGame } from '@swisshub/database';
import { SPIELERSUCHE_MODULE_ID } from './config';
import type { CreateGameInput, UpdateGameInput } from './schemas';

const log = createLogger('spielersuche:games');

/**
 * Spieleverwaltung.
 *
 * Der alte Bot pflegte Spiele über `/spielersucheadmin game-add` mit einer
 * Rollen-ID als Freitext. Hier ist die Liste eine gewöhnliche Ressource des
 * Dashboards; der Slash Command liest genau dieselben Zeilen.
 */

export interface GameActor {
  discordId: string;
  username: string;
}

export interface ListGamesOptions {
  includeDisabled?: boolean;
}

const nameKeyOf = (name: string): string => name.trim().toLowerCase();

export async function listGames(options: ListGamesOptions = {}): Promise<SpielersucheGame[]> {
  return prisma.spielersucheGame.findMany({
    where: options.includeDisabled ? {} : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getGame(gameId: string): Promise<SpielersucheGame | null> {
  return prisma.spielersucheGame.findUnique({ where: { id: gameId } });
}

/**
 * Auswahlliste für den Slash Command.
 *
 * Discord erlaubt höchstens 25 Vorschläge; gefiltert wird nach Teilstring,
 * damit sich Tippen wie eine Suche anfühlt.
 */
export async function searchGamesForAutocomplete(
  query: string,
  limit = 25,
): Promise<Array<{ id: string; name: string }>> {
  const games = await listGames();
  const needle = query.trim().toLowerCase();
  return games
    .filter((game) => needle.length === 0 || game.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((game) => ({ id: game.id, name: game.name }));
}

export async function createGame(input: CreateGameInput, actor: GameActor): Promise<SpielersucheGame> {
  try {
    const game = await prisma.spielersucheGame.create({
      data: {
        name: input.name,
        nameKey: nameKeyOf(input.name),
        roleId: input.roleId,
        bannerUrl: input.bannerUrl,
        maxSquadSize: input.maxSquadSize,
        enabled: input.enabled,
        createdByDiscordId: actor.discordId,
      },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SPIELERSUCHE_GAME_CREATED,
      module: SPIELERSUCHE_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      success: true,
      metadata: {
        gameId: game.id,
        name: game.name,
        roleId: game.roleId,
        maxSquadSize: game.maxSquadSize,
      },
    });

    log.info('Spiel angelegt', { gameId: game.id, name: game.name });
    return game;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict(`Es gibt bereits ein Spiel mit dem Namen "${input.name}".`);
    }
    throw error;
  }
}

export async function updateGame(input: UpdateGameInput, actor: GameActor): Promise<SpielersucheGame> {
  const existing = await prisma.spielersucheGame.findUnique({ where: { id: input.gameId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', { userMessage: 'Das Spiel wurde nicht gefunden.' });
  }

  try {
    const game = await prisma.spielersucheGame.update({
      where: { id: input.gameId },
      data: {
        name: input.name,
        nameKey: nameKeyOf(input.name),
        roleId: input.roleId,
        bannerUrl: input.bannerUrl,
        maxSquadSize: input.maxSquadSize,
        enabled: input.enabled,
      },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SPIELERSUCHE_GAME_UPDATED,
      module: SPIELERSUCHE_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      success: true,
      metadata: {
        gameId: game.id,
        name: game.name,
        // Nur die tatsächlichen Änderungen - das hält das Audit Log lesbar.
        changed: [
          existing.name !== game.name ? 'name' : null,
          existing.roleId !== game.roleId ? 'roleId' : null,
          existing.bannerUrl !== game.bannerUrl ? 'bannerUrl' : null,
          existing.maxSquadSize !== game.maxSquadSize ? 'maxSquadSize' : null,
          existing.enabled !== game.enabled ? 'enabled' : null,
        ].filter(Boolean),
      },
    });

    return game;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict(`Es gibt bereits ein Spiel mit dem Namen "${input.name}".`);
    }
    throw error;
  }
}

/**
 * Löscht ein Spiel.
 *
 * Vergangene Suchen bleiben erhalten: sie speichern den Spielnamen als Text
 * mit. Läuft noch eine Suche zu diesem Spiel, wird das Löschen abgelehnt -
 * sonst stünde eine offene Gruppe ohne Bezug da.
 */
export async function deleteGame(gameId: string, actor: GameActor): Promise<void> {
  const game = await prisma.spielersucheGame.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new AppError('NOT_FOUND', { userMessage: 'Das Spiel wurde nicht gefunden.' });
  }

  const active = await prisma.spielersucheMatch.count({
    where: { gameId, status: { in: ['OPEN', 'COMPLETE'] } },
  });
  if (active > 0) {
    throw conflict(
      `Zu "${game.name}" ${active === 1 ? 'läuft noch eine Suche' : `laufen noch ${active} Suchen`}. Bitte zuerst beenden oder das Spiel nur deaktivieren.`,
    );
  }

  await prisma.$transaction([
    // Vergangene Suchen behalten ihren Spielnamen als Text.
    prisma.spielersucheMatch.updateMany({ where: { gameId }, data: { gameId: null } }),
    prisma.spielersucheGame.delete({ where: { id: gameId } }),
  ]);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_GAME_DELETED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { gameId, name: game.name },
  });

  log.info('Spiel gelöscht', { gameId, name: game.name });
}

export interface GameUsage {
  gameId: string;
  searches: number;
  participants: number;
  completed: number;
  voiceSeconds: number;
  lastUsedAt: Date | null;
}

/**
 * Nutzungszahlen je Spiel.
 *
 * Bewusst als eigene Abfrage statt als Zähler am Spiel: gezählt wird immer
 * aus den echten Daten, dadurch kann nichts auseinanderlaufen.
 */
export async function getGameUsage(): Promise<Map<string, GameUsage>> {
  const [matches, completed, participants, voice] = await Promise.all([
    prisma.spielersucheMatch.groupBy({
      by: ['gameId'],
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.spielersucheMatch.groupBy({
      by: ['gameId'],
      where: { status: { in: ['COMPLETE'] } },
      _count: { _all: true },
    }),
    prisma.spielersucheMatch.findMany({
      select: { gameId: true, _count: { select: { participants: true } } },
    }),
    prisma.spielersucheMatch.findMany({
      select: { gameId: true, voiceSessions: { select: { durationSeconds: true } } },
    }),
  ]);

  const usage = new Map<string, GameUsage>();
  const ensure = (gameId: string): GameUsage => {
    const existing = usage.get(gameId);
    if (existing) {
      return existing;
    }
    const created: GameUsage = {
      gameId,
      searches: 0,
      participants: 0,
      completed: 0,
      voiceSeconds: 0,
      lastUsedAt: null,
    };
    usage.set(gameId, created);
    return created;
  };

  for (const row of matches) {
    if (!row.gameId) {
      continue;
    }
    const entry = ensure(row.gameId);
    entry.searches = row._count._all;
    entry.lastUsedAt = row._max.createdAt;
  }
  for (const row of completed) {
    if (row.gameId) {
      ensure(row.gameId).completed = row._count._all;
    }
  }
  for (const row of participants) {
    if (row.gameId) {
      ensure(row.gameId).participants += row._count.participants;
    }
  }
  for (const row of voice) {
    if (row.gameId) {
      ensure(row.gameId).voiceSeconds += row.voiceSessions.reduce(
        (total, session) => total + session.durationSeconds,
        0,
      );
    }
  }

  return usage;
}
