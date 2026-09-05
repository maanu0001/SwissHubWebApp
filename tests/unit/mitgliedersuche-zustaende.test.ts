import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Was die Mitgliedersuche anzeigt, wenn sie nichts anzuzeigen hat.
 *
 * Der gemeldete Fehler war genau das: Ladekringel erscheint, Ladekringel
 * verschwindet, leeres Feld. Drei verschiedene Lagen sahen identisch aus -
 * «wird gesucht», «niemand gefunden» und «die Suche ist gescheitert» -, und
 * damit war der eigentliche Fehler im Browser unsichtbar.
 *
 * Diese Datei prüft den Quelltext, nicht das Rendering: eine Komponente mit
 * Server Actions liesse sich hier nicht sinnvoll mounten, und was zählt, ist
 * dass es die vier Zustände überhaupt gibt und dass kein Fehler mehr in eine
 * leere Liste übersetzt wird.
 */
const quelle = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/members/components/member-picker.tsx'),
  'utf8',
);

describe('Mitgliedersuche: die Zustände', () => {
  it('kennt Laden, Treffer, nichts gefunden und Fehler', () => {
    for (const art of ["art: 'laedt'", "art: 'treffer'", "art: 'nichts'", "art: 'fehler'"]) {
      expect(quelle, art).toContain(art);
    }
  });

  it('sagt beim Laden, dass gesucht wird', () => {
    expect(quelle).toContain('Mitglieder werden gesucht');
  });

  it('sagt es, wenn niemand passt', () => {
    expect(quelle).toContain('Keine passenden Mitglieder gefunden.');
  });

  it('zeigt einen Fehler als Fehler an', () => {
    // Und zwar sichtbar - `role="alert"`, nicht als graue Randnotiz.
    expect(quelle).toContain("art: 'fehler'");
    expect(quelle).toContain('role="alert"');
    expect(quelle).toContain('text-destructive');
  });

  it('übersetzt einen Fehler nicht mehr in eine leere Liste', () => {
    // Das war der Kern: `setResults([])` im Fehlerzweig. Danach war der
    // Fehler weg - und mit ihm jede Chance, ihn zu bemerken.
    // Nur der Fehlerzweig selbst - der Name steht im Quelltext noch in einem
    // Kommentar, und der soll dort auch stehen bleiben.
    const fehlerzweig = quelle.slice(quelle.indexOf('if (!antwort.ok)'), quelle.indexOf('const eintraege'));
    expect(fehlerzweig).not.toMatch(/^\s*setResults\(/mu);
    expect(fehlerzweig).toContain("art: 'fehler'");
    expect(fehlerzweig).toContain('antwort.error.message');
  });
});

describe('Mitgliedersuche: zwei Anfragen gleichzeitig', () => {
  it('lässt nur die jüngste Anfrage schreiben', () => {
    /*
      Zwei Anfragen können sich überholen: die zu «man» braucht länger als die
      zu «manu», und dann schreibt die ältere ihre Treffer über die neueren.
      Das Ergebnis wäre eine Liste, die nicht zur Eingabe passt.
    */
    expect(quelle).toContain('laufendeNummer');
    expect(quelle).toContain('meine !== laufendeNummer.current');
  });

  it('debounct, bevor es überhaupt fragt', () => {
    expect(quelle).toMatch(/DEBOUNCE_MS\s*=\s*\d+/u);
    expect(quelle).toContain('setTimeout(');
  });
});

describe('Mitgliedersuche: nicht wählbare Treffer', () => {
  it('zeigt sie an, statt sie wegzulassen', () => {
    // Ein weggelassener Treffer ist von «gibt es nicht» nicht zu
    // unterscheiden - genau daran ist die Vote-Jail-Suche gescheitert.
    expect(quelle).toContain('disabled={!member.waehlbar}');
    expect(quelle).toContain('cursor-not-allowed');
  });

  it('nennt den Grund daneben', () => {
    expect(quelle).toContain('{member.grund ?? ');
  });

  it('behandelt eine Suche ohne Eignungsangabe als «alles wählbar»', () => {
    // Die allgemeine Mitgliedersuche kennt das Feld nicht - dort ist jeder
    // Treffer wählbar, und das darf nicht in eine gesperrte Liste kippen.
    expect(quelle).toContain('member.waehlbar ?? true');
  });
});

describe('Die ausgewählte Person bleibt ausgewählt', () => {
  it('hält die Auswahl ausserhalb der Trefferliste', () => {
    // Die Auswahl liegt im `value`-Prop des Aufrufers, nicht im Suchzustand.
    // Damit überlebt sie jedes neue Suchergebnis und jedes Neuzeichnen.
    expect(quelle).toContain('value: PickedMember | null');
    expect(quelle).toContain('if (value) {');
  });

  it('leert beim «Ändern» die Suche, nicht die Auswahl auf Umwegen', () => {
    expect(quelle).toContain("setStand({ art: 'leer' })");
  });
});
