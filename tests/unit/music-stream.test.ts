import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const QUELLE = readFileSync(join(process.cwd(), 'apps/web/src/app/api/music/stream/route.ts'), 'utf8');

/**
 * Der Live-Strom ist eine offene Verbindung mit Datenbankzugriff - genau die
 * Art Route, bei der eine vergessene Pruefung lange unbemerkt bleibt. Diese
 * Tests halten die Eigenschaften fest, die nicht verloren gehen duerfen.
 */
describe('Musik-Live-Strom', () => {
  it('prüft die Anmeldung, bevor irgendetwas gelesen wird', () => {
    const anmeldung = QUELLE.indexOf('getActionAuthContext');
    const datenzugriff = QUELLE.indexOf('getPlayerState');
    expect(anmeldung).toBeGreaterThan(-1);
    expect(anmeldung).toBeLessThan(datenzugriff);
  });

  it('prüft dieselbe Zugriffsregel wie jede Aktion', () => {
    // Eine eigene Regel hier wäre eine zweite Wahrheit - und die driftet.
    expect(QUELLE).toMatch(/darfSessionSteuern/u);
  });

  it('nimmt keine beliebige Kennung entgegen', () => {
    expect(QUELLE).toMatch(/sessionId.*400|400.*sessionId/su);
  });

  it('beendet lange Verbindungen, damit die Berechtigung neu geprüft wird', () => {
    // Ohne Höchstdauer wirkte eine einmal erteilte Berechtigung ewig nach:
    // wer die Rolle verliert, hörte weiter mit.
    expect(QUELLE).toMatch(/HOECHSTDAUER_MS/u);
    expect(QUELLE).toMatch(/neuverbinden/u);
  });

  it('sendet nur bei echter Änderung', () => {
    // Sonst schöbe der Strom sekündlich denselben Zustand über die Leitung.
    expect(QUELLE).toMatch(/fingerabdruck/u);
  });

  it('unterdrückt die Pufferung des Reverse-Proxys', () => {
    // Ohne diesen Kopf sammelt nginx die Ereignisse und liefert sie stossweise.
    expect(QUELLE).toMatch(/x-accel-buffering/u);
  });

  it('räumt die Verbindung in jedem Fall auf', () => {
    expect(QUELLE).toMatch(/request\.signal\.addEventListener\('abort'/u);
    expect(QUELLE).toMatch(/clearInterval/u);
  });
});
