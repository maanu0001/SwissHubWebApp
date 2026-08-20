/**
 * Inaktivitäts-Abzug ("Decay").
 *
 * Rechenweg unverändert aus `cogs/xp_system.py::apply_decay_if_needed`
 * übernommen: nach einer Schonfrist verliert ein Punktestand pro vollem Tag
 * XP, die ersten vier Tage stärker als die folgenden. Entscheidend ist, dass
 * gezählte Tage über `lastDecayAt` festgehalten werden - sonst würde derselbe
 * Tag bei jedem Durchlauf erneut abgezogen.
 */

export const SECONDS_PER_DAY = 86_400;

export interface DecayRules {
  /** Tage ohne Aktivität, bevor überhaupt abgezogen wird. */
  graceDays: number;
  /** Abzug an den ersten vier Abzugstagen. */
  day1To4: number;
  /** Abzug ab dem fünften Abzugstag. */
  day5Plus: number;
  /** Nur für Tests abweichend. */
  secondsPerDay?: number;
}

export const DEFAULT_DECAY_RULES: DecayRules = {
  graceDays: 7,
  day1To4: 50,
  day5Plus: 25,
};

export interface DecayInput {
  xp: number;
  /** Letzte Aktivität. `null` wird wie "gerade eben" behandelt. */
  lastActivityAt: Date | null;
  /** Bis hierhin wurde bereits abgezogen. `null` wie "gerade eben". */
  lastDecayAt: Date | null;
  now: Date;
}

export interface DecayResult {
  /** Tatsächlich abgezogene XP (nie mehr als vorhanden waren). */
  decayed: number;
  /** Rechnerischer Abzug vor der Klemmung auf den Punktestand. */
  requestedDecay: number;
  newXp: number;
  /** Neuer Stand von `lastDecayAt`, `null` = unverändert lassen. */
  newLastDecayAt: Date | null;
  /** Anzahl voller Tage, die dieser Lauf verrechnet hat. */
  days: number;
  /** Schonfrist läuft noch. */
  inGrace: boolean;
  /** Zeitpunkt, ab dem abgezogen wird. */
  decayStartsAt: Date;
}

const toSeconds = (value: Date): number => Math.floor(value.getTime() / 1000);

/**
 * Berechnet den fälligen Abzug, ohne etwas zu speichern.
 *
 * Die Aufteilung in eine reine Rechnung und das Schreiben in der Datenbank
 * macht das Verhalten prüfbar: `tests/level-decay.test.ts` vergleicht die
 * Ergebnisse mit denen des alten Bots.
 */
export function computeDecay(input: DecayInput, rules: DecayRules = DEFAULT_DECAY_RULES): DecayResult {
  const secondsPerDay = rules.secondsPerDay ?? SECONDS_PER_DAY;
  const now = toSeconds(input.now);
  const lastActivity = input.lastActivityAt ? toSeconds(input.lastActivityAt) : now;
  const lastDecay = input.lastDecayAt ? toSeconds(input.lastDecayAt) : now;
  const xp = Math.max(0, Math.trunc(input.xp));

  const decayStart = lastActivity + Math.trunc(rules.graceDays) * secondsPerDay;
  const decayStartsAt = new Date(decayStart * 1000);

  if (now < decayStart) {
    return {
      decayed: 0,
      requestedDecay: 0,
      newXp: xp,
      // Der Vorgänger zog `lastDecayAt` in der Schonfrist auf die letzte
      // Aktivität nach. Ohne das würden nach einer Rückkehr alte Tage erneut
      // gezählt.
      newLastDecayAt: lastDecay < lastActivity ? new Date(lastActivity * 1000) : null,
      days: 0,
      inGrace: true,
      decayStartsAt,
    };
  }

  const effectiveStart = Math.max(lastDecay, decayStart);
  const days = Math.floor((now - effectiveStart) / secondsPerDay);
  if (days <= 0) {
    return {
      decayed: 0,
      requestedDecay: 0,
      newXp: xp,
      newLastDecayAt: null,
      days: 0,
      inGrace: false,
      decayStartsAt,
    };
  }

  // Welcher Abzugstag steht als Erstes an? Tag 1 ist der erste Tag nach der
  // Schonfrist.
  const startDayIndex = Math.floor((effectiveStart - decayStart) / secondsPerDay) + 1;
  const lastDayIndex = startDayIndex + days - 1;
  const strongFrom = Math.max(startDayIndex, 1);
  const strongTo = Math.min(lastDayIndex, 4);
  const strongDays = Math.max(0, strongTo - strongFrom + 1);
  const remainingDays = days - strongDays;

  const requestedDecay =
    strongDays * Math.trunc(rules.day1To4) + remainingDays * Math.trunc(rules.day5Plus);
  const newXp = Math.max(0, xp - requestedDecay);

  return {
    decayed: xp - newXp,
    requestedDecay,
    newXp,
    newLastDecayAt: new Date((effectiveStart + days * secondsPerDay) * 1000),
    days,
    inGrace: false,
    decayStartsAt,
  };
}

/** Steckt eine Person gerade im Abzug? */
export function isInDecayPhase(
  lastActivityAt: Date | null,
  now: Date,
  rules: DecayRules = DEFAULT_DECAY_RULES,
): boolean {
  if (!lastActivityAt) {
    return false;
  }
  const secondsPerDay = rules.secondsPerDay ?? SECONDS_PER_DAY;
  return (
    toSeconds(now) >= toSeconds(lastActivityAt) + Math.trunc(rules.graceDays) * secondsPerDay
  );
}
