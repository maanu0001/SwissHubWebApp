import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LEBENSZEICHEN_DATEI } from '../../apps/bot/src/jobs';

/**
 * Was die Deployment-Kette zusammenhaelt.
 *
 * Nach einem Deployment lief der Bot weiter auf dem alten Abbild: Compose
 * entscheidet selbst, ob ein Container ersetzt werden muss, und lag daneben.
 * Auffallen konnte das niemandem - ohne festen `image:`-Namen gibt es gar
 * nichts, womit sich das laufende Abbild mit dem eben gebauten vergleichen
 * liesse.
 *
 * Die Pipeline vergleicht jetzt genau das. Diese Pruefungen halten die
 * Voraussetzungen dafuer fest, denn jede einzelne davon faellt still aus:
 * ein fehlender `image:`-Name macht den Vergleich unmoeglich, ein
 * auseinandergelaufener Pfad des Lebenszeichens macht den Bot dauerhaft
 * krank, und ohne `SWISSHUB_TEST_DATABASE_URL` ueberspringen sich die
 * datenbankgestuetzten Tests selbst - gruen, ohne je gelaufen zu sein.
 */
const compose = readFileSync(join(process.cwd(), 'docker-compose.prod.yml'), 'utf8');
const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

/** Die Dienste des Produktions-Stacks samt ihrer eigenen Zeilen. */
function dienstBlock(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `Dienst ${name} fehlt in docker-compose.prod.yml`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const naechster = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/u);
  return naechster === -1 ? rest : rest.slice(0, naechster + 1);
}

/** Dienste, die die Pipeline baut - und deren Abbild sie danach vergleicht. */
const GEBAUT = ['migrate', 'web', 'bot', 'music-runtime'];

describe('Produktions-Compose', () => {
  it.each(GEBAUT)('gibt %s einen festen Abbildnamen', (dienst) => {
    const block = dienstBlock(dienst);
    expect(block, `${dienst} wird nicht gebaut`).toMatch(/^\s{4}build:$/mu);
    expect(
      block,
      `${dienst} hat keinen festen image:-Namen - die Pipeline kann nicht pruefen, ob der Container auf dem neuen Abbild laeuft`,
    ).toMatch(new RegExp(`^\\s{4}image: swisshub-${dienst}:latest$`, 'mu'));
  });

  it.each(['web', 'bot', 'music-runtime'])('gibt %s einen Gesundheitscheck', (dienst) => {
    expect(dienstBlock(dienst), `${dienst} hat keinen healthcheck - die Pipeline kann nur raten`).toMatch(
      /^\s{4}healthcheck:$/mu,
    );
  });

  it('prueft beim Bot dieselbe Datei, die der Bot schreibt', () => {
    // Laufen die beiden auseinander, findet der Check nie etwas Frisches und
    // der Bot gilt dauerhaft als krank - obwohl er tadellos arbeitet.
    expect(dienstBlock('bot')).toContain(LEBENSZEICHEN_DATEI);
  });

  it('laesst web, bot und music-runtime erst nach der Migration starten', () => {
    for (const dienst of ['web', 'bot', 'music-runtime']) {
      expect(dienstBlock(dienst), `${dienst} wartet nicht auf die Migration`).toContain(
        'service_completed_successfully',
      );
    }
  });
});

describe('Deployment-Workflow', () => {
  it('rollt nur nach bestandener Pruefung aus', () => {
    expect(workflow).toMatch(/^\s{4}needs: validate$/mu);
  });

  it.each([
    ['Lint', 'npm run lint'],
    ['Typecheck', 'npm run typecheck'],
    ['Tests', 'npm test'],
    ['Production-Build', 'npm run build'],
  ])('prueft %s vor dem Deployment', (_name, befehl) => {
    expect(workflow).toMatch(new RegExp(`^\\s+run: ${befehl.replace(/ /gu, ' ')}$`, 'mu'));
  });

  it('laesst die datenbankgestuetzten Tests nicht durchrutschen', () => {
    expect(workflow).toContain('SWISSHUB_TEST_DATABASE_URL:');
    expect(workflow).toContain('postgres:16-alpine');
  });

  it.each(GEBAUT.filter((dienst) => dienst !== 'migrate'))(
    'vergleicht nach dem Deployment das Abbild von %s',
    (dienst) => {
      expect(workflow).toMatch(new RegExp(`\\b${dienst}\\b`, 'u'));
    },
  );

  it('bricht bei Fehlern ab, statt einen kaputten Stand zu melden', () => {
    expect(workflow).toContain('set -euo pipefail');
    expect(workflow).toContain('script_stop: true');
    expect(workflow).toMatch(/^\s+exit 1$/mu);
  });
});
