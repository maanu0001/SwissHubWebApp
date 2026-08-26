import { describe, expect, it } from 'vitest';
import { analytics } from '@swisshub/modules';

/**
 * Die Zeitrechnung der Statistik.
 *
 * Diese Datei prüft die zwei Tage im Jahr, an denen alles schiefgeht, wenn
 * man mit einer festen Stundenverschiebung rechnet: die Umstellung auf
 * Sommerzeit (ein 23-Stunden-Tag) und zurück (ein 25-Stunden-Tag). Wer sie
 * nicht prüft, merkt den Fehler erst im März - und dann sieht die Statistik
 * für einen Tag im Jahr einfach nur falsch aus, ohne dass etwas kaputtgeht.
 */

const { tagesSchluessel, tag, aufTageVerteilen, aufStundenVerteilen, zuercherTeile, zuercherMitternacht } =
  analytics;

describe('Statistik-Zeitrechnung', () => {
  it('rechnet einen Zeitpunkt in den Zürcher Kalendertag um', () => {
    // 22:30 UTC im Sommer ist in Zürich bereits der Folgetag (00:30 MESZ).
    expect(tagesSchluessel(new Date('2026-07-15T22:30:00.000Z'))).toBe('2026-07-16');
    // Im Winter ist 22:30 UTC noch derselbe Tag (23:30 MEZ).
    expect(tagesSchluessel(new Date('2026-01-15T22:30:00.000Z'))).toBe('2026-01-15');
  });

  it('liefert den Kalendertag als reines Datum um Mitternacht UTC', () => {
    // So speichert Prisma eine `@db.Date`-Spalte.
    expect(tag(new Date('2026-07-15T22:30:00.000Z')).toISOString()).toBe('2026-07-16T00:00:00.000Z');
  });

  it('findet Mitternacht im Sommer und im Winter', () => {
    // MESZ: UTC+2 -> Mitternacht Zürich ist 22:00 UTC des Vortags.
    expect(zuercherMitternacht('2026-07-16').toISOString()).toBe('2026-07-15T22:00:00.000Z');
    // MEZ: UTC+1 -> 23:00 UTC des Vortags.
    expect(zuercherMitternacht('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('behandelt den 23-Stunden-Tag der Sommerzeitumstellung', () => {
    // 29.03.2026: um 02:00 wird auf 03:00 vorgestellt.
    const von = zuercherMitternacht('2026-03-29');
    const bis = zuercherMitternacht('2026-03-30');
    const stunden = (bis.getTime() - von.getTime()) / 3600_000;

    expect(stunden).toBe(23);
  });

  it('behandelt den 25-Stunden-Tag der Rückstellung', () => {
    // 25.10.2026: um 03:00 wird auf 02:00 zurückgestellt.
    const von = zuercherMitternacht('2026-10-25');
    const bis = zuercherMitternacht('2026-10-26');

    expect((bis.getTime() - von.getTime()) / 3600_000).toBe(25);
  });

  it('verteilt eine Sitzung über Mitternacht auf beide Tage', () => {
    // 23:30 bis 01:30 Zürcher Zeit im Winter.
    const von = new Date('2026-01-15T22:30:00.000Z');
    const bis = new Date('2026-01-16T00:30:00.000Z');

    const eimer = aufTageVerteilen(von, bis);

    expect(eimer.map((e) => [e.schluessel, e.sekunden])).toEqual([
      ['2026-01-15', 1800],
      ['2026-01-16', 5400],
    ]);
    // Und nichts geht verloren.
    expect(eimer.reduce((summe, e) => summe + e.sekunden, 0)).toBe(7200);
  });

  it('verliert am Umstellungstag keine Sekunde', () => {
    // Eine Sitzung, die über die Rückstellung läuft: 01:00 bis 04:00 Zürcher
    // Zeit dauert an diesem Tag vier Stunden, nicht drei.
    const von = new Date('2026-10-24T23:00:00.000Z');
    const bis = new Date('2026-10-25T03:00:00.000Z');

    const eimer = aufTageVerteilen(von, bis);
    expect(eimer.reduce((summe, e) => summe + e.sekunden, 0)).toBe(4 * 3600);
  });

  it('verteilt eine Sitzung auf Stunden', () => {
    const von = new Date('2026-01-15T10:45:00.000Z');
    const bis = new Date('2026-01-15T12:15:00.000Z');

    const eimer = aufStundenVerteilen(von, bis);

    expect(eimer.map((e) => e.sekunden)).toEqual([900, 3600, 900]);
    expect(eimer[0]?.schluessel.toISOString()).toBe('2026-01-15T10:00:00.000Z');
    expect(eimer.reduce((summe, e) => summe + e.sekunden, 0)).toBe(5400);
  });

  it('gibt für eine leere oder rückwärts laufende Spanne nichts zurück', () => {
    const zeitpunkt = new Date('2026-01-15T10:00:00.000Z');
    expect(aufTageVerteilen(zeitpunkt, zeitpunkt)).toEqual([]);
    expect(aufStundenVerteilen(new Date('2026-01-15T11:00:00.000Z'), zeitpunkt)).toEqual([]);
  });

  it('bestimmt Wochentag und Stunde in Zürcher Zeit', () => {
    // 22:30 UTC am Samstag ist in Zürich Sonntag 00:30 (Sommerzeit).
    const teile = zuercherTeile(new Date('2026-07-18T22:30:00.000Z'));

    expect(teile.wochentag).toBe(0);
    expect(teile.stunde).toBe(0);
    expect(teile.tagImMonat).toBe(19);
  });
});
