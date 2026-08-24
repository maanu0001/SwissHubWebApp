import { describe, expect, it } from 'vitest';

/**
 * Die Zustaendigkeit muss zu der Sache passen, auf die eine Aktion wirkt.
 *
 * Eine Verwaltungsaktion prueft den Zugriff auf ein Turnier und arbeitet
 * danach an einer Sache darin - einem Match, einem Team, einem Abschnitt.
 * Kommen beide Kennungen getrennt aus dem Browser, muss die Aktion pruefen,
 * dass die Sache zu diesem Turnier gehoert. Sonst wird das eine Turnier
 * geprueft und das andere angefasst: wer irgendwo Turnierleitung ist, koennte
 * damit in jedem Turnier arbeiten.
 *
 * Der sichere Weg ist, die Turnierkennung aus der Sache selbst zu holen -
 * das tun die meisten Aktionen. Diese Pruefung faengt die uebrigen ab.
 */
const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const DATEI = 'apps/web/src/modules/tournaments/admin-actions.ts';
const QUELLE = readFileSync(join(process.cwd(), DATEI), 'utf8');

interface Aktion {
  name: string;
  schema: string;
  rumpf: string;
}

/** Alle `export const x = defineAction({...}, handler)` der Datei. */
function aktionen(): Aktion[] {
  const gefunden: Aktion[] = [];
  const muster = /^export const (\w+) = defineAction\(\n([\s\S]*?)^\);$/gm;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(QUELLE)) !== null) {
    const ganz = treffer[2] ?? '';
    // Alles bis zum Handler ist die Beschreibung, der Rest der Rumpf.
    const schnitt = ganz.indexOf('async ({');
    gefunden.push({
      name: treffer[1] ?? '',
      schema: schnitt === -1 ? ganz : ganz.slice(0, schnitt),
      rumpf: schnitt === -1 ? '' : ganz.slice(schnitt),
    });
  }
  return gefunden;
}

const AKTIONEN = aktionen();

/** Kennungen, die eine Sache innerhalb eines Turniers bezeichnen. */
const UNTERKENNUNGEN = ['stageId', 'matchId', 'teamId', 'registrationId', 'disputeId', 'prizeId'];

/**
 * Nimmt die Aktion eine Turnierkennung aus dem Browser entgegen?
 *
 * `turnierSchema` ist genau das in kurz - wer nur nach dem Wort sucht,
 * uebersieht jede Aktion, die es verwendet.
 */
function nimmtTurnierkennung(schema: string): boolean {
  return /\btournamentId\b/.test(schema) || /\bturnierSchema\b/.test(schema);
}

/** Enthaelt eine Unterkennung, also eine Sache innerhalb des Turniers? */
function nimmtUnterkennung(schema: string): boolean {
  return UNTERKENNUNGEN.some((kennung) => new RegExp(`\\b${kennung}\\b`).test(schema));
}

describe('Turnier-Verwaltungsaktionen', () => {
  it('findet die Aktionen', () => {
    expect(AKTIONEN.length).toBeGreaterThan(20);
  });

  const gefaehrdet = AKTIONEN.filter(
    (aktion) => nimmtTurnierkennung(aktion.schema) && nimmtUnterkennung(aktion.schema),
  );

  it('findet Aktionen, die beide Kennungen entgegennehmen', () => {
    expect(gefaehrdet.length).toBeGreaterThan(0);
  });

  it.each(gefaehrdet.map((aktion) => [aktion.name, aktion] as const))(
    '%s prüft, dass die Kennung zu diesem Turnier gehört',
    (_name, aktion) => {
      // Ein Vergleich der Turnierkennung der Sache mit der uebergebenen.
      const vergleich = /\.tournamentId\s*!==\s*input\.tournamentId/.test(aktion.rumpf);
      expect(
        vergleich,
        `${aktion.name}: nimmt Turnier- und Unterkennung getrennt entgegen, vergleicht sie aber nicht`,
      ).toBe(true);
    },
  );

  it.each(
    AKTIONEN.filter((aktion) => !nimmtTurnierkennung(aktion.schema) && nimmtUnterkennung(aktion.schema)).map(
      (aktion) => [aktion.name, aktion] as const,
    ),
  )('%s leitet die Zuständigkeit aus der Sache selbst ab', (_name, aktion) => {
    // Keine Turnierkennung im Schema: dann muss der Rumpf die Sache laden und
    // ihre Turnierkennung fuer die Pruefung verwenden - nicht eine aus dem
    // Browser, denn die gibt es hier gar nicht.
    const treffer = /ladeTurnierMitZugriff\(\s*ctx,\s*(\w+)\.tournamentId/.exec(aktion.rumpf);
    expect(treffer, `${aktion.name}: prüft keinen Turnierzugriff`).not.toBeNull();
    expect(
      treffer?.[1],
      `${aktion.name}: prüft gegen eine Kennung aus dem Browser statt gegen die der Sache`,
    ).not.toBe('input');
  });
});
