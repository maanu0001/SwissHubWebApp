import { describe, expect, it } from 'vitest';

/**
 * Was im Abbild landet.
 *
 * Das Dockerfile installiert die Abhängigkeiten in einer eigenen Stufe und
 * reicht die fertigen Ordner an die nächste weiter. Kopiert es dabei einen
 * Ordner nicht mit, fehlt im fertigen Abbild ein Paket, das beim Bauen noch da
 * war - und der Fehler zeigt sich erst beim Start des Containers.
 *
 * Genau das ist mit `sharp` passiert: eine Versionsanhebung im Bot machte die
 * Anforderung unvereinbar mit der von Next. npm konnte das Paket daraufhin
 * nicht mehr in den gemeinsamen Ordner hochziehen und legte es unter
 * `apps/bot/node_modules` ab. Das Dockerfile reichte nur den Ordner im
 * Projektwurzelverzeichnis weiter, also fand der Bot `sharp` zur Laufzeit
 * nicht mehr und startete gar nicht erst. Die WebApp lief unbeeindruckt
 * weiter - im Dashboard stand nur «Bot offline».
 *
 * `npm ci --dry-run` hätte das nicht gezeigt: dort stimmten Lockfile und
 * `package.json` ja überein. Die Lücke lag zwischen den Docker-Stufen.
 */
const { readFileSync, readdirSync, existsSync } = await import('node:fs');
const { join } = await import('node:path');

const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
const lockfile = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')) as {
  packages: Record<string, unknown>;
};

/** Workspaces, unter denen npm Pakete abgelegt hat, statt sie hochzuziehen. */
const verschachtelt = [
  ...new Set(
    Object.keys(lockfile.packages)
      .filter((pfad) => /^(apps|packages)\/[^/]+\/node_modules\//u.test(pfad))
      .map((pfad) => pfad.split('/node_modules/')[0]!),
  ),
].sort();

/** Kopiert die Build-Stufe diesen Pfad aus der Abhängigkeitsstufe? */
function wirdKopiert(pfad: string): boolean {
  const muster = new RegExp(`^COPY --from=deps /app/${pfad}(/|\\s)`, 'mu');
  return muster.test(dockerfile);
}

describe('Docker-Abbild', () => {
  it('liest Dockerfile und Lockfile', () => {
    expect(dockerfile).toContain('FROM node:22-alpine AS bot');
    expect(Object.keys(lockfile.packages).length).toBeGreaterThan(100);
  });

  it('reicht die Abhängigkeiten der Workspaces weiter', () => {
    // Auch ohne aktuell verschachtelte Pakete müssen diese Zeilen stehen: sonst
    // bricht die nächste Versionsanhebung das Abbild wieder stillschweigend.
    expect(wirdKopiert('apps'), 'Dockerfile kopiert /app/apps nicht aus der deps-Stufe').toBe(true);
    expect(wirdKopiert('packages'), 'Dockerfile kopiert /app/packages nicht aus der deps-Stufe').toBe(
      true,
    );
    expect(wirdKopiert('node_modules')).toBe(true);
  });

  it.each(verschachtelt.length > 0 ? verschachtelt : ['(derzeit keiner)'])(
    'nimmt die eigenen node_modules von %s mit',
    (workspace) => {
      if (workspace === '(derzeit keiner)') {
        expect(verschachtelt).toEqual([]);
        return;
      }
      const bereich = workspace.split('/')[0]!;
      expect(
        wirdKopiert(bereich) || wirdKopiert(`${workspace}/node_modules`),
        `${workspace} hat eigene node_modules, das Dockerfile reicht sie aber nicht weiter`,
      ).toBe(true);
    },
  );

  /**
   * Jeder Workspace muss in der deps-Stufe stehen.
   *
   * `npm ci` legt die Verknuepfungen unter `node_modules/@swisshub/*` an. Fehlt
   * die `package.json` eines Workspaces zu diesem Zeitpunkt, entsteht seine
   * Verknuepfung nicht - und das Abbild kennt ein Paket nicht, das beim Bauen
   * noch da war. Genau so ist `packages/secrets` einmal durchgerutscht: die
   * Zeile fehlte, und niemand haette es bemerkt, ehe der Bot nicht startet.
   */
  it('kopiert die package.json jedes Workspaces in die deps-Stufe', () => {
    const wurzel = process.cwd();
    const workspaces = readdirSync(join(wurzel, 'packages'), { withFileTypes: true })
      .filter((eintrag) => eintrag.isDirectory())
      .map((eintrag) => `packages/${eintrag.name}`)
      .filter((pfad) => existsSync(join(wurzel, pfad, 'package.json')));

    expect(workspaces.length).toBeGreaterThan(5);

    for (const workspace of workspaces) {
      expect(
        dockerfile.includes(`COPY ${workspace}/package.json`),
        `Dockerfile kopiert ${workspace}/package.json nicht in die deps-Stufe`,
      ).toBe(true);
    }
  });

  it('stellt dem Bot die Pakete zur Verfügung, die er zur Laufzeit braucht', () => {
    for (const pfad of ['/app/node_modules', '/app/packages', '/app/apps/bot']) {
      // Zwischen `--from=builder` und dem Pfad steht noch `--chown`.
      const muster = new RegExp(`^COPY --from=builder [^\n]*${pfad}(/|\\s)`, 'mu');
      expect(muster.test(dockerfile), `Bot-Stufe kopiert ${pfad} nicht`).toBe(true);
    }
  });
});
