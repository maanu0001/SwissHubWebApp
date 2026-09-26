import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Pruefungen des Abbilds bleiben Pruefungen.
 *
 * ## Worum es geht
 *
 * `next build` uebersetzt und prueft danach die Typen - im selben Prozess.
 * Auf dem Server ist der Heap auf 1536 MB begrenzt, und genau daran ist ein
 * Deployment gescheitert: «Ineffective mark-compacts near heap limit», nach
 * erfolgreicher Uebersetzung.
 *
 * Das Abbild setzt deshalb `SWISSHUB_SPLIT_BUILD_CHECKS=1` und fuehrt Lint
 * und die Typpruefung des Monorepos **vorher** aus, jede in einem eigenen
 * Prozess.
 *
 * Die Typpruefung der **WebApp** passte auch so nicht mehr: sie braucht
 * zwischen 1536 und 1700 MB, und daran ist ein zweites Deployment
 * gescheitert. Sie zog in die Pipeline.
 *
 * Mit «SwissHub fragt» ist die des **Monorepos** hinterhergezogen: sie
 * scheiterte an derselben Grenze im Bauschritt des Bots (Laeufe 77 und 78),
 * waehrend der Validierungsjob derselben Commits gruen war. Im Abbild laeuft
 * jetzt nur noch Lint; beide Typpruefungen laufen in der Pipeline, auf
 * demselben Commit, und der Deploy haengt mit `needs: validate` daran.
 *
 * ## Warum das ein Test ist
 *
 * Die Abmachung besteht aus zwei Teilen in zwei Dateien. Faellt der eine weg
 * - jemand raeumt die «doppelten» Schritte aus dem Dockerfile -, bleibt der
 * andere stehen, und das Abbild baut ab dann ohne jede Typpruefung. Das faellt
 * niemandem auf, bis ein Typfehler in Produktion landet.
 *
 * Deshalb steht hier: wer abschaltet, muss vorher geprueft haben.
 */
const lies = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${pfad}`, import.meta.url)), 'utf8');

const dockerfile = lies('Dockerfile');
const nextConfig = lies('apps/web/next.config.ts');
const workflow = lies('.github/workflows/deploy.yml');
const paket = JSON.parse(lies('package.json')) as { scripts: Record<string, string> };

describe('Pruefungen im Docker-Abbild', () => {
  it('schaltet die Pruefung in `next build` nur hinter einer Variablen ab', () => {
    /*
     * Ohne die Variable bleibt alles wie bisher - ein `npm run build` auf
     * einem Entwicklungsrechner prueft weiterhin selbst. Stuende
     * `ignoreBuildErrors: true` unbedingt da, waere es das Verstecken von
     * Fehlern und nicht ihr Verschieben.
     */
    expect(nextConfig).toContain("process.env.SWISSHUB_SPLIT_BUILD_CHECKS === '1'");
    expect(nextConfig).toMatch(
      /geteilteBuildPruefung\s*\n?\s*\?\s*\{\s*typescript:\s*\{\s*ignoreBuildErrors:\s*true/u,
    );
    // Nirgends bedingungslos.
    const unbedingt = /^\s*typescript:\s*\{\s*ignoreBuildErrors:\s*true/mu;
    expect(nextConfig).not.toMatch(unbedingt);
  });

  it('lintet im Abbild, bevor es die Pruefung im Build abschaltet', () => {
    const lintZeile = dockerfile.indexOf('RUN npm run lint');
    const variable = dockerfile.indexOf('ENV SWISSHUB_SPLIT_BUILD_CHECKS=1');
    const build = dockerfile.indexOf('RUN npm run build --workspace @swisshub/web');

    for (const [name, stelle] of Object.entries({ lintZeile, variable, build })) {
      expect(stelle, `${name} fehlt im Dockerfile`).toBeGreaterThan(-1);
    }

    // Reihenfolge: erst pruefen, dann abschalten, dann bauen.
    expect(lintZeile).toBeLessThan(variable);
    expect(variable).toBeLessThan(build);
  });

  it('laesst beide Typpruefungen aus dem Abbild heraus', () => {
    /*
     * In zwei Schritten dorthin gekommen, und beide waren dasselbe Scheitern.
     *
     * Die WebApp zuerst: sie braucht zwischen 1536 und 1700 MB und passte nicht
     * mehr unter die Grenze. Der Kommentar von damals sagte den Rest voraus -
     * «beim naechsten Modul stuenden wir wieder hier».
     *
     * Der naechste war «SwissHub fragt». Mit ihm scheiterte auch
     * `tsc -p tsconfig.json --noEmit` an «Ineffective mark-compacts near heap
     * limit» - im Bauschritt des Bots, Deploy-Laeufe 77 und 78. Der
     * Validierungsjob derselben Commits war gruen.
     *
     * Wer eine der beiden hier wieder einbaut, soll auf diese Zeilen stossen
     * und wissen, warum sie nicht da sind: nicht aus Nachlaessigkeit, sondern
     * weil ein Build, der auslagert, nicht scheitert - er steht.
     */
    expect(dockerfile).not.toContain('RUN npx tsc -p apps/web/tsconfig.json --noEmit');
    expect(dockerfile).not.toContain('RUN npx tsc -p tsconfig.json --noEmit');
  });

  it('prueft beide Projekte dafuer in der Pipeline - vor dem Deploy', () => {
    /*
     * Die Abmachung besteht jetzt aus drei Dateien. Faellt eine weg, ist die
     * Typpruefung still verschwunden - und zwar die des ganzen Projekts, denn
     * im Abbild steht seit Lauf 78 keine mehr:
     *
     *   - das Skript muss beide Projekte pruefen,
     *   - der Validierungsjob muss es aufrufen,
     *   - der Deploy-Job muss davon abhaengen.
     *
     * Deshalb stehen hier alle drei.
     */
    expect(paket.scripts.typecheck).toContain('tsc -p apps/web/tsconfig.json --noEmit');
    expect(paket.scripts.typecheck).toContain('tsc -p tsconfig.json --noEmit');

    expect(workflow).toMatch(/run:\s*npm run typecheck/u);

    // Der Deploy laeuft erst, wenn die Validierung gruen ist.
    const deployAb = workflow.indexOf('  deploy:');
    expect(deployAb).toBeGreaterThan(-1);
    expect(workflow.slice(deployAb, deployAb + 400)).toMatch(/needs:\s*validate/u);

    // Und die Validierung steht vor dem Deploy in derselben Datei.
    expect(workflow.indexOf('  validate:')).toBeLessThan(deployAb);
  });

  it('behaelt die Heap-Grenze - sie ist der Grund fuer die Aufteilung', () => {
    /*
     * Der Server hat 2 GB. Die Grenze einfach hochzusetzen hiesse, den Build
     * ins Auslagern zu schicken - und dann scheitert er nicht, er steht.
     */
    expect(dockerfile).toMatch(/ENV NODE_OPTIONS=--max-old-space-size=(\d+)/u);
    const treffer = /ENV NODE_OPTIONS=--max-old-space-size=(\d+)/u.exec(dockerfile);
    expect(Number(treffer?.[1])).toBeLessThanOrEqual(1536);
  });
});
