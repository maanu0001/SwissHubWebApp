import { randomBytes, randomInt } from 'node:crypto';

/**
 * Die Ziehung.
 *
 * Der Gewinner entsteht ausschliesslich hier, auf dem Server. Das Rad im
 * Browser dreht sich zu einem Ergebnis, das zu diesem Zeitpunkt längst
 * feststeht - es bestimmt nichts.
 */

export interface WeightedTicket {
  entryId: string;
  discordId: string;
  weight: number;
}

export interface DrawSelection {
  winner: WeightedTicket;
  /** Der gezogene Punkt auf der Gewichtsachse, `0 <= ticket < totalWeight`. */
  ticket: number;
  totalWeight: number;
}

/**
 * Quelle für Zufall.
 *
 * Im Betrieb kryptographisch sicher. Tests reichen eine eigene Quelle herein,
 * damit sich eine Ziehung nachrechnen lässt, ohne dass der Test von echtem
 * Zufall abhängt und dadurch gelegentlich fehlschlägt.
 */
export interface RandomSource {
  /** Gleichverteilte Ganzzahl in `[0, maxExclusive)`. */
  integer(maxExclusive: number): number;
  /** Zufällige Bytes als Hex-Zeichenkette. */
  hex(bytes: number): string;
}

/**
 * `crypto.randomInt` verwirft Werte ausserhalb des grössten passenden
 * Vielfachen, statt mit Modulo zu rechnen. Damit ist jede Zahl gleich
 * wahrscheinlich - bei Modulo wären die kleinsten Zahlen bevorzugt.
 */
export const secureRandom: RandomSource = {
  integer: (maxExclusive: number) => randomInt(0, Math.max(1, Math.trunc(maxExclusive))),
  hex: (bytes: number) => randomBytes(bytes).toString('hex'),
};

/**
 * Zieht eine Teilnahme entsprechend ihrem Gewicht.
 *
 * Beim Festbetrag wiegt jede Teilnahme 1, alle haben also dieselbe Chance.
 * Beim Anteilsmodell wiegt eine Teilnahme so viel, wie sie gekostet hat - die
 * Chance entspricht damit dem Anteil am gesamten Einsatz.
 */
export function drawWeighted(
  tickets: readonly WeightedTicket[],
  random: RandomSource = secureRandom,
): DrawSelection | null {
  const eligible = tickets.filter((ticket) => ticket.weight > 0);
  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, ticket) => sum + ticket.weight, 0);
  const ticket = random.integer(totalWeight);

  let cursor = 0;
  for (const candidate of eligible) {
    cursor += candidate.weight;
    if (ticket < cursor) {
      return { winner: candidate, ticket, totalWeight };
    }
  }

  // Unerreichbar, solange die Summe stimmt - aber lieber ein definierter
  // Rückfall als ein `undefined` weiter oben im Ablauf.
  const last = eligible[eligible.length - 1]!;
  return { winner: last, ticket, totalWeight };
}
