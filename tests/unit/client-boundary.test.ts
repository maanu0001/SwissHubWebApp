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
