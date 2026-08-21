import { describe, expect, it } from 'vitest';
import { raffle } from '@swisshub/modules/level';

const { calculateEntryCost, winChance } = raffle;
type EntryCostRules = raffle.EntryCostRules;

/**
 * Was eine Teilnahme kostet und wie schwer sie wiegt.
 *
 * Diese Regeln bestimmen die Gewinnchance jeder teilnehmenden Person. Sie
 * stehen hier fest, damit eine spätere Änderung auffällt, statt still die
 * Chancen zu verschieben.
 */
const fixed = (xp: number): EntryCostRules => ({
  entryModel: 'FIXED',
  fixedEntryXp: xp,
  percentageBasisPoints: null,
  minimumEntryXp: null,
  maximumEntryXp: null,
});

const percentage = (
  percent: number,
  minimum: number | null = null,
  maximum: number | null = null,
): EntryCostRules => ({
  entryModel: 'PERCENTAGE',
  fixedEntryXp: null,
  percentageBasisPoints: percent * 100,
  minimumEntryXp: minimum,
  maximumEntryXp: maximum,
});

describe('Festbetrag', () => {
  it('kostet alle dasselbe, unabhängig vom Punktestand', () => {
    expect(calculateEntryCost(fixed(500), 12_450).entryXp).toBe(500);
    expect(calculateEntryCost(fixed(500), 999_999).entryXp).toBe(500);
    expect(calculateEntryCost(fixed(500), 500).entryXp).toBe(500);
  });

  it('wiegt bei allen gleich schwer', () => {
    // Das ist die Zusage des Modells: gleicher Einsatz, gleiche Chance.
    expect(calculateEntryCost(fixed(500), 20_000).weight).toBe(1);
    expect(calculateEntryCost(fixed(500), 600).weight).toBe(1);
  });

  it('verteilt die Chance gleichmässig', () => {
    const teilnehmende = 100;
    const gesamt = teilnehmende * 1;
    expect(winChance(1, gesamt)).toBeCloseTo(0.01, 10);
  });
});

describe('Anteilsmodell', () => {
  it('berechnet den Anteil am aktuellen Punktestand', () => {
    expect(calculateEntryCost(percentage(5), 20_000).entryXp).toBe(1000);
    expect(calculateEntryCost(percentage(5), 4000).entryXp).toBe(200);
  });

  it('rundet auf, damit kleine Anteile nicht gratis werden', () => {
    // 5 % von 1'001 sind 50,05 - abgerundet wären das 50, aufgerundet 51.
    expect(calculateEntryCost(percentage(5), 1001).entryXp).toBe(51);
    // Und ein winziger Anteil kostet mindestens ein XP statt null.
    expect(calculateEntryCost(percentage(1), 10).entryXp).toBe(1);
    expect(calculateEntryCost(percentage(5), 0).entryXp).toBe(1);
  });

  it('hebt auf den Mindesteinsatz an', () => {
    const cost = calculateEntryCost(percentage(5, 100), 1000);
    expect(cost.rawXp).toBe(50);
    expect(cost.entryXp).toBe(100);
    expect(cost.raisedToMinimum).toBe(true);
  });

  it('deckelt auf den Höchsteinsatz', () => {
    const cost = calculateEntryCost(percentage(5, null, 5000), 160_000);
    expect(cost.rawXp).toBe(8000);
    expect(cost.entryXp).toBe(5000);
    expect(cost.cappedToMaximum).toBe(true);
  });

  it('lässt den Höchsteinsatz auch einen angehobenen Betrag deckeln', () => {
    // Mindest- und Höchsteinsatz gleichzeitig: der Deckel gilt zuletzt.
    const cost = calculateEntryCost(percentage(1, 900, 500), 10_000);
    expect(cost.entryXp).toBe(500);
    expect(cost.cappedToMaximum).toBe(true);
    expect(cost.raisedToMinimum).toBe(false);
  });

  it('wiegt so schwer wie der bezahlte Einsatz', () => {
    const a = calculateEntryCost(percentage(5), 20_000);
    const b = calculateEntryCost(percentage(5), 10_000);
    expect(a.weight).toBe(1000);
    expect(b.weight).toBe(500);

    // Genau das Beispiel aus der Aufgabenstellung.
    const gesamt = a.weight + b.weight;
    expect(winChance(a.weight, gesamt)).toBeCloseTo(0.6667, 4);
    expect(winChance(b.weight, gesamt)).toBeCloseTo(0.3333, 4);
  });
});

describe('Gewinnchance', () => {
  it('ist null, solange niemand teilnimmt', () => {
    expect(winChance(0, 0)).toBe(0);
    expect(winChance(100, 0)).toBe(0);
  });

  it('ergibt zusammengezählt genau eins', () => {
    const gewichte = [1000, 500, 250, 250];
    const gesamt = gewichte.reduce((sum, weight) => sum + weight, 0);
    const summe = gewichte.reduce((sum, weight) => sum + winChance(weight, gesamt), 0);
    expect(summe).toBeCloseTo(1, 10);
  });
});
