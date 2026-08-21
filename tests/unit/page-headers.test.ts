import { describe, expect, it } from 'vitest';

/**
 * Ein primärer Seitentitel je Seite.
 *
 * Hintergrund: Der Titel einer Modulseite steht in der Module Registry und
 * wird von der Kopfzeile (`AppHeader`) als `<h1>` gerendert. Mehrere Seiten
 * haben denselben Titel zusätzlich als `PageHeader` wiederholt - auf
 * `/level` und `/spielersuche` stand die Überschrift dadurch zweimal
 * untereinander.
 *
 * Diese Prüfung arbeitet auf dem Quelltext statt auf gerendertem HTML: sie
 * deckt damit jede Seite ab, auch solche, die ohne Datenbank und Discord gar
 * nicht rendern würden.
 */
const { buildNavigation, listModuleDefinitions } = await import('@swisshub/modules');
const { readdirSync, readFileSync, statSync } = await import('node:fs');
const { join, relative, sep } = await import('node:path');

const APP_DIR = join(process.cwd(), 'apps/web/src/app/(app)');

/** Alle Seiten unterhalb der geschützten Routengruppe. */
function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return pageFiles(full);
    }
    return name === 'page.tsx' ? [full] : [];
  });
}

/** Dateipfad -> Route. Gruppenordner in Klammern zählen nicht mit. */
function routeOf(file: string): string {
  const segments = relative(APP_DIR, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith('('));
  return `/${segments.join('/')}`;
}

/** Sämtliche Navigationseinträge, unabhängig von Berechtigungen. */
const navigation = (() => {
  const permissions = listModuleDefinitions().flatMap((definition) =>
    definition.navigation.map((item) => item.permission),
  );
  const moduleIds = new Set(listModuleDefinitions().map((definition) => definition.id));
  return buildNavigation(permissions, moduleIds);
})();

const navByHref = new Map(navigation.map((entry) => [entry.href, entry]));
const pages = pageFiles(APP_DIR).sort();

describe('Seitentitel', () => {
  it('findet die Seiten der Anwendung', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it.each(pages.map((file) => [relative(APP_DIR, file), file] as const))(
    '%s trägt höchstens einen primären Header',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const headers = source.match(/<PageHeader\b/g)?.length ?? 0;
      expect(headers).toBeLessThanOrEqual(1);
    },
  );

  it.each(pages.map((file) => [relative(APP_DIR, file), file] as const))(
    '%s überlässt der Kopfzeile das <h1>',
    (_name, file) => {
      // Das einzige <h1> der Anwendung steht in `AppHeader`. Ein zweites auf
      // der Seite wäre sowohl doppelt als auch ein Fehler für Screenreader.
      expect(readFileSync(file, 'utf8')).not.toMatch(/<h1[\s>]/);
    },
  );

  it.each(
    pages
      .filter((file) => navByHref.has(routeOf(file)))
      .map((file) => [routeOf(file), file] as const),
  )('%s wiederholt den Titel aus der Navigation nicht', (route, file) => {
    const source = readFileSync(file, 'utf8');
    const entry = navByHref.get(route)!;

    // Für diese Route liefert die Kopfzeile bereits Titel und Beschreibung.
    expect(source, `${route}: Titel "${entry.label}" steht schon in der Kopfzeile`).not.toMatch(
      /<PageHeader\b/,
    );
  });
});
