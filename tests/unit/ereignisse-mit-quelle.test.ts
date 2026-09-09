import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listEventDefinitions } from '@swisshub/automation';
import '@swisshub/modules';

/**
 * Jedes angemeldete Ereignis braucht eine Quelle.
 *
 * Ein Ereignis, das niemand auslöst, steht im Baukasten als Auswahlfeld -
 * jemand richtet eine Automation darauf ein, und sie läuft nie. Das ist
 * schlimmer als ein fehlendes Feld: ein fehlendes sieht man, ein stummes
 * sieht aus wie ein Server, auf dem nichts passiert.
 *
 * Genau so lagen fünf davon im System: `appeal.assigned`, `appeal.closed`,
 * `appeal.escalated`, `appeal.status_changed` und `automation.failed`. Alle
 * fünf waren angemeldet, beschrieben und wählbar - und keine einzige Stelle
 * hat sie je gemeldet.
 *
 * Dieser Test hält das fest. Er prüft nicht, ob ein Ereignis richtig
 * ausgelöst wird - das tun die Tests der jeweiligen Module. Er prüft, dass es
 * überhaupt irgendwo ausgelöst wird.
 */

/**
 * Dateien, in denen ein Ereignis ausgelöst werden kann.
 *
 * Ausgeschlossen sind die Anmeldedateien - dort steht jeder Typ ohnehin, und
 * zwar genau als Anmeldung. Erkannt werden sie am Inhalt (`registerEvent`)
 * und nicht am Namen: `moderation/events.ts` heisst genauso, meldet aber und
 * meldet nur. Am Namen zu filtern hat diesen Test beim ersten Lauf
 * fälschlich anschlagen lassen.
 */
const ALLE_DATEIEN = [
  ...globSync('packages/*/src/**/*.ts', { cwd: process.cwd() }),
  ...globSync('apps/*/src/**/*.ts', { cwd: process.cwd() }),
].filter((datei) => !datei.includes('node_modules'));

const QUELLDATEIEN = ALLE_DATEIEN.filter(
  (datei) => !readFileSync(join(process.cwd(), datei), 'utf8').includes('registerEvent({'),
);

const QUELLTEXT = QUELLDATEIEN.map((datei) => readFileSync(join(process.cwd(), datei), 'utf8')).join('\n');

/**
 * Ereignisse, die aus dem Baukasten selbst kommen.
 *
 * `automation.custom` wird von der Aktion «Internes Ereignis auslösen»
 * gemeldet - unter dem Typ, den jemand einträgt. Es hat damit eine Quelle,
 * nur keine mit fest eingebautem Namen.
 */
const AUS_DEM_BAUKASTEN = new Set(['automation.custom']);

describe('Angemeldete Ereignisse', () => {
  it('findet die Quelldateien', () => {
    expect(QUELLDATEIEN.length).toBeGreaterThan(100);
  });

  it('hat für jedes angemeldete Ereignis eine auslösende Stelle', () => {
    const ohneQuelle = listEventDefinitions()
      .map((definition) => definition.type)
      .filter((type) => !AUS_DEM_BAUKASTEN.has(type))
      .filter((type) => !QUELLTEXT.includes(`'${type}'`));

    expect(
      ohneQuelle,
      `Diese Ereignisse stehen im Baukasten zur Auswahl, werden aber nirgends gemeldet: ${ohneQuelle.join(', ')}`,
    ).toEqual([]);
  });

  it('meldet die fünf zuvor stummen Ereignisse', () => {
    // Ausdrücklich benannt: ein allgemeiner Test oben würde auch grün, wenn
    // jemand sie wieder entfernt und dabei die Anmeldung mitnimmt.
    for (const type of [
      'appeal.assigned',
      'appeal.closed',
      'appeal.escalated',
      'appeal.status_changed',
      'automation.failed',
    ]) {
      expect(QUELLTEXT.includes(`'${type}'`), type).toBe(true);
    }
  });

  it('kennt jedes gemeldete Ereignis auch in der Registry', () => {
    // Die Gegenrichtung: `publish` verwirft ein unbekanntes Ereignis mit
    // einer Warnung. Das Modul hätte es gemeldet, angekommen wäre nichts.
    const angemeldet = new Set(listEventDefinitions().map((definition) => definition.type));
    const gemeldet = new Set<string>();

    for (const datei of QUELLDATEIEN) {
      const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
      for (const treffer of quelle.matchAll(/meldeEreignis\(\s*'([a-z_]+\.[a-z_]+)'/gu)) {
        gemeldet.add(treffer[1]!);
      }
    }

    expect(gemeldet.size).toBeGreaterThan(10);
    const unbekannt = [...gemeldet].filter((type) => !angemeldet.has(type));
    expect(unbekannt, `Gemeldet, aber nicht angemeldet: ${unbekannt.join(', ')}`).toEqual([]);
  });
});
