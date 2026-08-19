import { describe, expect, it } from 'vitest';
import { issueCsrfToken, verifyCsrfToken } from '@swisshub/auth';
import { safeEqual } from '@swisshub/shared/crypto';

/**
 * Der CSRF-Token ist an die Session gebunden (HMAC mit AUTH_SECRET).
 * Ein fremder oder erfundener Token darf niemals akzeptiert werden.
 */
describe('CSRF-Schutz', () => {
  it('erzeugt für dieselbe Session denselben Token', () => {
    expect(issueCsrfToken('session-1')).toBe(issueCsrfToken('session-1'));
  });

  it('erzeugt für unterschiedliche Sessions unterschiedliche Token', () => {
    expect(issueCsrfToken('session-1')).not.toBe(issueCsrfToken('session-2'));
  });

  it('akzeptiert nur den passenden Token', () => {
    const token = issueCsrfToken('session-1');

    expect(verifyCsrfToken('session-1', token)).toBe(true);
    expect(verifyCsrfToken('session-2', token)).toBe(false);
    expect(verifyCsrfToken('session-1', 'gefälscht')).toBe(false);
    expect(verifyCsrfToken('session-1', null)).toBe(false);
    expect(verifyCsrfToken('session-1', '')).toBe(false);
  });

  it('vergleicht konstant und ohne Längenfehler', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
