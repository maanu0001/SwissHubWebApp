import { Prisma, prisma, type LevelGameMatch, type XpGameKind } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound } from '@swisshub/shared';
import { DEFAULT_PAYOUT_FACTOR, GAME_LABELS, payoutFor } from './game-rules';
import { applyXp, reserveStake, type LevelIdentity, type XpEngineOptions } from './service';

const logger = createLogger('level.games');

/**
 * Ablauf der XP-Spiele.
 *
 * Zwei Dinge unterscheiden sich bewusst vom Vorgänger:
 *
 * 1. Wer gerade spielt, steht in der Datenbank statt in einer Menge im
 *    Arbeitsspeicher. Ein Neustart des Bots gab dort jede Sperre frei - und
 *    damit die Möglichkeit, dieselben XP mehrfach zu setzen.
 * 2. Der Einsatz wird beim Annehmen abgebucht, nicht erst beim Abrechnen.
 *    Vorher liess sich derselbe Punktestand gleichzeitig in mehreren Partien
 *    einsetzen; am Ende gewann, wer zuerst abrechnete.
 *
 * Das Nettoergebnis für Gewinner und Verlierer bleibt identisch: Verlierer
 * verliert den Einsatz, Gewinner erhält `Einsatz * 2 * 0.95` abzüglich des
 * eigenen Einsatzes.
 */

export interface GameActor extends LevelIdentity {
  discordId: string;
}

export interface CreateGameInput {
  kind: XpGameKind;
  challenger: GameActor;
  opponent: GameActor;
  bet: number;
  guildId?: string | null;
  channelId?: string | null;
  payoutFactor?: number;
  minBet?: number;
  maxBet?: number;
  /** Frist zum Annehmen. */
  acceptTimeoutSeconds?: number;
}

const stakeKey = (matchId: string, discordId: string): string => `game:${matchId}:stake:${discordId}`;
const refundKey = (matchId: string, discordId: string, phase: string): string =>
  `game:${matchId}:refund:${phase}:${discordId}`;
const payoutKey = (matchId: string, discordId: string): string => `game:${matchId}:payout:${discordId}`;

export async function getGameMatch(matchId: string): Promise<LevelGameMatch | null> {
  return prisma.levelGameMatch.findUnique({ where: { id: matchId } });
}

/** Merkt sich die veröffentlichte Nachricht, damit sie später bearbeitet werden kann. */
export async function setGameMessage(matchId: string, messageId: string): Promise<void> {
  await prisma.levelGameMatch.update({ where: { id: matchId }, data: { messageId } });
}

/** Läuft für diese Person gerade eine Partie? */
export async function findActiveGame(discordId: string): Promise<LevelGameMatch | null> {
  return prisma.levelGameMatch.findFirst({
    where: {
      OR: [{ activeChallengerKey: discordId }, { activeOpponentKey: discordId }],
    },
  });
}

/**
 * Legt eine Herausforderung an.
 *
 * Die beiden Unique-Indizes auf `activeChallengerKey` und `activeOpponentKey`
 * sorgen dafür, dass niemand in zwei Partien gleichzeitig steckt - auch dann
 * nicht, wenn zwei Befehle im selben Moment eintreffen.
 */
export async function createChallenge(input: CreateGameInput): Promise<LevelGameMatch> {
  const bet = Math.trunc(input.bet);
  const minBet = input.minBet ?? 1;
  const maxBet = input.maxBet ?? 5000;

  if (input.challenger.discordId === input.opponent.discordId) {
    throw conflict('Du chasch nid gege dich selber spiele.');
  }
  if (!Number.isFinite(bet) || bet < minBet) {
    throw conflict(`De chliinscht Isatz isch ${minBet} XP.`);
  }
  if (bet > maxBet) {
    throw conflict(`De grööscht Isatz isch ${maxBet} XP.`);
  }

  // Vor dem Anlegen prüfen, damit die Meldung den Grund nennt, statt nur eine
  // verletzte Eindeutigkeit zu melden.
  const challengerProfile = await prisma.levelProfile.findUnique({
    where: { discordId: input.challenger.discordId },
  });
  if ((challengerProfile?.xp ?? 0) < bet) {
    throw conflict('Du hesch nid gnueg XP für de Isatz.');
  }
  const opponentProfile = await prisma.levelProfile.findUnique({
    where: { discordId: input.opponent.discordId },
  });
  if ((opponentProfile?.xp ?? 0) < bet) {
    throw conflict('Dis Gegenüber het nid gnueg XP für de Isatz.');
  }

  const timeout = input.acceptTimeoutSeconds ?? 30;

  try {
    return await prisma.levelGameMatch.create({
      data: {
        kind: input.kind,
        status: 'PENDING',
        challengerDiscordId: input.challenger.discordId,
        opponentDiscordId: input.opponent.discordId,
        bet,
        payout: payoutFor(bet, input.payoutFactor ?? DEFAULT_PAYOUT_FACTOR),
        guildId: input.guildId ?? null,
        channelId: input.channelId ?? null,
        expiresAt: new Date(Date.now() + timeout * 1000),
        activeChallengerKey: input.challenger.discordId,
        activeOpponentKey: input.opponent.discordId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const fields = (error.meta?.target as string[] | undefined) ?? [];
      if (fields.includes('activeChallengerKey')) {
        throw conflict('Du hesch scho es Spiel am laufe.');
      }
      if (fields.includes('activeOpponentKey')) {
        throw conflict('Dis Gegenüber het scho es Spiel am laufe.');
      }
    }
    throw error;
  }
}

/**
 * Nimmt eine Herausforderung an und zieht beide Einsätze ein.
 *
 * Reicht das Guthaben einer Seite nicht mehr, wird bereits Eingezogenes
 * zurückgegeben und die Partie verworfen.
 */
export async function acceptChallenge(
  matchId: string,
  accepting: GameActor,
  options: XpEngineOptions & { playTimeoutSeconds?: number } = {},
): Promise<LevelGameMatch> {
  const match = await prisma.levelGameMatch.findUnique({ where: { id: matchId } });
  if (!match) {
    throw notFound('Spiel nicht gefunden', 'Das Spiel gits nümme.');
  }
  if (match.opponentDiscordId !== accepting.discordId) {
    throw conflict('Die Herusforderig isch nid für dich.');
  }
  if (match.status !== 'PENDING') {
    throw conflict('Die Herusforderig isch nümme offe.');
  }
  if (match.expiresAt && match.expiresAt.getTime() < Date.now()) {
    await closeGame(matchId, 'TIMEOUT', 'Zeit abgelaufen', options);
    throw conflict('Die Herusforderig isch abgloffe.');
  }

  // Ab jetzt zaehlt die Spielzeit, nicht mehr die Frist zum Annehmen.
  const playTimeout = options.playTimeoutSeconds ?? 300;
  const started = await prisma.levelGameMatch.updateMany({
    where: { id: matchId, status: 'PENDING' },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + playTimeout * 1000),
    },
  });
  if (started.count === 0) {
    throw conflict('Die Herusforderig isch nümme offe.');
  }

  const reason = `${GAME_LABELS[match.kind]}: Einsatz`;
  try {
    await reserveStake(
      { discordId: match.challengerDiscordId },
      match.bet,
      { gameMatchId: match.id, reason, idempotencyKey: stakeKey(match.id, match.challengerDiscordId) },
      options,
    );
  } catch (error) {
    await closeGame(matchId, 'CANCELLED', 'Einsatz nicht gedeckt', options);
    throw error;
  }

  try {
    await reserveStake(
      { ...accepting },
      match.bet,
      { gameMatchId: match.id, reason, idempotencyKey: stakeKey(match.id, accepting.discordId) },
      options,
    );
  } catch (error) {
    // Der Herausforderer hat bereits gesetzt - das muss zurück.
    await refundPlayer(match, match.challengerDiscordId, 'stake', options);
    await closeGame(matchId, 'CANCELLED', 'Einsatz nicht gedeckt', options);
    throw error;
  }

  return prisma.levelGameMatch.update({
    where: { id: matchId },
    data: { potHeld: true },
  });
}

async function refundPlayer(
  match: LevelGameMatch,
  discordId: string,
  phase: string,
  options: XpEngineOptions,
): Promise<void> {
  await applyXp(
    {
      discordId,
      delta: match.bet,
      source: 'GAME_REFUND',
      reason: `${GAME_LABELS[match.kind]}: Einsatz zurück`,
      gameMatchId: match.id,
      idempotencyKey: refundKey(match.id, discordId, phase),
    },
    options,
  );
}

/**
 * Beendet eine Partie ohne Sieger und gibt die Einsätze zurück.
 *
 * Gilt für Unentschieden, abgelehnte und abgelaufene Herausforderungen.
 */
export async function closeGame(
  matchId: string,
  status: 'DRAW' | 'DECLINED' | 'TIMEOUT' | 'CANCELLED',
  reason: string,
  options: XpEngineOptions = {},
): Promise<LevelGameMatch> {
  const match = await prisma.levelGameMatch.findUnique({ where: { id: matchId } });
  if (!match) {
    throw notFound('Spiel nicht gefunden', 'Das Spiel gits nümme.');
  }
  if (match.finishedAt) {
    return match;
  }

  if (match.potHeld) {
    await refundPlayer(match, match.challengerDiscordId, 'close', options);
    await refundPlayer(match, match.opponentDiscordId, 'close', options);
  }

  if (status === 'DRAW') {
    await recordDraw(match);
  }

  logger.info('Partie ohne Sieger beendet', {
    matchId,
    kind: match.kind,
    status,
    reason,
    refunded: match.potHeld,
  });

  return prisma.levelGameMatch.update({
    where: { id: matchId },
    data: {
      status,
      finishedAt: new Date(),
      potHeld: false,
      // Gibt beide Seiten für neue Partien frei.
      activeChallengerKey: null,
      activeOpponentKey: null,
    },
  });
}

export interface FinishGameResult {
  match: LevelGameMatch;
  winnerDiscordId: string;
  loserDiscordId: string;
  /** Auszahlung an den Gewinner. */
  payout: number;
  /** Reingewinn des Gewinners nach Abzug seines Einsatzes. */
  net: number;
  xpAfterWinner: number;
  levelUp: boolean;
}

/** Rechnet eine Partie ab: der Gewinner erhält den Topf. */
export async function finishGame(
  matchId: string,
  winnerDiscordId: string,
  options: XpEngineOptions = {},
): Promise<FinishGameResult> {
  const match = await prisma.levelGameMatch.findUnique({ where: { id: matchId } });
  if (!match) {
    throw notFound('Spiel nicht gefunden', 'Das Spiel gits nümme.');
  }
  if (match.finishedAt) {
    throw conflict('Das Spiel isch scho abgrechnet.');
  }
  if (winnerDiscordId !== match.challengerDiscordId && winnerDiscordId !== match.opponentDiscordId) {
    throw conflict('Die Person het nid mitgspielt.');
  }

  const loserDiscordId =
    winnerDiscordId === match.challengerDiscordId ? match.opponentDiscordId : match.challengerDiscordId;

  // Ohne eingezogenen Topf gibt es nichts auszuzahlen. Die Auszahlung trotzdem
  // vorzunehmen hiesse, XP aus dem Nichts zu erzeugen - dann lieber die Partie
  // ergebnislos beenden und den Fall sichtbar machen.
  if (!match.potHeld) {
    logger.error('Partie ohne eingezogenen Einsatz abgerechnet - wird verworfen', {
      matchId,
      kind: match.kind,
      status: match.status,
    });
    await closeGame(matchId, 'CANCELLED', 'Einsatz war nicht eingezogen', options);
    throw conflict('S Spiel isch nid richtig gstartet worde. Es isch kei XP bewegt worde.');
  }

  const result = await applyXp(
    {
      discordId: winnerDiscordId,
      delta: match.payout,
      source: 'GAME_WIN',
      reason: `${GAME_LABELS[match.kind]}: gewonnen`,
      gameMatchId: match.id,
      idempotencyKey: payoutKey(match.id, winnerDiscordId),
    },
    options,
  );

  await recordResult(match, winnerDiscordId, loserDiscordId);

  const updated = await prisma.levelGameMatch.update({
    where: { id: matchId },
    data: {
      status: 'FINISHED',
      winnerDiscordId,
      finishedAt: new Date(),
      potHeld: false,
      activeChallengerKey: null,
      activeOpponentKey: null,
    },
  });

  return {
    match: updated,
    winnerDiscordId,
    loserDiscordId,
    payout: match.payout,
    net: match.payout - match.bet,
    xpAfterWinner: result.xpAfter,
    levelUp: result.levelUp,
  };
}

async function ensureStatsRow(discordId: string, kind: XpGameKind): Promise<string | null> {
  const profile = await prisma.levelProfile.findUnique({ where: { discordId } });
  if (!profile) {
    return null;
  }
  await prisma.levelGameStats.upsert({
    where: { discordId_kind: { discordId, kind } },
    create: { profileId: profile.id, discordId, kind },
    update: {},
  });
  return profile.id;
}

async function recordResult(
  match: LevelGameMatch,
  winnerDiscordId: string,
  loserDiscordId: string,
): Promise<void> {
  if (await ensureStatsRow(winnerDiscordId, match.kind)) {
    await prisma.levelGameStats.update({
      where: { discordId_kind: { discordId: winnerDiscordId, kind: match.kind } },
      data: { wins: { increment: 1 }, xpWon: { increment: match.payout - match.bet } },
    });
  }
  if (await ensureStatsRow(loserDiscordId, match.kind)) {
    await prisma.levelGameStats.update({
      where: { discordId_kind: { discordId: loserDiscordId, kind: match.kind } },
      data: { losses: { increment: 1 }, xpLost: { increment: match.bet } },
    });
  }
}

async function recordDraw(match: LevelGameMatch): Promise<void> {
  for (const discordId of [match.challengerDiscordId, match.opponentDiscordId]) {
    if (await ensureStatsRow(discordId, match.kind)) {
      await prisma.levelGameStats.update({
        where: { discordId_kind: { discordId, kind: match.kind } },
        data: { draws: { increment: 1 } },
      });
    }
  }
}

/**
 * Gibt hängengebliebene Partien frei.
 *
 * Ein Absturz mitten im Spiel würde sonst beide Beteiligten dauerhaft
 * blockieren - beim Vorgänger half nur ein Neustart.
 */
export async function releaseStaleGames(
  options: { maxAgeSeconds?: number; now?: Date } & XpEngineOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const maxAge = options.maxAgeSeconds ?? 3600;
  const cutoff = new Date(now.getTime() - maxAge * 1000);

  const stale = await prisma.levelGameMatch.findMany({
    where: {
      finishedAt: null,
      status: { in: ['PENDING', 'RUNNING'] },
      OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: cutoff } }],
    },
    take: 100,
  });

  for (const match of stale) {
    await closeGame(match.id, 'TIMEOUT', 'Zeit abgelaufen', options).catch(() => undefined);
  }

  return stale.length;
}
