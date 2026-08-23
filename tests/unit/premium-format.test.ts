import { describe, expect, it } from 'vitest';
import { formatChf } from '@swisshub/shared';

/**
 * Geld wird in Rappen gerechnet und erst zur Anzeige formatiert.
 * Gleitkomma taucht dabei nirgends auf.
 */
describe('Geldbetraege', () => {
  it('schreibt volle Franken in Schweizer Schreibweise', () => {
    expect(formatChf(500)).toBe('CHF 5.–');
    expect(formatChf(800)).toBe('CHF 8.–');
    expect(formatChf(1000)).toBe('CHF 10.–');
  });

  it('schreibt Rappen aus', () => {
    expect(formatChf(550)).toBe('CHF 5.50');
    expect(formatChf(1005)).toBe('CHF 10.05');
  });

  it('gruppiert grosse Betraege mit dem Schweizer Trennzeichen', () => {
    expect(formatChf(1234500)).toBe('CHF 12’345.–');
  });

  it('kommt mit null und negativen Betraegen zurecht', () => {
    expect(formatChf(0)).toBe('CHF 0.–');
    expect(formatChf(-500)).toBe('-CHF 5.–');
  });
});
