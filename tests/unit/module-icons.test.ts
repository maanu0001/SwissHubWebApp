import { describe, expect, it } from 'vitest';

/**
 * Jedes Modulsymbol muss es auch geben.
 *
 * Die Navigation nimmt einen Icon-Namen als Text entgegen und schlaegt ihn in
 * einer festen Liste nach - das ist Absicht, damit nur ein kleiner Teil der
 * Bibliothek im Bundle landet und ein Modul keine beliebige Komponente
 * einschleusen kann. Steht der Name nicht in der Liste, faellt die Anzeige
 * stillschweigend auf ein Ersatzsymbol zurueck: kein Fehler, keine Warnung,
 * nur ein Modul, das aussieht wie jedes andere.
 *
 * Genau das war beim Turniermodul monatelang der Fall.
 */
const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const QUELLE = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/nav-icon.tsx'), 'utf8');

/** Die Namen aus der Zuordnung `const ICONS: Record<string, LucideIcon> = { … }`. */
function bekannteSymbole(): Set<string> {
  const block = /const ICONS: Record<string, LucideIcon> = \{([\s\S]*?)\n\};/u.exec(QUELLE);
  if (!block) {
    throw new Error('Die Icon-Zuordnung wurde nicht gefunden.');
  }
  return new Set(
    (block[1] ?? '')
      .split(',')
      .map((eintrag) => eintrag.trim())
      .filter((eintrag) => /^[A-Z][A-Za-z0-9]*$/u.test(eintrag)),
  );
}

const SYMBOLE = bekannteSymbole();

const { listModuleDefinitions } = await import('@swisshub/modules');
const MODULE = listModuleDefinitions();

describe('Modulsymbole', () => {
  it('findet die Symbolliste und die Module', () => {
    expect(SYMBOLE.size).toBeGreaterThan(10);
    expect(MODULE.length).toBeGreaterThan(5);
  });

  it.each(MODULE.map((modul) => [modul.id, modul] as const))(
    '%s verwendet ein bekanntes Symbol',
    (_id, modul) => {
      expect(SYMBOLE.has(modul.icon), `${modul.id}: «${modul.icon}» fehlt in nav-icon.tsx`).toBe(true);
    },
  );

  it.each(
    MODULE.flatMap((modul) =>
      modul.navigation.map((eintrag) => [`${modul.id} → ${eintrag.href}`, eintrag] as const),
    ),
  )('%s verwendet ein bekanntes Symbol', (_label, eintrag) => {
    expect(SYMBOLE.has(eintrag.icon), `«${eintrag.icon}» fehlt in nav-icon.tsx`).toBe(true);
  });
});
