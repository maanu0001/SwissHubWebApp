import { describe, expect, it } from 'vitest';
import {
  monatsBeginnIn,
  naechsterMonatsBeginnIn,
  naechsterTagesBeginnIn,
  ortszeitAlsUtc,
  tagesBeginnIn,
  tagesSchluesselIn,
  wochenBeginnIn,
} from '@swisshub/shared';

const Z = 'Europe/Zurich';

describe('Zeitzonen-Rechnung', () => {
  it('rechnet Winterzeit (UTC+1)', () => {
    expect(ortszeitAlsUtc(Z, 2026, 1, 15, 20, 0).toISOString()).toBe('2026-01-15T19:00:00.000Z');
  });

  it('rechnet Sommerzeit (UTC+2)', () => {
    expect(ortszeitAlsUtc(Z, 2026, 7, 15, 20, 0).toISOString()).toBe('2026-07-15T18:00:00.000Z');
  });

  it('trifft den Tag der Vorstellung (29.03.2026, 23 Stunden)', () => {
    // 02:00 -> 03:00. Der Tag beginnt noch in Winterzeit.
    expect(tagesBeginnIn(new Date('2026-03-29T12:00:00Z'), Z).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    const laenge =
      naechsterTagesBeginnIn(new Date('2026-03-29T12:00:00Z'), Z).getTime() -
      tagesBeginnIn(new Date('2026-03-29T12:00:00Z'), Z).getTime();
    expect(laenge / 3600_000).toBe(23);
  });

  it('trifft den Tag der Rueckstellung (25.10.2026, 25 Stunden)', () => {
    expect(tagesBeginnIn(new Date('2026-10-25T12:00:00Z'), Z).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    const laenge =
      naechsterTagesBeginnIn(new Date('2026-10-25T12:00:00Z'), Z).getTime() -
      tagesBeginnIn(new Date('2026-10-25T12:00:00Z'), Z).getTime();
    expect(laenge / 3600_000).toBe(25);
  });

  it('haelt den Tagesschluessel ueber die Umstellung', () => {
    // 00:30 Ortszeit am Umstellungstag - in UTC noch der Vortag.
    expect(tagesSchluesselIn(new Date('2026-03-28T23:30:00Z'), Z)).toBe('2026-03-29');
  });

  it('beginnt die Woche am Montag', () => {
    // 2026-09-04 ist ein Freitag.
    expect(wochenBeginnIn(new Date('2026-09-04T12:00:00Z'), Z).toISOString()).toBe(
      '2026-08-30T22:00:00.000Z',
    );
  });

  it('findet Monatsgrenzen ueber den Jahreswechsel', () => {
    expect(monatsBeginnIn(new Date('2026-12-20T12:00:00Z'), Z).toISOString()).toBe(
      '2026-11-30T23:00:00.000Z',
    );
    expect(naechsterMonatsBeginnIn(new Date('2026-12-20T12:00:00Z'), Z).toISOString()).toBe(
      '2026-12-31T23:00:00.000Z',
    );
  });

  it('rechnet auch in einer anderen Zone', () => {
    expect(ortszeitAlsUtc('UTC', 2026, 7, 15, 20, 0).toISOString()).toBe('2026-07-15T20:00:00.000Z');
    expect(ortszeitAlsUtc('America/New_York', 2026, 7, 15, 20, 0).toISOString()).toBe(
      '2026-07-16T00:00:00.000Z',
    );
  });
});
