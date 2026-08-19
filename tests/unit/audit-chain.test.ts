import { describe, expect, it } from 'vitest';
import { computeAuditHash } from '@swisshub/database';

/**
 * Die Hash-Chain verknuepft jeden Audit-Eintrag mit seinem Vorgaenger.
 * Wird ein Eintrag nachtraeglich veraendert, passen die Folge-Hashes nicht mehr.
 */
describe('Audit Hash-Chain', () => {
  const payloadA = JSON.stringify(['2026-08-19T18:30:00.000Z', 'JAIL_CREATED', 'jail', 'actor', 'target', 1]);
  const payloadB = JSON.stringify([
    '2026-08-19T18:31:00.000Z',
    'JAIL_RELEASED',
    'jail',
    'actor',
    'target',
    1,
  ]);

  it('ist deterministisch', () => {
    expect(computeAuditHash(null, payloadA)).toBe(computeAuditHash(null, payloadA));
  });

  it('haengt vom Vorgaenger ab', () => {
    const first = computeAuditHash(null, payloadA);
    const second = computeAuditHash(first, payloadB);

    expect(second).not.toBe(computeAuditHash(null, payloadB));
    expect(second).toHaveLength(64);
  });

  it('erkennt manipulierte Inhalte', () => {
    const original = computeAuditHash(null, payloadA);
    const manipulated = computeAuditHash(null, payloadA.replace('JAIL_CREATED', 'LOGIN'));

    expect(manipulated).not.toBe(original);
  });

  it('erkennt eingefuegte oder entfernte Eintraege', () => {
    const first = computeAuditHash(null, payloadA);
    const second = computeAuditHash(first, payloadB);
    // Wird der erste Eintrag geloescht, ergibt sich fuer den zweiten ein anderer Hash.
    const withoutFirst = computeAuditHash(null, payloadB);

    expect(second).not.toBe(withoutFirst);
  });
});
