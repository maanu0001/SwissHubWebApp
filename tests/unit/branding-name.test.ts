import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { branding } from '@swisshub/config/client';

/**
 * Die Anwendung heisst «System».
 *
 * Der Name steht an genau einer Stelle - `packages/config/src/client.ts` - und
 * alles andere (Seitenleiste, Seitentitel, Metadaten, Banner, die oeffentlichen
 * Layouts) leitet ihn davon ab. Dieser Test haelt beides fest: den Namen selbst
 * und die Abwesenheit der alten Bezeichnung im ganzen Repository.
 *
 * Bewusst eine Suche ueber das Repository statt einer Liste von Dateien: eine
 * Liste veraltet, sobald jemand eine Seite hinzufuegt.
 */

const ALTE_NAMEN = ['Bot Control Center', 'Bot-Control-Center', 'Bot Dashboard'];

/** Sichtbare Treffer im Quelltext - ohne Abhaengigkeiten und Buildartefakte. */
function suche(begriff: string): string[] {
  try {
    const ausgabe = execFileSync(
      'git',
      ['grep', '-rniI', '--', begriff, ':!*.lock', ':!package-lock.json'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    return ausgabe.split('\n').filter((zeile) => zeile.trim() !== '');
  } catch (fehler) {
    // `git grep` endet mit Status 1, wenn es nichts findet - das ist hier der
    // Normalfall und kein Fehler.
    const status = (fehler as { status?: number }).status;
    if (status === 1) {
      return [];
    }
    throw fehler;
  }
}

describe('Name der Anwendung', () => {
  it('heisst «System»', () => {
    expect(branding.productName).toBe('System');
    expect(branding.name).toBe('SwissHub');
  });

  it('nennt das Banner die Anwendung beim Namen', () => {
    expect(branding.banner.title).toBe('System');
  });

  it.each(ALTE_NAMEN)('trägt «%s» nirgends mehr', (alt) => {
    const treffer = suche(alt).filter((zeile) => !zeile.startsWith('tests/unit/branding-name.test.ts'));
    expect(treffer, `Noch vorhanden:\n${treffer.join('\n')}`).toEqual([]);
  });

  it('kennt technische Bot-Begriffe weiterhin', () => {
    // Gegenprobe: die Umbenennung betraf das Branding, nicht den Bot. Wo
    // wirklich ein Bot gemeint ist, muss das Wort stehen bleiben.
    expect(suche('Bot Token').length + suche('DISCORD_BOT_TOKEN').length).toBeGreaterThan(0);
    expect(suche('Bot online').length).toBeGreaterThan(0);
  });
});
