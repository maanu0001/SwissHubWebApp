/**
 * Spielregeln der XP-Spiele - ohne Datenbank und ohne Discord.
 *
 * Einsatz, Auszahlung und Siegbedingungen stammen unverändert aus
 * `cogs/games.py`. Weil daran echtes Guthaben hängt, liegt die Rechnung hier
 * getrennt vom Rest und wird in `tests/level-games.test.ts` geprüft.
 */

/** Vom Einsatz beider Seiten bleiben 95 Prozent - der Rest verfällt. */
export const DEFAULT_PAYOUT_FACTOR = 0.95;

export const GAME_KINDS = ['XP_BATTLE', 'XP_SSP', 'XP_TTT', 'XP_4GEWINNT'] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export const GAME_LABELS: Record<GameKind, string> = {
  XP_BATTLE: 'XP-Battle',
  XP_SSP: 'Schere-Stei-Papier',
  XP_TTT: 'TicTacToe',
  XP_4GEWINNT: '4 Gewinnt',
};

/** Slash-Command-Name des jeweiligen Spiels. */
export const GAME_COMMANDS: Record<GameKind, string> = {
  XP_BATTLE: 'xp_battle',
  XP_SSP: 'xp_ssp',
  XP_TTT: 'xp_ttt',
  XP_4GEWINNT: 'xp_4gewinnt',
};

/** Zeitfenster in Sekunden, wie beim Vorgänger. */
export const DEFAULT_GAME_TIMEOUTS: Record<GameKind, number> = {
  XP_BATTLE: 30,
  XP_SSP: 180,
  XP_TTT: 90,
  XP_4GEWINNT: 120,
};

/**
 * Auszahlung an den Gewinner.
 *
 * Bewusst dieselbe Fliesskomma-Rechnung mit anschliessendem Abschneiden wie
 * `int((bet * 2) * PAYOUT_FACTOR)`, damit sich keine Auszahlung um einen
 * Punkt verschiebt.
 */
export function payoutFor(bet: number, factor: number = DEFAULT_PAYOUT_FACTOR): number {
  const stake = Math.max(0, Math.trunc(bet));
  return Math.trunc(stake * 2 * factor);
}

// ---------------------------------------------------------------------------
// Schere-Stei-Papier
// ---------------------------------------------------------------------------

export const SSP_CHOICES = ['rock', 'paper', 'scissors'] as const;
export type SspChoice = (typeof SSP_CHOICES)[number];

export const SSP_LABELS: Record<SspChoice, string> = {
  rock: 'Stei',
  paper: 'Papier',
  scissors: 'Schere',
};

/** Runden bis zum Sieg ("first to 2"). */
export const SSP_ROUNDS_TO_WIN = 2;

/** `1` = erste Wahl gewinnt, `-1` = zweite, `0` = unentschieden. */
export function sspRoundOutcome(first: SspChoice, second: SspChoice): -1 | 0 | 1 {
  if (first === second) {
    return 0;
  }
  const beats: Record<SspChoice, SspChoice> = {
    rock: 'scissors',
    scissors: 'paper',
    paper: 'rock',
  };
  return beats[first] === second ? 1 : -1;
}

// ---------------------------------------------------------------------------
// TicTacToe
// ---------------------------------------------------------------------------

/** Spielfeld als 9 Felder: `null` = leer. */
export type TttCell = 'X' | 'O' | null;
export type TttBoard = TttCell[];

const TTT_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const emptyTttBoard = (): TttBoard => Array.from({ length: 9 }, () => null);

export function tttWinner(board: TttBoard): { mark: 'X' | 'O'; line: readonly number[] } | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) {
      return { mark, line };
    }
  }
  return null;
}

export const tttIsDraw = (board: TttBoard): boolean =>
  board.every((cell) => cell !== null) && tttWinner(board) === null;

// ---------------------------------------------------------------------------
// 4 Gewinnt
// ---------------------------------------------------------------------------

export const C4_ROWS = 6;
export const C4_COLS = 7;

/** Spielfeld von oben nach unten: `0` = leer, sonst `1` oder `2`. */
export type C4Piece = 0 | 1 | 2;
export type C4Board = C4Piece[][];

export const emptyC4Board = (): C4Board =>
  Array.from({ length: C4_ROWS }, () => Array.from({ length: C4_COLS }, () => 0 as C4Piece));

/** Spalten, in die noch ein Stein passt. */
export const c4AvailableColumns = (board: C4Board): number[] =>
  Array.from({ length: C4_COLS }, (_unused, column) => column).filter((column) => board[0]![column] === 0);

/**
 * Wirft einen Stein in eine Spalte. Gibt die belegte Zelle zurück oder `null`,
 * wenn die Spalte voll ist. Verändert das übergebene Feld.
 */
export function c4Drop(board: C4Board, column: number, piece: 1 | 2): { row: number; column: number } | null {
  if (column < 0 || column >= C4_COLS) {
    return null;
  }
  for (let row = C4_ROWS - 1; row >= 0; row -= 1) {
    if (board[row]![column] === 0) {
      board[row]![column] = piece;
      return { row, column };
    }
  }
  return null;
}

export function c4Winner(board: C4Board): 1 | 2 | null {
  for (let row = 0; row < C4_ROWS; row += 1) {
    for (let column = 0; column < C4_COLS; column += 1) {
      const piece = board[row]![column]!;
      if (piece === 0) {
        continue;
      }
      const runs: Array<Array<[number, number]>> = [];
      if (column + 3 < C4_COLS) {
        runs.push([0, 1, 2, 3].map((offset) => [row, column + offset]));
      }
      if (row + 3 < C4_ROWS) {
        runs.push([0, 1, 2, 3].map((offset) => [row + offset, column]));
      }
      if (row + 3 < C4_ROWS && column + 3 < C4_COLS) {
        runs.push([0, 1, 2, 3].map((offset) => [row + offset, column + offset]));
      }
      if (row + 3 < C4_ROWS && column - 3 >= 0) {
        runs.push([0, 1, 2, 3].map((offset) => [row + offset, column - offset]));
      }
      for (const run of runs) {
        if (run.every(([r, c]) => board[r]![c] === piece)) {
          return piece;
        }
      }
    }
  }
  return null;
}

export const c4IsDraw = (board: C4Board): boolean =>
  c4AvailableColumns(board).length === 0 && c4Winner(board) === null;
