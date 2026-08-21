import type { XpRaffleEntryModel } from '@swisshub/database';

/**
 * Was eine Teilnahme kostet.
 *
 * Die Berechnung steht bewusst an genau einer Stelle: Dashboard, Webseite und
 * der Knopf auf Discord zeigen und verlangen denselben Betrag. Der Browser
 * rechnet nie selbst - er zeigt nur an, was hier herauskommt.
 */

/** Anteil in Basispunkten: 500 = 5,00 %. */
export const PERCENTAGE_SCALE = 10_000;

export interface EntryCostRules {
  entryModel: XpRaffleEntryModel;
  fixedEntryXp: number | null;
  percentageBasisPoints: number | null;
  minimumEntryXp: number | null;
  maximumEntryXp: number | null;
}

export interface EntryCost {
  /** Tatsächlich zu zahlender Einsatz. */
  entryXp: number;
  /** Gewicht in der Ziehung. */
  weight: number;
  /** Rohbetrag vor Mindest- und Höchsteinsatz - für die Erklärung in der Oberfläche. */
  rawXp: number;
  /** Der Mindesteinsatz hat den Betrag angehoben. */
  raisedToMinimum: boolean;
  /** Der Höchsteinsatz hat den Betrag gedeckelt. */
  cappedToMaximum: boolean;
}

/**
 * Runden: immer aufwärts.
 *
 * Bei kleinen Punkteständen ergäbe ein Anteil sonst 0 XP, und eine Teilnahme
 * ohne Einsatz hätte im gewichteten Modell auch keine Gewinnchance. Aufrunden
 * kostet höchstens ein XP mehr und hält jede Teilnahme wirksam.
 */
const roundEntry = (value: number): number => Math.ceil(value - 1e-9);

/**
 * Berechnet den Einsatz für einen XP-Stand.
 *
 * Reihenfolge wie dokumentiert: Rohbetrag aufrunden, dann Mindesteinsatz,
 * dann Höchsteinsatz. Der Höchsteinsatz steht zuletzt, damit er auch einen
 * durch den Mindesteinsatz angehobenen Betrag noch deckelt.
 */
export function calculateEntryCost(rules: EntryCostRules, currentXp: number): EntryCost {
  const xp = Math.max(0, Math.trunc(currentXp));

  if (rules.entryModel === 'FIXED') {
    // Beim Festbetrag zahlen alle dasselbe und wiegen deshalb gleich schwer.
    // Mindest- und Höchsteinsatz ergeben hier keinen Sinn und bleiben aussen vor.
    const entryXp = Math.max(0, Math.trunc(rules.fixedEntryXp ?? 0));
    return {
      entryXp,
      weight: 1,
      rawXp: entryXp,
      raisedToMinimum: false,
      cappedToMaximum: false,
    };
  }

  const basisPoints = Math.max(0, Math.trunc(rules.percentageBasisPoints ?? 0));
  const rawXp = roundEntry((xp * basisPoints) / PERCENTAGE_SCALE);

  // Eine Teilnahme ohne Einsatz hätte im gewichteten Modell keine Chance.
  let entryXp = Math.max(1, rawXp);
  let raisedToMinimum = false;
  let cappedToMaximum = false;

  const minimum = rules.minimumEntryXp;
  if (minimum !== null && minimum > 0 && entryXp < minimum) {
    entryXp = Math.trunc(minimum);
    raisedToMinimum = true;
  }

  const maximum = rules.maximumEntryXp;
  if (maximum !== null && maximum > 0 && entryXp > maximum) {
    entryXp = Math.trunc(maximum);
    cappedToMaximum = true;
    raisedToMinimum = false;
  }

  return { entryXp, weight: entryXp, rawXp, raisedToMinimum, cappedToMaximum };
}

/**
 * Gewinnchance einer Teilnahme.
 *
 * `0`, solange niemand teilnimmt. Der Wert ist ein Anteil zwischen 0 und 1;
 * die Formatierung als Prozentzahl passiert erst in der Oberfläche.
 */
export function winChance(weight: number, totalWeight: number): number {
  if (totalWeight <= 0 || weight <= 0) {
    return 0;
  }
  return weight / totalWeight;
}

/** Prozentwert für die Anzeige, auf zwei Nachkommastellen. */
export const formatChance = (chance: number): string =>
  `${(chance * 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
