import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECAY_RULES,
  MAX_LEVEL,
  SECONDS_PER_DAY,
  XP_REQUIREMENTS,
  buildXpRequirements,
  c4Drop,
  c4IsDraw,
  c4Winner,
  computeDecay,
  emptyC4Board,
  emptyTttBoard,
  levelFromXp,
  levelProgress,
  nextLevelXp,
  payoutFor,
  sspRoundOutcome,
  tttIsDraw,
  tttWinner,
  xpForLevel,
} from '@swisshub/modules/level';

/**
 * Diese Werte stammen aus dem alten Level-Bot und wurden dort ausgerechnet,
 * nicht aus der neuen Umsetzung abgeleitet. Wer sie ändert, ändert die
 * Levelstände echter Mitglieder - der Test soll das erzwingen, statt es
 * nebenbei geschehen zu lassen.
 */
const LEGACY_XP_REQUIREMENTS = [
  0, 420, 880, 1380, 1920, 2500, 3120, 3780, 4480, 5220, 6000, 6820, 7680, 8580, 9520, 10500, 11520, 12580,
  13680, 14820, 16000, 17220, 18480, 19780, 21120, 22500, 23920, 25380, 26880, 28420, 32500,
];

describe('XP-Kurve', () => {
  it('entspricht Schwelle für Schwelle dem alten Bot', () => {
    expect([...XP_REQUIREMENTS]).toEqual(LEGACY_XP_REQUIREMENTS);
  });

  it('kennt 31 Level', () => {
    expect(MAX_LEVEL).toBe(31);
    expect(XP_REQUIREMENTS).toHaveLength(31);
  });

  it('ordnet XP-Stände denselben Leveln zu wie der alte Bot', () => {
    const expected: Array<[number, number]> = [
      [0, 1],
      [1, 1],
      [419, 1],
      [420, 2],
      [421, 2],
      [879, 2],
      [880, 3],
      [1379, 3],
      [1380, 4],
      [5000, 9],
      [28419, 29],
      [28420, 30],
      [28421, 30],
      [32499, 30],
      [32500, 31],
      [32501, 31],
      [999999, 31],
    ];
    for (const [xp, level] of expected) {
      expect(levelFromXp(xp), `XP ${xp}`).toBe(level);
    }
  });

  it('behandelt negative XP wie null', () => {
    expect(levelFromXp(-5000)).toBe(1);
  });

  it('lässt zwischen Level 30 und 31 bewusst eine grössere Lücke', () => {
    // Der Vorgänger berechnete Level 2 bis 30 aus der Formel und setzte das
    // Höchstlevel danach auf einen festen Wert. Diese Unstetigkeit ist kein
    // Fehler, sondern gewolltes Verhalten.
    expect(xpForLevel(30)).toBe(28_420);
    expect(xpForLevel(31)).toBe(32_500);
    expect(xpForLevel(30) - xpForLevel(29)).toBe(1540);
    expect(xpForLevel(31) - xpForLevel(30)).toBe(4080);
  });

  it('liefert im Höchstlevel keine weitere Schwelle', () => {
    expect(nextLevelXp(31)).toBe(32_500);
    expect(nextLevelXp(30)).toBe(32_500);
    expect(nextLevelXp(1)).toBe(420);
  });

  it('klemmt Levelangaben ausserhalb des gültigen Bereichs', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-3)).toBe(0);
    expect(xpForLevel(99)).toBe(32_500);
  });

  it('berechnet den Fortschritt innerhalb eines Levels', () => {
    const progress = levelProgress(650);
    expect(progress.level).toBe(2);
    expect(progress.currentLevelXp).toBe(420);
    expect(progress.nextLevelXp).toBe(880);
    expect(progress.remainingXp).toBe(230);
    expect(progress.progress).toBeCloseTo(230 / 460, 10);
    expect(progress.isMaxLevel).toBe(false);
  });

  it('meldet im Höchstlevel vollen Fortschritt', () => {
    const progress = levelProgress(40_000);
    expect(progress.level).toBe(31);
    expect(progress.progress).toBe(1);
    expect(progress.remainingXp).toBe(0);
    expect(progress.isMaxLevel).toBe(true);
  });

  it('verschiebt nur das Höchstlevel, wenn dessen Schwelle angepasst wird', () => {
    const custom = buildXpRequirements(40_000);
    expect(custom.slice(0, 30)).toEqual(LEGACY_XP_REQUIREMENTS.slice(0, 30));
    expect(custom[30]).toBe(40_000);
    expect(levelFromXp(32_500, 40_000)).toBe(30);
  });
});

describe('Inaktivitäts-Abzug', () => {
  const base = new Date('2023-11-14T22:13:20.000Z');
  const at = (days: number): Date => new Date(base.getTime() + days * SECONDS_PER_DAY * 1000);

  const run = (xp: number, lastActivityDays: number, lastDecayDays: number, nowDays: number) =>
    computeDecay({
      xp,
      lastActivityAt: at(lastActivityDays),
      lastDecayAt: at(lastDecayDays),
      now: at(nowDays),
    });

  it('zieht während der Schonfrist nichts ab', () => {
    const result = run(5000, 0, 0, 6);
    expect(result.inGrace).toBe(true);
    expect(result.decayed).toBe(0);
    expect(result.newXp).toBe(5000);
  });

  it('beginnt erst nach sieben vollen Tagen', () => {
    expect(
      computeDecay({
        xp: 5000,
        lastActivityAt: base,
        lastDecayAt: base,
        now: new Date(base.getTime() + (7 * SECONDS_PER_DAY - 1) * 1000),
      }).decayed,
    ).toBe(0);
    expect(run(5000, 0, 0, 7).decayed).toBe(0);
    expect(run(5000, 0, 0, 8).decayed).toBe(50);
  });

  it('rechnet die ersten vier Tage stärker ab als die folgenden', () => {
    const expected: Array<[number, number, number]> = [
      // [Tage seit letzter Aktivität, abgezogene XP, verbleibende XP]
      [8, 50, 4950],
      [11, 200, 4800],
      [12, 225, 4775],
      [17, 350, 4650],
      [37, 850, 4150],
    ];
    for (const [nowDays, decayed, newXp] of expected) {
      const result = run(5000, 0, 0, nowDays);
      expect(result.decayed, `Tag ${nowDays}`).toBe(decayed);
      expect(result.newXp, `Tag ${nowDays}`).toBe(newXp);
    }
  });

  it('zählt bereits verrechnete Tage nicht erneut', () => {
    const result = run(5000, 0, 11, 13);
    expect(result.days).toBe(2);
    // Tag 5 und 6 des Abzugs, also zweimal der kleinere Satz.
    expect(result.decayed).toBe(50);
    expect(result.newLastDecayAt?.getTime()).toBe(at(13).getTime());
  });

  it('zieht nie mehr ab, als vorhanden ist', () => {
    const result = run(60, 0, 0, 10);
    expect(result.requestedDecay).toBe(150);
    expect(result.decayed).toBe(60);
    expect(result.newXp).toBe(0);
  });

  it('lässt einen leeren Punktestand leer', () => {
    const result = run(0, 0, 0, 40);
    expect(result.decayed).toBe(0);
    expect(result.newXp).toBe(0);
  });

  it('zieht den Abzugszeiger in der Schonfrist auf die letzte Aktivität nach', () => {
    // Sonst würden nach einer Rückkehr längst vergangene Tage erneut zählen.
    const result = computeDecay({
      xp: 5000,
      lastActivityAt: at(3),
      lastDecayAt: at(0),
      now: at(4),
    });
    expect(result.inGrace).toBe(true);
    expect(result.newLastDecayAt?.getTime()).toBe(at(3).getTime());
  });

  it('behandelt fehlende Zeitstempel als "gerade eben"', () => {
    const result = computeDecay({
      xp: 5000,
      lastActivityAt: null,
      lastDecayAt: null,
      now: at(100),
    });
    expect(result.decayed).toBe(0);
  });

  it('verwendet die konfigurierten Sätze', () => {
    const result = computeDecay(
      { xp: 5000, lastActivityAt: at(0), lastDecayAt: at(0), now: at(4) },
      { ...DEFAULT_DECAY_RULES, graceDays: 1, day1To4: 10, day5Plus: 1 },
    );
    expect(result.days).toBe(3);
    expect(result.decayed).toBe(30);
  });
});

describe('Auszahlung der XP-Spiele', () => {
  it('rundet wie der alte Bot ab', () => {
    const expected: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [2, 3],
      [7, 13],
      [10, 19],
      [11, 20],
      [13, 24],
      [19, 36],
      [99, 188],
      [100, 190],
      [101, 191],
      [333, 632],
      [1000, 1900],
      [12345, 23455],
    ];
    for (const [bet, payout] of expected) {
      expect(payoutFor(bet), `Einsatz ${bet}`).toBe(payout);
    }
  });

  it('lässt dem Gewinner weniger als beide Einsätze zusammen', () => {
    for (const bet of [10, 100, 1000, 5000]) {
      expect(payoutFor(bet)).toBeLessThan(bet * 2);
      expect(payoutFor(bet)).toBeGreaterThan(bet);
    }
  });
});

describe('Schere-Stei-Papier', () => {
  it('kennt die üblichen Regeln', () => {
    expect(sspRoundOutcome('rock', 'scissors')).toBe(1);
    expect(sspRoundOutcome('scissors', 'paper')).toBe(1);
    expect(sspRoundOutcome('paper', 'rock')).toBe(1);
    expect(sspRoundOutcome('scissors', 'rock')).toBe(-1);
    expect(sspRoundOutcome('paper', 'scissors')).toBe(-1);
    expect(sspRoundOutcome('rock', 'paper')).toBe(-1);
  });

  it('wertet gleiche Wahl als unentschieden', () => {
    for (const choice of ['rock', 'paper', 'scissors'] as const) {
      expect(sspRoundOutcome(choice, choice)).toBe(0);
    }
  });
});

describe('TicTacToe', () => {
  it('erkennt Reihen, Spalten und Diagonalen', () => {
    const row: Array<'X' | 'O' | null> = ['X', 'X', 'X', null, 'O', null, 'O', null, null];
    expect(tttWinner(row)?.mark).toBe('X');

    const column: Array<'X' | 'O' | null> = ['O', 'X', null, 'O', 'X', null, 'O', null, null];
    expect(tttWinner(column)?.mark).toBe('O');

    const diagonal: Array<'X' | 'O' | null> = ['X', 'O', null, 'O', 'X', null, null, null, 'X'];
    expect(tttWinner(diagonal)?.mark).toBe('X');
  });

  it('meldet ein volles Feld ohne Reihe als unentschieden', () => {
    const board: Array<'X' | 'O' | null> = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    expect(tttWinner(board)).toBeNull();
    expect(tttIsDraw(board)).toBe(true);
  });

  it('sieht ein leeres Feld weder als gewonnen noch als unentschieden', () => {
    const board = emptyTttBoard();
    expect(tttWinner(board)).toBeNull();
    expect(tttIsDraw(board)).toBe(false);
  });
});

describe('4 Gewinnt', () => {
  it('lässt Steine nach unten fallen', () => {
    const board = emptyC4Board();
    expect(c4Drop(board, 3, 1)).toEqual({ row: 5, column: 3 });
    expect(c4Drop(board, 3, 2)).toEqual({ row: 4, column: 3 });
  });

  it('meldet volle Spalten', () => {
    const board = emptyC4Board();
    for (let index = 0; index < 6; index += 1) {
      expect(c4Drop(board, 0, 1)).not.toBeNull();
    }
    expect(c4Drop(board, 0, 1)).toBeNull();
    expect(c4Drop(board, 7, 1)).toBeNull();
  });

  it('erkennt vier in einer Reihe', () => {
    const board = emptyC4Board();
    for (const column of [0, 1, 2, 3]) {
      c4Drop(board, column, 1);
    }
    expect(c4Winner(board)).toBe(1);
  });

  it('erkennt vier übereinander', () => {
    const board = emptyC4Board();
    for (let index = 0; index < 4; index += 1) {
      c4Drop(board, 2, 2);
    }
    expect(c4Winner(board)).toBe(2);
  });

  it('erkennt beide Diagonalen', () => {
    const rising = emptyC4Board();
    // Treppe aufbauen: Spalte n bekommt n Füllsteine, dann den eigenen Stein.
    for (let column = 0; column < 4; column += 1) {
      for (let filler = 0; filler < column; filler += 1) {
        c4Drop(rising, column, 2);
      }
      c4Drop(rising, column, 1);
    }
    expect(c4Winner(rising)).toBe(1);

    const falling = emptyC4Board();
    for (let column = 0; column < 4; column += 1) {
      for (let filler = 0; filler < 3 - column; filler += 1) {
        c4Drop(falling, column, 2);
      }
      c4Drop(falling, column, 1);
    }
    expect(c4Winner(falling)).toBe(1);
  });

  it('meldet ein volles Feld ohne Sieger als unentschieden', () => {
    const board = emptyC4Board();
    // Muster, das keine vier gleichen Steine in einer Linie ergibt.
    const pattern = [1, 1, 2, 2] as const;
    for (let column = 0; column < 7; column += 1) {
      for (let row = 0; row < 6; row += 1) {
        c4Drop(board, column, pattern[(row + column * 2) % 4]!);
      }
    }
    expect(c4Winner(board)).toBeNull();
    expect(c4IsDraw(board)).toBe(true);
  });
});
