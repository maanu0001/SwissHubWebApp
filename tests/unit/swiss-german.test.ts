import { describe, expect, it } from 'vitest';

/**
 * Schweizer Standarddeutsch.
 *
 * SwissHub ist ein Schweizer Server: in deutschen Texten steht "ss" statt "ß".
 * Das betrifft nicht nur die Oberfläche, sondern auch alles, was der Bot nach
 * Discord schreibt - Embeds, Meldungen und Fehlertexte.
 */
const { globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const FILES = globSync(
  ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}', 'docs/**/*.md', 'README.md'],
  { cwd: process.cwd(), exclude: (p) => p.includes('node_modules') || p.includes('.next') },
).sort();

describe('Schreibweise', () => {
  it('erfasst die Quelldateien', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('verwendet nirgends ein ß', () => {
    const treffer: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (line.includes('ß')) {
          treffer.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(treffer, `ß gefunden - in der Schweiz wird "ss" geschrieben:\n${treffer.join('\n')}`).toEqual([]);
  });
});
