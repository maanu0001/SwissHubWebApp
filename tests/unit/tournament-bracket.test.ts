import { describe, expect, it } from 'vitest';
import { tournaments } from '@swisshub/modules';

/**
 * Die Bracket-Engine.
 *
 * Sie rechnet ohne Datenbank und ohne Discord - deshalb laesst sich hier
 * pruefen, was ein Turnier tatsaechlich spielen wuerde, ohne eines
 * aufzusetzen. Ein Bracket-Fehler faellt sonst erst auf, wenn dreissig Leute
 * davorstehen.
 */
const B = tournaments;

/** Kurze Namen fuer die Lesbarkeit der Erwartungen. */
const feld = (anzahl: number): string[] => Array.from({ length: anzahl }, (_, index) => `p${index + 1}`);

describe('Setzliste', () => {
  it('lässt die Gesetzten sich so spät wie möglich begegnen', () => {
    expect(B.seedOrder(2)).toEqual([1, 2]);
    expect(B.seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(B.seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    // Der Erste trifft immer auf den Letzten, der Zweite auf den Vorletzten.
    const sechzehn = B.seedOrder(16);
    expect(sechzehn[0]).toBe(1);
    expect(sechzehn[1]).toBe(16);
    expect(sechzehn).toHaveLength(16);
    expect(new Set(sechzehn).size).toBe(16);
  });

  it('weist eine Grösse zurück, die keine Zweierpotenz ist', () => {
    expect(() => B.seedOrder(6)).toThrow();
  });

  it('rundet auf die nächste Zweierpotenz auf', () => {
    expect(B.bracketSize(2)).toBe(2);
    expect(B.bracketSize(3)).toBe(4);
    expect(B.bracketSize(5)).toBe(8);
    expect(B.bracketSize(16)).toBe(16);
    expect(B.bracketSize(17)).toBe(32);
  });
});

describe('Single Elimination', () => {
  it('baut ein volles Bracket ohne Lücken', () => {
    const matches = B.singleElimination(feld(8));

    // 8 Teilnehmer: 4 + 2 + 1 Matches.
    expect(matches).toHaveLength(7);
    expect(matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(matches.filter((m) => m.round === 2)).toHaveLength(2);
    expect(matches.filter((m) => m.round === 3)).toHaveLength(1);

    // Jeder Teilnehmer genau einmal in der ersten Runde.
    const ersteRunde = matches.filter((m) => m.round === 1);
    const antretende = ersteRunde.flatMap((m) => [m.a, m.b]).filter(Boolean);
    expect(new Set(antretende).size).toBe(8);

    // Das Finale hat kein Ziel mehr.
    expect(matches.find((m) => m.round === 3)?.winnerTo).toBeUndefined();
  });

  it('lässt Gesetzte bei ungerader Teilnehmerzahl durchmarschieren', () => {
    // 5 Teilnehmer in einem Achter-Bracket: drei Freilose.
    const matches = B.singleElimination(feld(5));

    // In der ersten Runde darf kein Platz leer bleiben - ein Spiel gegen
    // niemanden wäre ein Knopf, den jemand drückt, und ein Resultat, das nie
    // stattfand. Spätere Runden sind zu Beginn leer und werden gefüllt.
    for (const match of matches.filter((m) => m.round === 1)) {
      expect(match.a, `Freilos in Runde 1 bei ${match.position}`).not.toBeNull();
      expect(match.b, `Freilos in Runde 1 bei ${match.position}`).not.toBeNull();
    }

    // Kein Match ohne Teilnehmer und ohne Zulauf: das wäre eines, das nie
    // gespielt werden kann und trotzdem im Bracket steht.
    for (const match of matches) {
      const zulauf = matches.filter(
        (m) => m.winnerTo && m.winnerTo.round === match.round && m.winnerTo.position === match.position,
      ).length;
      expect(
        (match.a !== null ? 1 : 0) + (match.b !== null ? 1 : 0) + zulauf,
        `Match ${match.round}/${match.position} kann nie besetzt werden`,
      ).toBe(2);
    }

    // Der Erstgesetzte hat ein Freilos und steht schon in Runde 2.
    const runde2 = matches.filter((m) => m.round === 2);
    const inRunde2 = runde2.flatMap((m) => [m.a, m.b]).filter(Boolean);
    expect(inRunde2).toContain('p1');
  });

  it('kommt mit jeder Teilnehmerzahl zu genau einem Sieger', () => {
    for (const anzahl of [2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 16, 17, 31, 32]) {
      const matches = B.singleElimination(feld(anzahl));
      const letzteRunde = Math.max(...matches.map((m) => m.round));
      const finale = matches.filter((m) => m.round === letzteRunde);
      expect(finale, `${anzahl} Teilnehmer ergeben kein einzelnes Finale`).toHaveLength(1);
      expect(finale[0]!.winnerTo).toBeUndefined();
    }
  });

  it('führt jedes Match ausser dem Finale in genau ein anderes', () => {
    const matches = B.singleElimination(feld(16));
    const schluessel = new Set(matches.map((m) => `${m.round}:${m.position}`));

    for (const match of matches) {
      if (!match.winnerTo) {
        continue;
      }
      expect(
        schluessel.has(`${match.winnerTo.round}:${match.winnerTo.position}`),
        `Match ${match.round}/${match.position} zeigt ins Leere`,
      ).toBe(true);
    }
  });

  it('lässt keine zwei Matches auf denselben Platz zeigen', () => {
    const matches = B.singleElimination(feld(16));
    const belegt = new Set<string>();
    for (const match of matches) {
      if (!match.winnerTo) {
        continue;
      }
      const platz = `${match.winnerTo.round}:${match.winnerTo.position}:${match.winnerTo.slot}`;
      // Zwei Sieger auf demselben Platz hiesse, dass einer verschwindet.
      expect(belegt.has(platz), `Platz ${platz} doppelt belegt`).toBe(false);
      belegt.add(platz);
    }
  });

  it('gibt bei weniger als zwei Teilnehmern kein Match aus', () => {
    expect(B.singleElimination([])).toEqual([]);
    expect(B.singleElimination(['p1'])).toEqual([]);
  });
});

describe('Double Elimination', () => {
  it('baut Sieger-, Verliererrunde und grosses Finale', () => {
    const matches = B.doubleElimination(feld(8));

    const wb = matches.filter((m) => m.stage === 'WINNERS');
    const lb = matches.filter((m) => m.stage === 'LOSERS');
    const gf = matches.filter((m) => m.stage === 'GRAND_FINAL');

    expect(wb).toHaveLength(7);
    // Bei acht Teilnehmern: 2 + 2 + 1 + 1 Verlierermatches.
    expect(lb).toHaveLength(6);
    expect(gf).toHaveLength(1);

    // Insgesamt kann jeder genau zweimal verlieren: 2n-2 Matches plus das
    // grosse Finale.
    expect(matches).toHaveLength(14);
  });

  it('schickt jeden Verlierer irgendwohin - ausser aus dem Finale', () => {
    const matches = B.doubleElimination(feld(8));
    const platz = new Set(matches.map((m) => `${m.stage}:${m.round}:${m.position}`));

    for (const match of matches) {
      if (match.stage === 'GRAND_FINAL') {
        continue;
      }
      if (match.stage === 'WINNERS') {
        expect(match.loserTo, `WB ${match.round}/${match.position} verliert niemanden`).toBeDefined();
        expect(
          platz.has(`${match.loserTo!.stage}:${match.loserTo!.round}:${match.loserTo!.position}`),
          `WB ${match.round}/${match.position} schickt den Verlierer ins Leere`,
        ).toBe(true);
      }
      if (match.winnerTo) {
        expect(
          platz.has(`${match.winnerTo.stage}:${match.winnerTo.round}:${match.winnerTo.position}`),
          `${match.stage} ${match.round}/${match.position} schickt den Sieger ins Leere`,
        ).toBe(true);
      }
    }
  });

  it('belegt keinen Platz doppelt', () => {
    for (const anzahl of [4, 8, 16]) {
      const matches = B.doubleElimination(feld(anzahl));
      const belegt = new Set<string>();

      for (const match of matches) {
        for (const ziel of [match.winnerTo, match.loserTo]) {
          if (!ziel) {
            continue;
          }
          const platz = `${ziel.stage}:${ziel.round}:${ziel.position}:${ziel.slot}`;
          expect(belegt.has(platz), `${anzahl} Teilnehmer: ${platz} doppelt belegt`).toBe(false);
          belegt.add(platz);
        }
      }
    }
  });

  it('führt Sieger- und Verliererrunde im grossen Finale zusammen', () => {
    const matches = B.doubleElimination(feld(8));
    const insFinale = matches.filter((m) => m.winnerTo?.stage === 'GRAND_FINAL');

    expect(insFinale).toHaveLength(2);
    expect(insFinale.map((m) => m.winnerTo!.slot).sort()).toEqual(['A', 'B']);
    // Aus der Siegerrunde kommt Platz A, aus der Verliererrunde Platz B.
    expect(insFinale.find((m) => m.stage === 'WINNERS')?.winnerTo?.slot).toBe('A');
    expect(insFinale.find((m) => m.stage === 'LOSERS')?.winnerTo?.slot).toBe('B');
  });

  it('kommt auch mit zwei Teilnehmern ohne Verliererrunde aus', () => {
    const matches = B.doubleElimination(feld(2));
    expect(matches.filter((m) => m.stage === 'LOSERS')).toHaveLength(0);
    // Der Verlierer hat noch ein Leben - er landet direkt im grossen Finale.
    const wb = matches.find((m) => m.stage === 'WINNERS')!;
    expect(wb.loserTo?.stage).toBe('GRAND_FINAL');
    expect(wb.winnerTo?.stage).toBe('GRAND_FINAL');
  });
});

describe('Jeder gegen jeden', () => {
  it('lässt jeden genau einmal gegen jeden spielen', () => {
    const matches = B.roundRobin(feld(6));

    // 6 Teilnehmer: 15 Begegnungen in 5 Runden.
    expect(matches).toHaveLength(15);
    expect(new Set(matches.map((m) => m.round)).size).toBe(5);

    const paare = new Set(matches.map((m) => [m.a, m.b].sort().join('-')));
    expect(paare.size).toBe(15);
  });

  it('lässt bei ungerader Zahl je Runde einen aussetzen', () => {
    const matches = B.roundRobin(feld(5));

    // 5 Teilnehmer: 10 Begegnungen in 5 Runden, je 2 Matches.
    expect(matches).toHaveLength(10);
    for (const runde of [1, 2, 3, 4, 5]) {
      expect(matches.filter((m) => m.round === runde)).toHaveLength(2);
    }
    // Kein Match gegen einen Platzhalter.
    expect(matches.every((m) => m.a !== null && m.b !== null)).toBe(true);
  });

  it('lässt niemanden zweimal in derselben Runde spielen', () => {
    for (const anzahl of [4, 5, 6, 7, 8]) {
      const matches = B.roundRobin(feld(anzahl));
      const runden = new Set(matches.map((m) => m.round));
      for (const runde of runden) {
        const antretende = matches.filter((m) => m.round === runde).flatMap((m) => [m.a, m.b]);
        expect(new Set(antretende).size, `${anzahl} Teilnehmer, Runde ${runde}: jemand spielt doppelt`).toBe(
          antretende.length,
        );
      }
    }
  });
});

describe('Gruppen', () => {
  it('verteilt die Gesetzten in Schlangenlinie', () => {
    const gruppen = B.verteileAufGruppen(feld(8), 4);

    expect(gruppen).toHaveLength(4);
    // 1 und 8 zusammen, 2 und 7 zusammen - so verteilen sich Starke und
    // Schwache, statt dass Gruppe A alle Gesetzten bekommt.
    expect(gruppen[0]).toEqual(['p1', 'p8']);
    expect(gruppen[1]).toEqual(['p2', 'p7']);
    expect(gruppen[2]).toEqual(['p3', 'p6']);
    expect(gruppen[3]).toEqual(['p4', 'p5']);
  });

  it('verteilt auch eine ungerade Zahl vollständig', () => {
    const gruppen = B.verteileAufGruppen(feld(11), 3);
    expect(gruppen.flat()).toHaveLength(11);
    expect(new Set(gruppen.flat()).size).toBe(11);
  });

  it('gibt jeder Gruppe ihre eigene Runde und eindeutige Plätze', () => {
    const { gruppen, matches } = B.gruppenphase(feld(8), 2);

    expect(gruppen).toHaveLength(2);
    // Zwei Gruppen à 4: je 6 Begegnungen.
    expect(matches).toHaveLength(12);

    // Die Eindeutigkeit in der Datenbank hängt an (Abschnitt, Runde, Platz).
    const plaetze = matches.map((m) => `${m.round}:${m.position}`);
    expect(new Set(plaetze).size).toBe(plaetze.length);

    expect(matches.every((m) => m.groupIndex !== undefined)).toBe(true);
  });
});

describe('Schweizer System', () => {
  it('leitet die Rundenzahl aus der Teilnehmerzahl ab', () => {
    expect(B.swissRunden(8)).toBe(3);
    expect(B.swissRunden(16)).toBe(4);
    expect(B.swissRunden(10)).toBe(4);
    expect(B.swissRunden(1)).toBe(0);
  });

  it('paart nach Punktzahl und vermeidet Wiederholungen', () => {
    const bilanzen = [
      { participantId: 'a', punkte: 3, gegner: ['b'], hatteFreilos: false },
      { participantId: 'b', punkte: 0, gegner: ['a'], hatteFreilos: false },
      { participantId: 'c', punkte: 3, gegner: ['d'], hatteFreilos: false },
      { participantId: 'd', punkte: 0, gegner: ['c'], hatteFreilos: false },
    ];

    const matches = B.swissPaarung(bilanzen, 2);
    expect(matches).toHaveLength(2);

    // Die beiden mit drei Punkten treffen aufeinander, die beiden ohne auch.
    const paare = matches.map((m) => [m.a, m.b].sort().join('-')).sort();
    expect(paare).toEqual(['a-c', 'b-d']);
  });

  it('lässt bei ungerader Zahl den hintersten ohne Freilos aussetzen', () => {
    const bilanzen = [
      { participantId: 'a', punkte: 6, gegner: [], hatteFreilos: false },
      { participantId: 'b', punkte: 3, gegner: [], hatteFreilos: false },
      { participantId: 'c', punkte: 0, gegner: [], hatteFreilos: true },
      { participantId: 'd', punkte: 0, gegner: [], hatteFreilos: false },
      { participantId: 'e', punkte: 0, gegner: [], hatteFreilos: false },
    ];

    const matches = B.swissPaarung(bilanzen, 3);
    expect(matches).toHaveLength(2);

    const spielend = new Set(matches.flatMap((m) => [m.a, m.b]));
    // Wer schon ausgesetzt hat, setzt nicht nochmals aus.
    expect(spielend.has('c')).toBe(true);
    expect(spielend.size).toBe(4);
  });
});

describe('Tabelle', () => {
  const punkte = { win: 3, draw: 1, loss: 0 };

  it('rechnet Siege, Punkte und Differenz aus den Matches', () => {
    const tabelle = B.berechneTabelle(
      ['a', 'b', 'c'],
      [
        { aId: 'a', bId: 'b', scoreA: 2, scoreB: 0, winnerId: 'a' },
        { aId: 'b', bId: 'c', scoreA: 1, scoreB: 1, winnerId: null },
        { aId: 'a', bId: 'c', scoreA: 1, scoreB: 2, winnerId: 'c' },
      ],
      punkte,
    );

    const a = tabelle.find((zeile) => zeile.participantId === 'a')!;
    expect(a.siege).toBe(1);
    expect(a.niederlagen).toBe(1);
    expect(a.punkte).toBe(3);
    expect(a.erzielt).toBe(3);
    expect(a.erhalten).toBe(2);
    expect(a.differenz).toBe(1);

    const b = tabelle.find((zeile) => zeile.participantId === 'b')!;
    expect(b.unentschieden).toBe(1);
    expect(b.punkte).toBe(1);
  });

  it('lässt den direkten Vergleich vor der Differenz entscheiden', () => {
    // Beide haben drei Punkte; b hat a geschlagen, a die bessere Differenz.
    const tabelle = B.berechneTabelle(
      ['a', 'b'],
      [{ aId: 'a', bId: 'b', scoreA: 0, scoreB: 1, winnerId: 'b' }],
      punkte,
    );
    tabelle.find((zeile) => zeile.participantId === 'a')!.punkte = 3;
    tabelle.find((zeile) => zeile.participantId === 'a')!.differenz = 10;
    tabelle.find((zeile) => zeile.participantId === 'b')!.punkte = 3;
    tabelle.find((zeile) => zeile.participantId === 'b')!.differenz = 1;

    const sortiert = B.sortiereTabelle(tabelle, ['HEAD_TO_HEAD', 'SCORE_DIFFERENCE']);
    expect(sortiert[0]!.participantId).toBe('b');

    // Ohne direkten Vergleich zählt die Differenz.
    const anders = B.sortiereTabelle(tabelle, ['SCORE_DIFFERENCE']);
    expect(anders[0]!.participantId).toBe('a');
  });

  it('lässt einen echten Gleichstand stehen, statt ihn zu erfinden', () => {
    const tabelle = B.berechneTabelle(['a', 'b'], [], punkte);
    const sortiert = B.sortiereTabelle(tabelle, ['SCORE_DIFFERENCE', 'SCORE_FOR']);
    expect(sortiert.map((zeile) => zeile.participantId)).toEqual(['a', 'b']);
  });

  it('sammelt die Qualifizierten nach Rang, nicht nach Gruppe', () => {
    const gruppeA = B.berechneTabelle(['a1', 'a2'], [], punkte);
    const gruppeB = B.berechneTabelle(['b1', 'b2'], [], punkte);

    // Erste zuerst, dann Zweite - so trifft ein Gruppensieger nicht sofort
    // auf einen anderen.
    expect(B.qualifikanten([gruppeA, gruppeB], 2)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(B.qualifikanten([gruppeA, gruppeB], 1)).toEqual(['a1', 'b1']);
  });
});

describe('Auslosung', () => {
  it('behält alle Teilnehmer und verwendet die übergebene Quelle', () => {
    const gezogen: number[] = [];
    const gemischt = B.mische(feld(6), (grenze) => {
      gezogen.push(grenze);
      // Feste Quelle: das Ergebnis ist damit im Test nachvollziehbar, ohne
      // dass die Anwendung eine vorhersagbare Auslosung bekommt.
      return 0;
    });

    expect(gemischt).toHaveLength(6);
    expect(new Set(gemischt).size).toBe(6);
    expect(gezogen).toEqual([6, 5, 4, 3, 2]);
  });
});
