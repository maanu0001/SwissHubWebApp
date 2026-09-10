import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ordneAktionen,
  teileKennzahlen,
  type AktionId,
  type KennzahlId,
  type Lage,
} from '../../apps/web/src/app/(app)/dashboard/prioritaet';

/**
 * Das Dashboard priorisiert - und verliert dabei nichts.
 *
 * Die Umstellung verschiebt Kennzahlen zwischen «oben als Karte» und «unten
 * als Zeile». Der Fehler, den man dabei macht, ist immer derselbe: eine
 * Kennzahl faellt aus beiden Toepfen und ist damit nirgends mehr zu sehen -
 * ohne dass jemand etwas entfernt haette. Deshalb steht die
 * Vollstaendigkeitspruefung hier ganz oben und nicht am Ende.
 */

const ALLE_KENNZAHLEN: KennzahlId[] = ['mitglieder', 'jails', 'verifikationen', 'bot', 'aktionen'];
const ALLE_AKTIONEN: AktionId[] = [
  'verifikation',
  'ticket',
  'spielersuche',
  'musik',
  'jail',
  'mitglieder',
  'audit',
  'einstellungen',
];

const RUHIG: Lage = { jailsAktiv: 0, verifikationenOffen: 0, botOnline: true };
const UNRUHIG: Lage = { jailsAktiv: 3, verifikationenOffen: 2, botOnline: false };
/** Ein gewoehnliches Mitglied: kennt weder Jails noch Verifikationen. */
const MITGLIED: Lage = { jailsAktiv: null, verifikationenOffen: null, botOnline: true };

/** Jede Kombination aus Zahlen, die im Betrieb vorkommen kann. */
const LAGEN: Lage[] = [];
for (const jailsAktiv of [null, 0, 1, 42]) {
  for (const verifikationenOffen of [null, 0, 1, 9]) {
    for (const botOnline of [true, false]) {
      LAGEN.push({ jailsAktiv, verifikationenOffen, botOnline });
    }
  }
}

describe('Keine Kennzahl geht verloren', () => {
  it.each(LAGEN.map((lage, index) => [index, lage] as const))(
    'gibt in Lage %i jede sichtbare Kennzahl genau einmal zurück',
    (_index, lage) => {
      const { wichtig, kontext } = teileKennzahlen(ALLE_KENNZAHLEN, lage);
      expect([...wichtig, ...kontext].sort()).toEqual([...ALLE_KENNZAHLEN].sort());
    },
  );

  it('gibt eine Kennzahl nie in beide Töpfe', () => {
    for (const lage of LAGEN) {
      const { wichtig, kontext } = teileKennzahlen(ALLE_KENNZAHLEN, lage);
      for (const id of wichtig) {
        expect(kontext).not.toContain(id);
      }
    }
  });

  it('gibt nur zurück, was hineingegeben wurde', () => {
    // Ein gewoehnliches Mitglied sieht zwei Kennzahlen. Die Aufteilung darf
    // keine dritte erfinden, nur weil sie sie kennt.
    const { wichtig, kontext } = teileKennzahlen(['mitglieder', 'bot'], MITGLIED);
    expect([...wichtig, ...kontext].sort()).toEqual(['bot', 'mitglieder']);
  });

  it('kommt mit einer leeren Auswahl zurecht', () => {
    expect(teileKennzahlen([], RUHIG)).toEqual({ wichtig: [], kontext: [] });
  });
});

describe('Was oben steht, verlangt eine Handlung', () => {
  it('lässt bei ruhiger Lage nichts nach oben', () => {
    expect(teileKennzahlen(ALLE_KENNZAHLEN, RUHIG).wichtig).toEqual([]);
  });

  it('behält bei ruhiger Lage die ursprüngliche Reihenfolge im Kontext', () => {
    // Sonst sortierte sich die Zeile bei jedem Seitenaufruf um, sobald eine
    // Zahl steigt - und man suchte dieselbe Angabe jedes Mal woanders.
    expect(teileKennzahlen(ALLE_KENNZAHLEN, RUHIG).kontext).toEqual(ALLE_KENNZAHLEN);
  });

  it('holt den offline gegangenen Bot nach oben', () => {
    const { wichtig } = teileKennzahlen(ALLE_KENNZAHLEN, { ...RUHIG, botOnline: false });
    expect(wichtig).toEqual(['bot']);
  });

  it('holt offene Verifikationen nach oben', () => {
    const { wichtig } = teileKennzahlen(ALLE_KENNZAHLEN, { ...RUHIG, verifikationenOffen: 4 });
    expect(wichtig).toEqual(['verifikationen']);
  });

  it('holt aktive Jails nach oben', () => {
    const { wichtig } = teileKennzahlen(ALLE_KENNZAHLEN, { ...RUHIG, jailsAktiv: 1 });
    expect(wichtig).toEqual(['jails']);
  });

  it('lässt eine Null nicht als Aufgabe gelten', () => {
    // «Null offene Verifikationen» ist eine gute Nachricht, keine Aufgabe.
    const { kontext } = teileKennzahlen(ALLE_KENNZAHLEN, { ...RUHIG, verifikationenOffen: 0 });
    expect(kontext).toContain('verifikationen');
  });

  it('behandelt «darf ich nicht sehen» nicht als Null und nicht als Aufgabe', () => {
    const { wichtig } = teileKennzahlen(['mitglieder', 'bot'], MITGLIED);
    expect(wichtig).toEqual([]);
  });

  it('stellt den Bot vor die Verifikationen und diese vor die Jails', () => {
    // Ein Bot, der nicht läuft, macht jede andere Zahl auf dieser Seite
    // gegenstandslos; danach zählen die Menschen, die warten.
    expect(teileKennzahlen(ALLE_KENNZAHLEN, UNRUHIG).wichtig).toEqual(['bot', 'verifikationen', 'jails']);
  });

  it('lässt Mitgliederzahl und Aktionen immer Kontext bleiben', () => {
    for (const lage of LAGEN) {
      const { kontext } = teileKennzahlen(ALLE_KENNZAHLEN, lage);
      expect(kontext).toContain('mitglieder');
      expect(kontext).toContain('aktionen');
    }
  });
});

describe('Schnellaktionen', () => {
  it('gibt jede Aktion genau einmal zurück', () => {
    for (const lage of LAGEN) {
      expect(ordneAktionen(ALLE_AKTIONEN, lage).sort()).toEqual([...ALLE_AKTIONEN].sort());
    }
  });

  it('erfindet keine Aktion, die der Betrachter nicht hat', () => {
    expect(ordneAktionen(['ticket', 'musik'], RUHIG)).toEqual(['ticket', 'musik']);
  });

  it('stellt die Warteschlange nach vorn, sobald etwas offen ist', () => {
    const geordnet = ordneAktionen(['ticket', 'einstellungen', 'verifikation'], {
      ...RUHIG,
      verifikationenOffen: 3,
    });
    expect(geordnet[0]).toBe('verifikation');
  });

  it('lässt eine leere Warteschlange an ihrem gewöhnlichen Platz', () => {
    // «Warteschlange (0 offen)» ganz oben wäre eine Aufgabe, die es nicht
    // gibt - der Eintrag bleibt, aber er drängelt sich nicht vor.
    const geordnet = ordneAktionen(['ticket', 'verifikation'], RUHIG);
    expect(geordnet).toEqual(['verifikation', 'ticket']);
  });

  it('stellt Erstellen vor blosses Navigieren', () => {
    const geordnet = ordneAktionen(['einstellungen', 'audit', 'mitglieder', 'ticket'], RUHIG);
    expect(geordnet).toEqual(['ticket', 'mitglieder', 'audit', 'einstellungen']);
  });

  it('ordnet unabhängig von der Eingabereihenfolge gleich', () => {
    const vorwaerts = ordneAktionen(ALLE_AKTIONEN, UNRUHIG);
    const rueckwaerts = ordneAktionen([...ALLE_AKTIONEN].reverse(), UNRUHIG);
    expect(rueckwaerts).toEqual(vorwaerts);
  });
});

describe('Die Seite hält sich an die Aufteilung', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/dashboard/page.tsx'), 'utf8');

  it('trifft die Priorisierung an einer Stelle', () => {
    // Sonst stünde die Frage «ist das wichtig?» zweimal im Code - einmal für
    // die Karten, einmal für die Zeile - und die beiden liefen auseinander.
    expect(quelle).toContain('teileKennzahlen(');
    expect(quelle).toContain('ordneAktionen(');
  });

  it('behält jede bisherige Kennzahl auf der Seite', () => {
    for (const beschriftung of ['Mitglieder', 'Aktive Jails', 'Verifikationen offen', 'Bot', 'Aktionen']) {
      expect(quelle, beschriftung).toContain(beschriftung);
    }
  });

  it('behält jede bisherige Schnellaktion auf der Seite', () => {
    for (const beschriftung of [
      'Warteschlange',
      'Ticket erstellen',
      'Spielersuche starten',
      'Musik starten',
      'Mitglied jailen',
      'Mitglied suchen',
      'Audit Log',
      'Einstellungen',
    ]) {
      expect(quelle, beschriftung).toContain(beschriftung);
    }
  });

  it('trägt keine zweite Überschrift erster Ordnung', () => {
    // Die Kopfzeile der Anwendung setzt bereits das `h1` mit dem Seitentitel.
    // Zwei davon auf einer Seite sind für einen Screenreader zwei Seiten.
    expect(quelle).not.toContain('<h1');
  });

  it('beschreibt jede Kennzahl genau einmal', () => {
    // Karte und Kontextzeile lesen dieselbe Beschreibung. Zwei Definitionen
    // derselben Zahl liefen auseinander, und die leisere Fassung sagte
    // irgendwann weniger als die laute.
    for (const beschriftung of ['Mitglieder', 'Aktive Jails', 'Verifikationen offen', 'Aktionen heute']) {
      expect(quelle.split(`label: '${beschriftung}'`), beschriftung).toHaveLength(2);
    }
  });

  it('behält die Zusatzangaben, die nur im Hinweis standen', () => {
    // Trend zum Vortag, bevorstehende Freilassungen, Ping, Online-Zahl: die
    // Zeile ist kürzer als fünf Karten, aber sie sagt nicht weniger.
    for (const angabe of ['zum Vortag', 'nächsten Stunde', 'Ping', 'online']) {
      expect(quelle, angabe).toContain(angabe);
    }
  });
});
