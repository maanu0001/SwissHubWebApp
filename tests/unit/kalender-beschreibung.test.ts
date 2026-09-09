import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeText } from '@swisshub/shared';
import { calendar } from '@swisshub/modules';

/**
 * Die Formatierung einer Event-Beschreibung.
 *
 * Der Fehler lag nicht am Rendern, sondern am Speichern: `sanitizeText`
 * faltet standardmaessig jeden Leerraum zu einem Leerzeichen. Aus einer
 * gegliederten Beschreibung wurde in der Datenbank eine einzige Zeile - und
 * was danach kam, WebApp wie Discord, konnte gar nichts mehr richtig machen.
 */

const BEISPIEL = [
  '**GameNight**',
  '',
  'Wir spiele huet:',
  '- CS2',
  '- Valorant',
  '- Minecraft',
  '',
  'Treffpunkt isch **20:00 Uhr**.',
].join('\n');

/** Das Schema, das die Beschreibung annimmt. */
const durchsSchema = (text: string): string => {
  const ergebnis = calendar.eventInputSchema.safeParse({
    title: 'GameNight',
    description: text,
    startAt: new Date(Date.now() + 86_400_000).toISOString(),
    locationKind: 'DISCORD',
  });
  if (!ergebnis.success) {
    throw new Error(ergebnis.error.issues.map((eintrag) => eintrag.message).join(', '));
  }
  return ergebnis.data.description;
};

describe('Was beim Speichern erhalten bleibt', () => {
  it('behaelt einen einfachen Zeilenumbruch', () => {
    expect(durchsSchema('Erste Zeile\nZweite Zeile')).toBe('Erste Zeile\nZweite Zeile');
  });

  it('behaelt Absaetze', () => {
    expect(durchsSchema('Absatz eins\n\nAbsatz zwei')).toBe('Absatz eins\n\nAbsatz zwei');
  });

  it('behaelt Listen, Fett und Kursiv', () => {
    const gespeichert = durchsSchema(BEISPIEL);

    expect(gespeichert).toContain('**GameNight**');
    expect(gespeichert).toContain('- CS2');
    expect(gespeichert).toContain('- Valorant');
    expect(gespeichert).toContain('**20:00 Uhr**');
    // Und die Gliederung selbst.
    expect(gespeichert.split('\n').length).toBeGreaterThan(5);
  });

  it('behaelt einen Link', () => {
    const gespeichert = durchsSchema('Details: [hier](https://swisshub.gg/regeln)');
    expect(gespeichert).toContain('[hier](https://swisshub.gg/regeln)');
  });

  it('fasst drei Leerzeilen auf zwei zusammen', () => {
    // Absaetze ja, Wuesten nein.
    expect(durchsSchema('Eins\n\n\n\n\nZwei')).toBe('Eins\n\nZwei');
  });

  it('fasst Leerraum innerhalb einer Zeile weiterhin zusammen', () => {
    expect(durchsSchema('Zu      viel   Luft')).toBe('Zu viel Luft');
  });

  it('begrenzt eine sehr lange Beschreibung', () => {
    expect(() => durchsSchema('a'.repeat(9000))).toThrow();
  });
});

describe('Der Unterschied zum gewoehnlichen Text', () => {
  it('ein Titel darf weiterhin gefaltet werden', () => {
    // Ein Titel mit Umbruch ist ein Versehen, kein Absatz.
    expect(sanitizeText('Ein\nTitel', 100)).toBe('Ein Titel');
  });

  it('eine Beschreibung nicht', () => {
    expect(sanitizeText('Ein\nAbsatz', 100, { keepNewlines: true })).toBe('Ein\nAbsatz');
  });
});

describe('Die WebApp rendert sicher', () => {
  const markdown = readFileSync(join(process.cwd(), 'apps/web/src/components/shared/markdown.tsx'), 'utf8');

  it('setzt kein fremdes HTML in die Seite', () => {
    // Eine Beschreibung schreibt ein Mensch, gelesen wird sie oeffentlich.
    // Der Name steht im Quelltext nur im Kommentar - gemeint ist der Aufruf.
    const ohneKommentare = markdown.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    expect(ohneKommentare).not.toContain('dangerouslySetInnerHTML');
  });

  it('baut React-Elemente statt Zeichenketten', () => {
    expect(markdown).toContain("art: 'paragraph'");
    expect(markdown).toContain("art: 'list'");
  });

  it('wird fuer die Event-Beschreibung verwendet', () => {
    const seite = readFileSync(
      join(process.cwd(), 'apps/web/src/app/(app)/kalender/[slug]/page.tsx'),
      'utf8',
    );
    expect(seite).toContain('<Markdown text={event.description} />');
  });
});
