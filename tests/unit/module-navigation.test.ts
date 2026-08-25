import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  buildNavigation,
  groupNavigation,
  listModuleDefinitions,
  NAVIGATION_GROUPS,
} from '@swisshub/modules';
import { listPermissions } from '@swisshub/permissions';

/**
 * Ein Modul, das es gibt, muss man auch finden.
 *
 * Die Navigation entsteht aus der Module Registry, nicht aus einer gepflegten
 * Liste. Das ist richtig so - aber es hat eine unangenehme Seite: faellt ein
 * Eintrag durch eines der Raster, verschwindet er lautlos. Kein Fehler, keine
 * Warnung, nur ein Modul, das im Code vollstaendig vorhanden ist und in der
 * Seitenleiste nicht vorkommt.
 *
 * Vier Raster gibt es, und dieser Test haelt alle vier fest:
 *
 * 1. Die Route muss existieren - sonst fuehrt der Eintrag ins Leere.
 * 2. Die Berechtigung muss registriert sein. `buildNavigation` zeigt nur, was
 *    der Betrachter darf, und die Vorlage «Administrator» loest `*` gegen die
 *    *bekannten* Berechtigungen auf. Ein Tippfehler hier ist ein Eintrag, den
 *    niemand je zu sehen bekommt - auch der Administrator nicht.
 * 3. Die Gruppe muss es geben, sonst filtert `groupNavigation` sie weg.
 * 4. Am Ende muss der Eintrag tatsaechlich in der gruppierten Navigation
 *    ankommen - die Probe aufs Exempel statt auf die Einzelteile.
 */

const WURZEL = process.cwd();
const APP = join(WURZEL, 'apps/web/src/app');

/**
 * Alle Routen der WebApp, aus dem Dateisystem gelesen.
 *
 * Klammersegmente wie `(app)` sind Gruppierungen und tauchen in der Adresse
 * nicht auf; `@slot`-Segmente ebenso wenig.
 */
function vorhandeneRouten(verzeichnis = APP, gefunden = new Set<string>()): Set<string> {
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) {
      vorhandeneRouten(pfad, gefunden);
      continue;
    }
    if (eintrag !== 'page.tsx' && eintrag !== 'page.ts') {
      continue;
    }
    const segmente = relative(APP, verzeichnis)
      .split(sep)
      .filter((teil) => teil !== '' && !teil.startsWith('(') && !teil.startsWith('@'));
    gefunden.add(`/${segmente.join('/')}`);
  }
  return gefunden;
}

const ROUTEN = vorhandeneRouten();
const MODULE = listModuleDefinitions();
const RECHTE = new Set(listPermissions().map((eintrag) => eintrag.key));
const GRUPPEN = new Set(NAVIGATION_GROUPS.map((gruppe) => gruppe.id));

const EINTRAEGE = MODULE.flatMap((modul) =>
  modul.navigation.map((eintrag) => [`${modul.id} → ${eintrag.href}`, modul, eintrag] as const),
);

describe('Modulnavigation', () => {
  it('findet Routen, Module und Berechtigungen', () => {
    expect(ROUTEN.size).toBeGreaterThan(20);
    expect(MODULE.length).toBeGreaterThan(5);
    expect(RECHTE.size).toBeGreaterThan(50);
    expect(EINTRAEGE.length).toBeGreaterThan(10);
  });

  it.each(EINTRAEGE)('%s führt auf eine vorhandene Seite', (_label, _modul, eintrag) => {
    expect(ROUTEN.has(eintrag.href), `Keine Seite unter «${eintrag.href}»`).toBe(true);
  });

  it.each(EINTRAEGE)('%s verlangt eine registrierte Berechtigung', (_label, modul, eintrag) => {
    expect(
      RECHTE.has(eintrag.permission),
      `«${eintrag.permission}» ist nicht registriert - der Eintrag bliebe für alle unsichtbar, ` +
        `auch für Administratoren. Fehlt sie in den Berechtigungen von ${modul.id}?`,
    ).toBe(true);
  });

  it.each(EINTRAEGE)('%s liegt in einer bekannten Gruppe', (_label, _modul, eintrag) => {
    expect(GRUPPEN.has(eintrag.group), `Gruppe «${eintrag.group}» gibt es nicht`).toBe(true);
  });

  it('zeigt jedes eingeschaltete Modul in der gruppierten Navigation', () => {
    const alleRechte = [...RECHTE];
    const alleModule = new Set(MODULE.map((modul) => modul.id));
    const sichtbar = new Set(
      groupNavigation(buildNavigation(alleRechte, alleModule))
        .flatMap((gruppe) => gruppe.items)
        .map((eintrag) => eintrag.href),
    );

    for (const [label, , eintrag] of EINTRAEGE) {
      expect(sichtbar.has(eintrag.href), `${label} kommt in der Seitenleiste nicht an`).toBe(true);
    }
  });

  it('führt den Voice Hub mit eigener Seite in den Modulen', () => {
    // Das zuletzt hinzugekommene Modul - stellvertretend festgehalten, weil es
    // der Anlass fuer diesen Test war.
    const voice = MODULE.find((modul) => modul.id === 'voiceHub');
    expect(voice, 'Das Voice-Hub-Modul ist nicht registriert').toBeDefined();

    const eintrag = voice?.navigation.at(0);
    expect(eintrag?.href).toBe('/voice');
    expect(eintrag?.group).toBe('modules');
    expect(ROUTEN.has('/voice')).toBe(true);
  });
});
