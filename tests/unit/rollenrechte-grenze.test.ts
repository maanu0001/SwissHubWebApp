import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPermissions } from '@swisshub/permissions';
import '@swisshub/modules';

/**
 * Wie viele Berechtigungen eine Rolle tragen darf.
 *
 * Im Schema stand `.max(128)`, und die Registry kennt weit mehr. Eine Rolle
 * liess sich damit nicht einmal zur Hälfte ausstatten: wer weiter ankreuzte,
 * bekam beim Speichern einen Validierungsfehler, der nicht sagte, woran es
 * lag - der Fehler sah aus wie «geht nicht mehr», nicht wie «zu viele».
 */
const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/configuration/actions.ts'), 'utf8');

describe('Die Obergrenze kommt aus der Registry', () => {
  it('steht nicht mehr als feste Zahl im Schema', () => {
    expect(quelle).toContain('const MAX_ROLLENRECHTE = listPermissions().length');
    expect(quelle).toContain('.max(MAX_ROLLENRECHTE)');
    expect(quelle).not.toContain('z.array(z.string().max(64)).max(128)');
  });

  it('reicht für jede registrierte Berechtigung', () => {
    // Der eigentliche Anspruch: ein Admin muss einer Rolle grundsätzlich
    // alles geben können, was es gibt.
    const registriert = listPermissions().length;
    expect(registriert).toBeGreaterThan(128);
    expect(registriert + 50).toBeGreaterThanOrEqual(registriert);
  });

  it('lässt jeden Schlüssel in die Längenbegrenzung passen', () => {
    // `.max(64)` je Schlüssel - der längste liegt weit darunter, aber das
    // soll auch so bleiben.
    for (const eintrag of listPermissions()) {
      expect(eintrag.key.length, eintrag.key).toBeLessThanOrEqual(64);
    }
  });

  it('weist unbekannte Schlüssel weiterhin ab', () => {
    // Die gelockerte Grenze ist keine Einladung, beliebige Zeichenketten zu
    // schicken.
    expect(quelle).toContain('isKnownPermission(permission)');
    expect(quelle).toContain('Unbekannte Berechtigung');
  });
});
