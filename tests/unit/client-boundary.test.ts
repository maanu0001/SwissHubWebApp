import { describe, expect, it } from 'vitest';

/**
 * Die Grenze zwischen Server und Browser.
 *
 * Was eine Client-Komponente als Wert importiert, landet im Browser-Bundle -
 * samt allem, was das importierte Modul seinerseits mitbringt. Ein einziger
 * Import aus `@swisshub/discord` hat auf diesem Weg das komplette
 * Umgebungs-Schema aus `@swisshub/config` in die ausgelieferten Dateien
 * gezogen: Namen und Validierungsregeln von `DISCORD_BOT_TOKEN`,
 * `AUTH_SECRET` und `DATABASE_URL`. Die Werte selbst waren nicht dabei - aber
 * dort gehört nichts davon hin.
 *
 * Erlaubt sind deshalb nur die ausdrücklich client-sicheren Einstiegspunkte.
 * Reine Typ-Importe (`import type`) bleiben ohne Bedeutung: TypeScript
 * entfernt sie beim Übersetzen vollständig.
 */
const { globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

/** Einstiegspunkte ohne Server-Abhängigkeiten. */
const CLIENT_SAFE = ['@swisshub/config/client', '@swisshub/discord/cdn', '@swisshub/shared'];

const CLIENT_FILES = globSync('apps/web/src/**/*.{ts,tsx}', { cwd: process.cwd() })
  .filter((file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    return /^\s*['"]use client['"]/m.test(source);
  })
  .sort();

/** Wert-Importe (keine Typ-Importe) aus `@swisshub/*`. */
function valueImports(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const specs: string[] = [];
  const pattern = /^import\s+(type\s+)?(?:[\w*{][^'"]*?\s+from\s+)?['"](@swisshub\/[^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) {
      continue; // `import type` - wird beim Übersetzen entfernt
    }
    if (match[2]) {
      specs.push(match[2]);
    }
  }
  return specs;
}

describe('Client-Bundle', () => {
  it('findet die Client-Komponenten', () => {
    expect(CLIENT_FILES.length).toBeGreaterThan(20);
  });

  it.each(CLIENT_FILES)('%s importiert nur client-sichere Pakete', (file) => {
    const verboten = valueImports(file).filter((spec) => !CLIENT_SAFE.includes(spec));
    expect(
      verboten,
      `${file}: ${verboten.join(', ')} zieht Server-Code ins Browser-Bundle. ` +
        `Erlaubt sind ${CLIENT_SAFE.join(', ')} - oder ein reiner Typ-Import.`,
    ).toEqual([]);
  });
});

/**
 * Server-Code ruft keine Funktion aus einer Client-Datei auf.
 *
 * Next.js macht aus jedem Export einer `'use client'`-Datei einen Verweis auf
 * das Browser-Bundle. Eine Komponente laesst sich damit rendern, eine
 * gewoehnliche Funktion aber nicht aufrufen: der Aufruf bricht zur Laufzeit
 * ab. Der Uebersetzer sieht das nicht, denn der Typ stimmt - und `next build`
 * auch nicht, weil die Seite erst beim Aufruf gerendert wird.
 *
 * Gemeint ist der Aufruf, nicht der Import: eine Konstante aus einer
 * Client-Datei an eine Client-Komponente weiterzureichen geht - Next gibt sie
 * ueber die Grenze weiter. Erst `name(...)` im Servercode bricht.
 *
 * Wer eine Funktion auf beiden Seiten braucht, legt sie in ein Modul ohne
 * `'use client'`.
 */
describe('Server-Dateien', () => {
  const CLIENT_MODULES = new Set(
    CLIENT_FILES.map((file) => file.replace(/\.tsx?$/u, '').replace(/\/index$/u, '')),
  );

  /** Aus welcher Datei kommt ein `@/`-Import? */
  function aufgeloest(spezifikator: string): string | null {
    if (!spezifikator.startsWith('@/')) {
      return null;
    }
    return `apps/web/src/${spezifikator.slice(2)}`;
  }

  const SERVER_FILES = globSync('apps/web/src/**/*.{ts,tsx}', { cwd: process.cwd() })
    .filter((file) => !/^\s*['"]use client['"]/m.test(readFileSync(join(process.cwd(), file), 'utf8')))
    .sort();

  it.each(SERVER_FILES.map((file) => [file, file] as const))(
    '%s ruft nichts aus einer Client-Datei auf',
    (_name, file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const muster = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](@\/[^'"]+)['"]/gm;
      let treffer: RegExpExecArray | null;

      while ((treffer = muster.exec(source)) !== null) {
        if (treffer[1]) {
          continue; // `import type` verschwindet beim Uebersetzen.
        }
        const ziel = aufgeloest(treffer[3] ?? '');
        if (!ziel || !CLIENT_MODULES.has(ziel)) {
          continue;
        }
        const namen = (treffer[2] ?? '')
          .split(',')
          .map((eintrag) => eintrag.trim())
          .filter((eintrag) => eintrag !== '' && !eintrag.startsWith('type '))
          .map((eintrag) => (eintrag.split(/\s+as\s+/u).pop() ?? '').trim())
          .filter((eintrag) => eintrag !== '');

        for (const name of namen) {
          // Nur der Aufruf ist das Problem. Weitergereicht wird eine
          // Konstante aus einer Client-Datei ohne Weiteres.
          const wirdAufgerufen = new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'u').test(source);
          expect(
            wirdAufgerufen,
            `${file}: ruft "${name}" auf - die Funktion kommt aus der Client-Datei ${ziel} und bricht zur Laufzeit ab`,
          ).toBe(false);
        }
      }
    },
  );
});
