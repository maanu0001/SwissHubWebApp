import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import {
  SOCIAL_MASSE,
  folienDateiname,
  zeichneSocialFolie,
  type SocialDaten,
  type SocialFormat,
} from '../../apps/web/src/modules/fragt/social-folie';
import { baueZip } from '../../packages/modules/src/wrapped/zip';
import type { fragt } from '@swisshub/modules';

/**
 * Die Grafiken entstehen wirklich - und in der richtigen Groesse.
 *
 * ## Warum das nicht durch Ansehen zu pruefen ist
 *
 * Weil ein Export auf drei Weisen scheitert, und keine davon sieht man am
 * Code:
 *
 *  - **Leere Datei.** Satori kennt nur einen Teil von CSS. Eine Eigenschaft,
 *    die der Browser versteht - `clip-path`, `text-transform`, `box-shadow` -
 *    laesst das Rendern scheitern, und heraus kommt nichts. Im Studio sieht die
 *    Vorschau trotzdem gut aus, weil die im Browser laeuft.
 *  - **Falsche Masse.** Instagram schneidet eine Story, die nicht 1080 x 1920
 *    ist. Das merkt man beim Hochladen.
 *  - **Layout laeuft aus dem Bild.** Eine Frage mit 180 Zeichen oder eine
 *    Antwort mit 60 - die Faelle, die niemand von Hand testet, weil die eigene
 *    Testfrage immer kurz ist.
 *
 * Geprueft wird deshalb an den echten Bytes: der PNG-Kopf traegt Breite und
 * Hoehe, und eine Datei von null Bytes ist keine Datei.
 */

/** Breite und Hoehe aus dem IHDR-Block eines PNG. */
function pngMasse(bytes: Uint8Array): { breite: number; hoehe: number } {
  // 0-7 Signatur, 8-11 Laenge, 12-15 'IHDR', dann zwei 32-Bit-Zahlen.
  const signatur = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, wert] of signatur.entries()) {
    expect(bytes[index], `PNG-Signatur an Position ${index}`).toBe(wert);
  }
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { breite: sicht.getUint32(16), hoehe: sicht.getUint32(20) };
}

async function rendere(art: fragt.FolienArt, format: SocialFormat, daten: SocialDaten): Promise<Uint8Array> {
  const mass = SOCIAL_MASSE[format];
  const bild = new ImageResponse(zeichneSocialFolie({ art, format, daten }), {
    width: mass.breite,
    height: mass.hoehe,
  });
  return new Uint8Array(await bild.arrayBuffer());
}

/** Ein gewoehnliches Ergebnis: vier Antworten, ein klarer Gewinner. */
const NORMAL: SocialDaten = {
  frageText: 'Welches Game hat euch die meisten Spielstunden gekostet?',
  untertitel: 'Ehrliche Antworten, bitte.',
  ueberschrift: 'Welches Game hat euch die meisten Spielstunden gekostet?',
  cta: 'Was hättest du gewählt? Diskutiere mit uns auf Discord.',
  zeilen: [
    { label: 'Minecraft', prozent: 42, stimmen: 42, fuehrt: true },
    { label: 'Counter-Strike 2', prozent: 30, stimmen: 30, fuehrt: false },
    { label: 'League of Legends', prozent: 18, stimmen: 18, fuehrt: false },
    { label: 'World of Warcraft', prozent: 10, stimmen: 10, fuehrt: false },
  ],
  gesamt: 100,
  gewinner: { label: 'Minecraft', prozent: 42, stimmen: 42 },
  gleichstand: [],
};

/** Zwei Antworten - der Fall, fuer den die Duell-Vorlage gebaut ist. */
const DUELL: SocialDaten = {
  frageText: 'Controller oder Maus & Tastatur?',
  untertitel: null,
  ueberschrift: 'Controller oder Maus & Tastatur?',
  cta: 'Und du? Sag es uns auf Discord.',
  zeilen: [
    { label: 'Controller', prozent: 37, stimmen: 22, fuehrt: false },
    { label: 'Maus & Tastatur', prozent: 63, stimmen: 37, fuehrt: true },
  ],
  gesamt: 59,
  gewinner: { label: 'Maus & Tastatur', prozent: 63, stimmen: 37 },
  gleichstand: [],
};

const ALLE_ARTEN: fragt.FolienArt[] = ['frage', 'gewinner', 'verteilung', 'duell', 'cta'];
const ALLE_FORMATE: SocialFormat[] = ['story', 'feed', 'quadrat'];

describe('Grafikexport: Masse und Inhalt', () => {
  it.each(ALLE_FORMATE)('liefert fuer %s die exakten Instagram-Masse', async (format) => {
    const bytes = await rendere('gewinner', format, NORMAL);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE[format]);
  });

  it('nennt die drei Formate mit den Zahlen, die Instagram erwartet', () => {
    /*
     * Die Zahlen selbst, nicht nur ihre Gleichheit mit sich.
     *
     * Ein Test, der `SOCIAL_MASSE` gegen `SOCIAL_MASSE` prueft, waere immer
     * gruen - auch wenn jemand aus 1920 eine 1290 macht.
     */
    expect(SOCIAL_MASSE.story).toEqual({ breite: 1080, hoehe: 1920 });
    expect(SOCIAL_MASSE.feed).toEqual({ breite: 1080, hoehe: 1350 });
    expect(SOCIAL_MASSE.quadrat).toEqual({ breite: 1080, hoehe: 1080 });
  });

  it.each(ALLE_ARTEN)('rendert die Folie «%s» in allen drei Formaten', async (art) => {
    for (const format of ALLE_FORMATE) {
      const bytes = await rendere(art, format, art === 'duell' ? DUELL : NORMAL);
      expect(bytes.byteLength, `${art}/${format} ist leer`).toBeGreaterThan(1000);
      expect(pngMasse(bytes), `${art}/${format}`).toEqual(SOCIAL_MASSE[format]);
    }
  });
});

describe('Grafikexport: die Faelle, die niemand von Hand testet', () => {
  it('haelt eine sehr lange Frage im Bild', async () => {
    const lang: SocialDaten = {
      ...NORMAL,
      frageText:
        'Welches Videospiel aus der Zeit zwischen 1998 und 2007 hat euch rückblickend am meisten geprägt, und zwar nicht wegen der Grafik, sondern wegen der Abende, die ihr damit verbracht habt?',
    };
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'story', lang);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
      expect(pngMasse(bytes), art).toEqual(SOCIAL_MASSE.story);
    }
  });

  it('haelt sehr lange Antworten im Bild', async () => {
    const lang: SocialDaten = {
      ...NORMAL,
      zeilen: [
        { label: 'The Elder Scrolls V: Skyrim Special Edition', prozent: 51, stimmen: 51, fuehrt: true },
        { label: 'Counter-Strike: Global Offensive (jetzt CS2)', prozent: 29, stimmen: 29, fuehrt: false },
        {
          label: 'Sid Meiers Civilization VI mit allen Erweiterungen',
          prozent: 12,
          stimmen: 12,
          fuehrt: false,
        },
        { label: 'Euro Truck Simulator 2 - Scandinavia', prozent: 8, stimmen: 8, fuehrt: false },
      ],
      gewinner: { label: 'The Elder Scrolls V: Skyrim Special Edition', prozent: 51, stimmen: 51 },
    };
    for (const format of ALLE_FORMATE) {
      const bytes = await rendere('verteilung', format, lang);
      expect(bytes.byteLength, format).toBeGreaterThan(1000);
      expect(pngMasse(bytes), format).toEqual(SOCIAL_MASSE[format]);
    }
  });

  it('rendert Umlaute und Akzente als Glyphen', async () => {
    /*
     * Satori braucht fuer jedes Zeichen eine Glyphe. Fehlt sie, bleibt die
     * Stelle leer - und «Spielstunden» mit Umlaut ist kein Sonderfall, sondern
     * der Alltag. Geprueft wird deshalb nicht nur, dass ein Bild entsteht,
     * sondern dass der Umlaut etwas veraendert: waere er eine Leerstelle, waere
     * das PNG byte-identisch mit dem ohne ihn.
     */
    const mitUmlaut = await rendere('verteilung', 'quadrat', {
      ...NORMAL,
      zeilen: [
        { label: 'Münchhausen', prozent: 100, stimmen: 1, fuehrt: true },
        { label: 'B', prozent: 0, stimmen: 0, fuehrt: false },
      ],
      gesamt: 1,
      gewinner: { label: 'Münchhausen', prozent: 100, stimmen: 1 },
    });
    const ohneUmlaut = await rendere('verteilung', 'quadrat', {
      ...NORMAL,
      zeilen: [
        { label: 'Munchhausen', prozent: 100, stimmen: 1, fuehrt: true },
        { label: 'B', prozent: 0, stimmen: 0, fuehrt: false },
      ],
      gesamt: 1,
      gewinner: { label: 'Munchhausen', prozent: 100, stimmen: 1 },
    });
    expect(mitUmlaut.byteLength).not.toBe(ohneUmlaut.byteLength);
  });

  it('bricht an einem Emoji nicht ab', async () => {
    /*
     * Die Zusage, die ueberall gilt - und die einzige, die hier gelten darf.
     *
     * ## Warum hier nicht steht, ob das Emoji zu sehen ist
     *
     * Weil das von der Umgebung abhaengt, und ich habe genau daran einen
     * Deployment-Lauf verloren.
     *
     * Gemessen in meinem Container: ein PNG mit «Minecraft 🎮🔥» war
     * **byte-identisch** mit einem ohne - keine Emoji-Schrift, also keine
     * Glyphe. Aus dieser Messung habe ich eine harte Zusicherung gemacht
     * (`expect(mit).toBe(ohne)`).
     *
     * Auf dem GitHub-Runner ist dasselbe PNG 2625 Bytes **groesser**: dort gibt
     * es eine Emoji-Schrift, und das Emoji wird gezeichnet. Der Test fiel um,
     * und mit ihm der Lauf 79.
     *
     * Beides ist richtig - fuer die jeweilige Maschine. Eine Zusage darf
     * deshalb nur das behaupten, was von den installierten Schriften
     * unabhaengig ist: **der Export scheitert nicht**. Ein Mitglied, das ein
     * Emoji in eine Antwort schreibt, bringt die Grafik nicht zu Fall - ob das
     * Emoji erscheint, entscheidet das Abbild, in dem gerendert wird.
     */
    const mit = await rendere('verteilung', 'quadrat', {
      ...NORMAL,
      zeilen: NORMAL.zeilen.map((zeile, index) =>
        index === 0 ? { ...zeile, label: `${zeile.label} 🎮🔥` } : zeile,
      ),
      gewinner: { label: `${NORMAL.gewinner!.label} 🎮🔥`, prozent: 42, stimmen: 42 },
    });
    expect(mit.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(mit)).toEqual(SOCIAL_MASSE.quadrat);
  });

  it('vertraegt Emojis in jeder Vorlage, ohne zu scheitern', async () => {
    const bunt: SocialDaten = {
      ...NORMAL,
      frageText: 'Wofür würdest du deine Grafikkarte verkaufen? 🎮',
      untertitel: 'Ganz ehrlich – für was?',
      zeilen: [
        { label: 'Für gar nichts 😤', prozent: 55, stimmen: 11, fuehrt: true },
        { label: 'Für ein Café in Zürich ☕', prozent: 45, stimmen: 9, fuehrt: false },
      ],
      gesamt: 20,
      gewinner: { label: 'Für gar nichts 😤', prozent: 55, stimmen: 11 },
    };
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'feed', bunt);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
    }
  });

  it('zeichnet einen Gleichstand ohne Gewinner', async () => {
    const gleich: SocialDaten = {
      ...DUELL,
      zeilen: [
        { label: 'Controller', prozent: 50, stimmen: 20, fuehrt: true },
        { label: 'Maus & Tastatur', prozent: 50, stimmen: 20, fuehrt: true },
      ],
      gesamt: 40,
      // Kein Gewinner - genau das soll die Grafik sagen.
      gewinner: null,
      gleichstand: ['Controller', 'Maus & Tastatur'],
    };
    const bytes = await rendere('gewinner', 'story', gleich);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE.story);
  });

  it('zeichnet eine Abstimmung ohne eine einzige Stimme', async () => {
    const leer: SocialDaten = {
      ...NORMAL,
      zeilen: NORMAL.zeilen.map((zeile) => ({ ...zeile, prozent: 0, stimmen: 0, fuehrt: false })),
      gesamt: 0,
      gewinner: null,
      gleichstand: [],
    };
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'quadrat', leer);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
    }
  });

  it('nimmt fuenf Antworten in der Verteilung auf', async () => {
    // Die Obergrenze aus `FRAGETYPEN` - und der Fall, bei dem die letzte Zeile
    // aus dem Bild laufen wuerde, wenn die Zeilenhoehe nicht mitrechnet.
    const fuenf: SocialDaten = {
      ...NORMAL,
      zeilen: [
        { label: 'NieR: Automata', prozent: 31, stimmen: 31, fuehrt: true },
        { label: 'DOOM Eternal', prozent: 24, stimmen: 24, fuehrt: false },
        { label: 'Hollow Knight', prozent: 20, stimmen: 20, fuehrt: false },
        { label: 'The Witcher 3', prozent: 15, stimmen: 15, fuehrt: false },
        { label: 'Minecraft', prozent: 10, stimmen: 10, fuehrt: false },
      ],
      gewinner: { label: 'NieR: Automata', prozent: 31, stimmen: 31 },
    };
    for (const format of ALLE_FORMATE) {
      const bytes = await rendere('verteilung', format, fuenf);
      expect(pngMasse(bytes), format).toEqual(SOCIAL_MASSE[format]);
    }
  });

  it('faellt bei der Duell-Vorlage auf die Liste zurueck, wenn es mehr als zwei Antworten gibt', async () => {
    // Sonst blieben zwei Haelften leer. Geprueft wird, dass ueberhaupt ein
    // gueltiges Bild entsteht - die Vorlage entscheidet selbst.
    const bytes = await rendere('duell', 'story', NORMAL);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE.story);
  });
});

describe('Grafikexport: das Archiv', () => {
  it('packt vier Folien in ein ZIP, das die Dateien wieder hergibt', async () => {
    const folien: fragt.FolienArt[] = ['frage', 'gewinner', 'verteilung', 'cta'];
    const eintraege = [];
    for (const [index, art] of folien.entries()) {
      eintraege.push({
        name: folienDateiname(index, art, 'feed'),
        daten: await rendere(art, 'feed', NORMAL),
      });
    }

    const archiv = baueZip(eintraege);
    expect(archiv.byteLength).toBeGreaterThan(4000);
    // «PK\x03\x04» - die Signatur eines ZIP.
    expect([archiv[0], archiv[1], archiv[2], archiv[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // Jeder Dateiname steht im Archiv, und die Nummerierung gibt die
    // Reihenfolge vor - beim Hochladen entscheidet sie, was zuerst zu sehen ist.
    const text = Buffer.from(archiv).toString('latin1');
    for (const eintrag of eintraege) {
      expect(text).toContain(eintrag.name);
    }
    expect(eintraege.map((eintrag) => eintrag.name)).toEqual([
      'swisshub-fragt-01-frage-feed.png',
      'swisshub-fragt-02-gewinner-feed.png',
      'swisshub-fragt-03-verteilung-feed.png',
      'swisshub-fragt-04-cta-feed.png',
    ]);
  });
});
