/**
 * XP-Kurve des Level-Systems.
 *
 * Übernommen aus `core/levels.py` des alten Bots. Die Zahlen bestimmen jeden
 * angezeigten Levelstand und jede Meilenstein-Rolle - sie dürfen sich durch
 * die Migration nicht verschieben. `tests/level-curve.test.ts` hält sie fest.
 */

/** Kosten für den Aufstieg von Level 1 auf 2. */
const FIRST_LEVEL_COST = 420;

/** Jeder weitere Aufstieg kostet so viel mehr als der vorherige. */
const LEVEL_COST_STEP = 40;

/**
 * Anzahl Level, deren Schwelle aus der Formel entsteht. Das letzte Level
 * darüber (Level 31) hat beim Vorgänger einen festen Wert und folgt der
 * Formel bewusst nicht.
 */
const COMPUTED_LEVELS = 30;

/** Höchstes erreichbares Level. */
export const MAX_LEVEL = COMPUTED_LEVELS + 1;

/** XP-Schwelle für das Höchstlevel (`MAX_LEVEL_TOTAL_XP` der alten `.env`). */
export const DEFAULT_MAX_LEVEL_TOTAL_XP = 32_500;

/**
 * Gesamt-XP, die für jedes Level nötig sind. Index 0 entspricht Level 1.
 *
 * Der Vorgänger baute die Liste so auf, dass Level 1 bei 0 XP beginnt und
 * jeder Aufstieg `420 + 40 * (n - 1)` kostet.
 */
export function buildXpRequirements(
  maxLevelTotalXp: number = DEFAULT_MAX_LEVEL_TOTAL_XP,
): number[] {
  const requirements: number[] = [];
  let total = 0;
  for (let level = 1; level <= COMPUTED_LEVELS; level += 1) {
    requirements.push(total);
    total += FIRST_LEVEL_COST + LEVEL_COST_STEP * (level - 1);
  }
  requirements.push(Math.trunc(maxLevelTotalXp));
  return requirements;
}

/** Schwellen mit dem Standardwert für das Höchstlevel. */
export const XP_REQUIREMENTS: readonly number[] = Object.freeze(buildXpRequirements());

const requirementsFor = (maxLevelTotalXp?: number): readonly number[] =>
  maxLevelTotalXp === undefined || maxLevelTotalXp === DEFAULT_MAX_LEVEL_TOTAL_XP
    ? XP_REQUIREMENTS
    : buildXpRequirements(maxLevelTotalXp);

/** Level zu einem XP-Stand. Negative Werte zählen als 0. */
export function levelFromXp(xp: number, maxLevelTotalXp?: number): number {
  const value = Math.max(0, Math.trunc(xp));
  const requirements = requirementsFor(maxLevelTotalXp);
  let level = 1;
  for (let index = 0; index < requirements.length; index += 1) {
    if (value >= requirements[index]!) {
      level = index + 1;
    } else {
      break;
    }
  }
  return Math.min(level, MAX_LEVEL);
}

/** XP, ab denen dieses Level gilt. */
export function xpForLevel(level: number, maxLevelTotalXp?: number): number {
  const bounded = Math.max(1, Math.min(Math.trunc(level), MAX_LEVEL));
  return requirementsFor(maxLevelTotalXp)[bounded - 1]!;
}

/** XP, ab denen das nächste Level gilt. Im Höchstlevel dessen eigene Schwelle. */
export function nextLevelXp(level: number, maxLevelTotalXp?: number): number {
  const bounded = Math.max(1, Math.min(Math.trunc(level), MAX_LEVEL));
  const requirements = requirementsFor(maxLevelTotalXp);
  if (bounded >= MAX_LEVEL) {
    return requirements[MAX_LEVEL - 1]!;
  }
  return requirements[bounded]!;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP-Schwelle des aktuellen Levels. */
  currentLevelXp: number;
  /** XP-Schwelle des nächsten Levels. */
  nextLevelXp: number;
  /** Noch fehlende XP bis zum nächsten Level (im Höchstlevel 0). */
  remainingXp: number;
  /** Fortschritt im aktuellen Level, 0 bis 1. */
  progress: number;
  isMaxLevel: boolean;
}

/** Fortschritt innerhalb des aktuellen Levels - Grundlage der Levelkarte. */
export function levelProgress(xp: number, maxLevelTotalXp?: number): LevelProgress {
  const value = Math.max(0, Math.trunc(xp));
  const level = levelFromXp(value, maxLevelTotalXp);
  const currentLevelXp = xpForLevel(level, maxLevelTotalXp);
  const next = nextLevelXp(level, maxLevelTotalXp);
  const isMaxLevel = level >= MAX_LEVEL;
  if (isMaxLevel) {
    return {
      level,
      xp: value,
      currentLevelXp,
      nextLevelXp: next,
      remainingXp: 0,
      progress: 1,
      isMaxLevel: true,
    };
  }
  const span = Math.max(1, next - currentLevelXp);
  return {
    level,
    xp: value,
    currentLevelXp,
    nextLevelXp: next,
    remainingXp: Math.max(0, next - value),
    progress: Math.min(1, Math.max(0, (value - currentLevelXp) / span)),
    isMaxLevel: false,
  };
}
