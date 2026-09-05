import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appeals } from '@swisshub/modules';

/**
 * Ein Feld für den Antragsteller - und alte Anträge trotzdem lesbar.
 *
 * Vorher waren es fünf Fragen, vier davon Pflicht. Wer gerade gebannt wurde,
 * schreibt selten viermal dreissig Zeichen; dieselbe Antwort landete am Ende
 * in zwei Feldern, weil sie zu beiden passte.
 *
 * Die heikle Stelle ist nicht das Formular, sondern das Archiv: ein Antrag
 * wird nach dem Einreichen nicht mehr angefasst, seine Antworten stehen unter
 * den Schlüsseln von damals. Wer die Fragenliste einfach kürzt, macht jede
 * alte Fallakte leer - und niemand merkt es, weil dort nur nichts steht.
 */

const { APPEAL_FRAGEN, APPEAL_FRUEHERE_FRAGEN, appealAntwortFelder } = appeals;

/** Ein Antrag von heute. */
const NEU = { antrag: 'Ich war zu voreilig und möchte zurückkommen. Das kommt nicht wieder vor.' };

/** Ein Antrag aus der Zeit der fünf Fragen. */
const ALT = {
  grund: 'Ich möchte zurück auf den Server, weil meine Freunde dort spielen.',
  hergang: 'Ich habe im Voice jemanden beleidigt, nachdem wir ein Spiel verloren hatten.',
  warumPruefen: 'Ich hatte damals keine Gelegenheit, meine Sicht zu schildern.',
  anders: 'Ich würde den Voice verlassen, statt weiterzureden.',
  weiteres: '',
};

describe('Das Formular', () => {
  it('stellt genau eine inhaltliche Frage', () => {
    expect(APPEAL_FRAGEN).toHaveLength(1);
    expect(APPEAL_FRAGEN[0]?.key).toBe('antrag');
  });

  it('fragt in ihr nach beidem: Grund und Umstände', () => {
    // Was vorher auf mehrere Überschriften verteilt war, steht jetzt in der
    // Frage selbst - sonst wäre es einfach weggefallen.
    const hilfe = APPEAL_FRAGEN[0]!.hilfe;

    expect(hilfe).toContain('warum du entbannt werden möchtest');
    expect(hilfe).toContain('berücksichtigen');
  });

  it('führt die alten Fragen nicht mehr im Formular', () => {
    const aktiv = APPEAL_FRAGEN.map((frage) => frage.key);

    for (const alt of ['grund', 'hergang', 'warumPruefen', 'anders', 'weiteres']) {
      expect(aktiv, alt).not.toContain(alt);
    }
  });
});

describe('Anzeigen eines Antrags', () => {
  it('zeigt einen neuen Antrag mit seinem einen Feld', () => {
    const felder = appealAntwortFelder(NEU);

    expect(felder).toHaveLength(1);
    expect(felder[0]?.wert).toBe(NEU.antrag);
  });

  it('zeigt einen alten Antrag vollständig', () => {
    // Der eigentliche Punkt: vier ausgefüllte Felder, vier Einträge - und
    // jeder mit der Frage, auf die er einmal geantwortet hat.
    const felder = appealAntwortFelder(ALT);

    expect(felder).toHaveLength(4);
    expect(felder.map((feld) => feld.key)).toEqual(['grund', 'hergang', 'warumPruefen', 'anders']);
    expect(felder[0]?.label).toBe('Warum möchtest du entbannt werden?');
  });

  it('lässt leere Antworten weg', () => {
    // «weiteres» war freiwillig und ist oft leer - eine Überschrift ohne Text
    // sähe aus, als fehlte etwas.
    expect(appealAntwortFelder(ALT).map((feld) => feld.key)).not.toContain('weiteres');
    expect(appealAntwortFelder({ ...ALT, weiteres: '   ' }).map((f) => f.key)).not.toContain('weiteres');
  });

  it('verschweigt den Idempotenzschlüssel', () => {
    // Er ist Technik und keine Antwort.
    const felder = appealAntwortFelder({ ...NEU, __idempotencyKey: 'abc-123' });

    expect(felder.map((feld) => feld.key)).not.toContain('__idempotencyKey');
    expect(felder).toHaveLength(1);
  });

  it('verliert auch einen unbekannten Schlüssel nicht', () => {
    // Ein Antrag aus einer Fassung, die es nie gab, wäre ein Fehler - aber
    // einer, der die Akte nicht leer aussehen lassen darf.
    const felder = appealAntwortFelder({ ...NEU, aussererdisch: 'Text von irgendwoher' });

    expect(felder.map((feld) => feld.wert)).toContain('Text von irgendwoher');
  });

  it('kennt für jede alte Frage eine Überschrift', () => {
    for (const frage of APPEAL_FRUEHERE_FRAGEN) {
      expect(frage.label.length, frage.key).toBeGreaterThan(5);
    }
  });
});

describe('Was das Team behält', () => {
  const quelle = (pfad: string): string =>
    readFileSync(fileURLToPath(new URL(`../../apps/web/src/${pfad}`, import.meta.url)), 'utf8');

  it('zeigt die Fallakte über denselben Helfer wie die Antragstellersicht', () => {
    // Zwei Ansichten desselben Antrags sollen ihn gleich zeigen.
    for (const pfad of ['app/(app)/appeals/[id]/page.tsx', 'app/entbannung/[id]/page.tsx']) {
      expect(quelle(pfad), pfad).toContain('appeals.appealAntwortFelder(');
    }
  });

  it('behält den internen Fallablauf vollständig', () => {
    // Vereinfacht wurde das Formular des Antragstellers - nicht die Arbeit
    // des Teams daran.
    const akte = quelle('app/(app)/appeals/[id]/page.tsx');

    // Zuweisung, Entscheidung und Rückfragen stecken in `FallAktionen`, die
    // internen Notizen in ihrer eigenen Komponente.
    for (const teil of ['InterneNotizen', 'FallAktionen', 'nachrichten=']) {
      expect(akte, teil).toContain(teil);
    }
  });

  it('lässt den Antragsteller weiterhin nichts Internes sehen', () => {
    const sicht = quelle('app/entbannung/[id]/page.tsx');

    expect(sicht).not.toContain('InterneNotizen');
    expect(sicht).not.toContain('internalDecision');
  });
});
