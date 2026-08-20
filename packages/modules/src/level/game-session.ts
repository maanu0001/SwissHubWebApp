import { prisma, type LevelGameMatch } from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import {
  SSP_ROUNDS_TO_WIN,
  c4Drop,
  c4IsDraw,
  c4Winner,
  emptyC4Board,
  emptyTttBoard,
  sspRoundOutcome,
  tttIsDraw,
  tttWinner,
  type C4Board,
  type SspChoice,
  type TttBoard,
} from './game-rules';

/**
 * Spielstand laufender Partien.
 *
 * Jeder Zug läuft in einer Transaktion mit Zeilensperre. Das schliesst den
 * Fall aus, dass zwei schnelle Klicks denselben Spielstand lesen und
 * anschliessend beide darauf aufbauen - beim Vorgänger liess sich damit ein
 * Feld doppelt belegen.
 */

export interface SspState {
  kind: 'SSP';
  round: number;
  scores: Record<string, number>;
  /** Wahl der laufenden Runde, sobald beide da sind wird ausgewertet. */
  choices: Record<string, SspChoice>;
  /** Verlauf für die Anzeige. */
  history: Array<{ round: number; choices: Record<string, SspChoice>; winner: string | null }>;
}

export interface TttState {
  kind: 'TTT';
  board: TttBoard;
  turn: string;
  marks: Record<string, 'X' | 'O'>;
}

export interface C4State {
  kind: 'C4';
  board: C4Board;
  turn: string;
  pieces: Record<string, 1 | 2>;
}

export type GameState = SspState | TttState | C4State;

/** Startzustand einer Partie. Der Herausgeforderte beginnt - wie beim Vorgänger. */
export function initialState(match: LevelGameMatch): GameState | null {
  switch (match.kind) {
    case 'XP_SSP':
      return {
        kind: 'SSP',
        round: 1,
        scores: { [match.challengerDiscordId]: 0, [match.opponentDiscordId]: 0 },
        choices: {},
        history: [],
      };
    case 'XP_TTT':
      return {
        kind: 'TTT',
        board: emptyTttBoard(),
        turn: match.challengerDiscordId,
        marks: { [match.challengerDiscordId]: 'X', [match.opponentDiscordId]: 'O' },
      };
    case 'XP_4GEWINNT':
      return {
        kind: 'C4',
        board: emptyC4Board(),
        turn: match.challengerDiscordId,
        pieces: { [match.challengerDiscordId]: 1, [match.opponentDiscordId]: 2 },
      };
    default:
      // Das XP-Battle wird in einem Zug entschieden und braucht keinen Stand.
      return null;
  }
}

export interface MoveResult<TState extends GameState = GameState> {
  match: LevelGameMatch;
  state: TState;
  /** Partie beendet? */
  finished: boolean;
  winnerDiscordId: string | null;
  draw: boolean;
  /** Kurztext für die Anzeige, z.B. das Rundenergebnis. */
  detail?: string;
  /** Zug wurde entgegengenommen, aber es fehlt noch die Gegenseite. */
  waiting?: boolean;
}

/**
 * Führt einen Zug aus.
 *
 * Der Zustandsübergang passiert vollständig innerhalb der Transaktion; die
 * Abrechnung findet danach statt, damit sie nicht an einer Sperre hängt.
 */
async function withLockedMatch<T>(
  matchId: string,
  handler: (match: LevelGameMatch, state: GameState) => Promise<T> | T,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LevelGameMatch" WHERE "id" = ${matchId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw notFound('Spiel nicht gefunden', 'Das Spiel gits nümme.');
    }
    const match = await tx.levelGameMatch.findUniqueOrThrow({ where: { id: matchId } });
    if (match.status !== 'RUNNING') {
      throw conflict('Das Spiel laufe nümme.');
    }
    const state = match.state as GameState | null;
    if (!state) {
      throw conflict('Für das Spiel gits kein Spielstand.');
    }
    return handler(match, state);
  });
}

const other = (match: LevelGameMatch, discordId: string): string =>
  discordId === match.challengerDiscordId ? match.opponentDiscordId : match.challengerDiscordId;

/** Speichert den Startzustand einer angenommenen Partie. */
export async function startState(matchId: string): Promise<LevelGameMatch> {
  const match = await prisma.levelGameMatch.findUniqueOrThrow({ where: { id: matchId } });
  const state = initialState(match);
  if (!state) {
    return match;
  }
  return prisma.levelGameMatch.update({
    where: { id: matchId },
    data: { state: state as unknown as object },
  });
}

/** Eine Runde Schere-Stei-Papier. Gewertet wird, sobald beide gewählt haben. */
export async function playSsp(
  matchId: string,
  discordId: string,
  choice: SspChoice,
): Promise<MoveResult<SspState>> {
  return withLockedMatch(matchId, async (match, rawState) => {
    if (rawState.kind !== 'SSP') {
      throw conflict('Falschi Spielart.');
    }
    if (discordId !== match.challengerDiscordId && discordId !== match.opponentDiscordId) {
      throw conflict('Du spielsch da nid mit.');
    }
    const state: SspState = { ...rawState, choices: { ...rawState.choices }, scores: { ...rawState.scores } };
    if (state.choices[discordId]) {
      throw conflict('Du hesch die Rundi scho gwählt.');
    }

    state.choices[discordId] = choice;
    const opponent = other(match, discordId);

    if (!state.choices[opponent]) {
      const saved = await prisma.levelGameMatch.update({
        where: { id: matchId },
        data: { state: state as unknown as object },
      });
      return {
        match: saved,
        state,
        finished: false,
        winnerDiscordId: null,
        draw: false,
        waiting: true,
        detail: 'Wartet uf di anderi Wahl.',
      };
    }

    const mine = state.choices[discordId]!;
    const theirs = state.choices[opponent]!;
    const outcome = sspRoundOutcome(mine, theirs);
    const roundWinner = outcome === 0 ? null : outcome === 1 ? discordId : opponent;
    if (roundWinner) {
      state.scores[roundWinner] = (state.scores[roundWinner] ?? 0) + 1;
    }
    state.history.push({ round: state.round, choices: { ...state.choices }, winner: roundWinner });
    state.round += 1;
    state.choices = {};

    const challengerScore = state.scores[match.challengerDiscordId] ?? 0;
    const opponentScore = state.scores[match.opponentDiscordId] ?? 0;
    const winnerDiscordId =
      challengerScore >= SSP_ROUNDS_TO_WIN
        ? match.challengerDiscordId
        : opponentScore >= SSP_ROUNDS_TO_WIN
          ? match.opponentDiscordId
          : null;

    const saved = await prisma.levelGameMatch.update({
      where: { id: matchId },
      data: { state: state as unknown as object },
    });

    return {
      match: saved,
      state,
      finished: winnerDiscordId !== null,
      winnerDiscordId,
      draw: false,
      detail: roundWinner ? undefined : 'Die Rundi isch unentschide.',
    };
  });
}

export async function playTtt(
  matchId: string,
  discordId: string,
  cell: number,
): Promise<MoveResult<TttState>> {
  return withLockedMatch(matchId, async (match, rawState) => {
    if (rawState.kind !== 'TTT') {
      throw conflict('Falschi Spielart.');
    }
    if (rawState.turn !== discordId) {
      throw conflict('Du bisch nid am Zug.');
    }
    const board = [...rawState.board];
    if (board[cell] !== null) {
      throw conflict('Das Fäld isch scho bsetzt.');
    }

    board[cell] = rawState.marks[discordId] ?? 'X';
    const state: TttState = { ...rawState, board, turn: other(match, discordId) };

    const winner = tttWinner(board);
    const draw = tttIsDraw(board);
    const saved = await prisma.levelGameMatch.update({
      where: { id: matchId },
      data: { state: state as unknown as object },
    });

    return {
      match: saved,
      state,
      finished: winner !== null || draw,
      winnerDiscordId: winner ? discordId : null,
      draw,
    };
  });
}

export async function playC4(
  matchId: string,
  discordId: string,
  column: number,
): Promise<MoveResult<C4State>> {
  return withLockedMatch(matchId, async (match, rawState) => {
    if (rawState.kind !== 'C4') {
      throw conflict('Falschi Spielart.');
    }
    if (rawState.turn !== discordId) {
      throw conflict('Du bisch nid am Zug.');
    }
    const board = rawState.board.map((row) => [...row]) as C4Board;
    const piece = rawState.pieces[discordId] ?? 1;
    if (!c4Drop(board, column, piece)) {
      throw conflict('Die Spalte isch voll.');
    }

    const state: C4State = { ...rawState, board, turn: other(match, discordId) };
    const winner = c4Winner(board);
    const draw = c4IsDraw(board);
    const saved = await prisma.levelGameMatch.update({
      where: { id: matchId },
      data: { state: state as unknown as object },
    });

    return {
      match: saved,
      state,
      finished: winner !== null || draw,
      winnerDiscordId: winner ? discordId : null,
      draw,
    };
  });
}
