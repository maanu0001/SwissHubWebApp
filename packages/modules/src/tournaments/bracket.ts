/**
 * Bracket-Engine.
 *
 * Ausdruecklich ohne Datenbank und ohne Discord: hier wird nur gerechnet.
 * Ein Bracket ist die eine Stelle, an der ein Fehler nicht auffaellt, bevor
 * dreissig Leute davorstehen - und die einzige Art, ihn vorher zu finden, ist
 * ihn pruefen zu koennen, ohne ein Turnier aufzusetzen.
 *
 * Die Funktionen hier bekommen Setzplaetze und liefern geplante Matches samt
 * der Frage, wohin Sieger und Verlierer weitergehen. Wer sie speichert,
 * entscheidet `bracket-service.ts`.
 */

export type BracketStage = 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | 'GROUPS' | 'ROUND_ROBIN' | 'SWISS';
export type Slot = 'A' | 'B';

/** Wohin ein Sieger oder Verlierer geht. */
export interface Ziel {
  stage: BracketStage;
  round: number;
  position: number;
  slot: Slot;
}

export interface PlannedMatch {
  stage: BracketStage;
  round: number;
  /** Platz innerhalb der Runde, 1-basiert. */
  position: number;
  /** Teilnehmerkennung, oder `null` fuer «steht noch nicht fest». */
  a: string | null;
  b: string | null;
  /** Freilos: nur eine Seite besetzt, die andere kommt nie. */
  bye: boolean;
  winnerTo?: Ziel;
  loserTo?: Ziel;
  /** Nur bei Gruppen: 0-basierter Index der Gruppe. */
  groupIndex?: number;
}

// --- Setzliste -------------------------------------------------------------

/**
 * Die Reihenfolge der Setzplaetze in einem Bracket.
 *
 * Rekursiv gebaut, damit die Gesetzten sich so spaet wie moeglich begegnen:
 * bei acht Plaetzen ergibt das 1-8, 4-5, 2-7, 3-6. Wer das von Hand
 * hinschreibt, vertut sich ab sechzehn Plaetzen - deshalb hier die Regel
 * statt einer Tabelle.
 */
export function seedOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error(`Bracketgrösse muss eine Zweierpotenz sein, nicht ${size}.`);
  }
  let reihe = [1];
  while (reihe.length < size) {
    const naechste = reihe.length * 2;
    const gepaart: number[] = [];
    for (const platz of reihe) {
      gepaart.push(platz, naechste + 1 - platz);
    }
    reihe = gepaart;
  }
  return reihe;
}

/** Die kleinste Zweierpotenz, die alle aufnimmt. */
export function bracketSize(anzahl: number): number {
  let groesse = 1;
  while (groesse < anzahl) {
    groesse *= 2;
  }
  return Math.max(2, groesse);
}

/**
 * Teilnehmer mischen.
 *
 * Fisher-Yates mit einer uebergebenen Zufallsquelle - so laesst sich die
 * Auslosung im Test festnageln, ohne dass die Anwendung eine vorhersagbare
 * bekommt. Die eigentliche Quelle ist `crypto.randomInt`; `Math.random` waere
 * fuer eine Auslosung, an der Preise haengen, zu schwach.
 */
export function mische<T>(werte: readonly T[], zufall: (grenze: number) => number): T[] {
  const kopie = [...werte];
  for (let index = kopie.length - 1; index > 0; index -= 1) {
    const ziel = zufall(index + 1);
    const zwischen = kopie[index]!;
    kopie[index] = kopie[ziel]!;
    kopie[ziel] = zwischen;
  }
  return kopie;
}

// --- Einfaches K.-o.-System ------------------------------------------------

/**
 * Single Elimination.
 *
 * Freilose entstehen dort, wo ein Setzplatz leer bleibt. Sie werden nicht als
 * Match gespeichert, das jemand «gewinnen» muesste: der Gesetzte steht einfach
 * schon in der naechsten Runde. Ein Scheinmatch gegen niemanden waere ein
 * Knopf, den jemand drueckt, und ein Resultat, das nie stattfand.
 */
export function singleElimination(
  teilnehmer: readonly string[],
  optionen: { stage?: BracketStage } = {},
): PlannedMatch[] {
  const stage = optionen.stage ?? 'WINNERS';
  const anzahl = teilnehmer.length;
  if (anzahl < 2) {
    return [];
  }

  const groesse = bracketSize(anzahl);
  const reihenfolge = seedOrder(groesse);
  const runden = Math.log2(groesse);

  // Setzplatz -> Teilnehmer. Plaetze jenseits der Teilnehmerzahl bleiben leer.
  const nachPlatz = (platz: number): string | null =>
    platz <= anzahl ? (teilnehmer[platz - 1] ?? null) : null;

  const matches: PlannedMatch[] = [];

  // Erste Runde.
  for (let position = 1; position <= groesse / 2; position += 1) {
    const a = nachPlatz(reihenfolge[(position - 1) * 2]!);
    const b = nachPlatz(reihenfolge[(position - 1) * 2 + 1]!);
    matches.push({
      stage,
      round: 1,
      position,
      a,
      b,
      bye: (a === null) !== (b === null),
      winnerTo:
        runden > 1
          ? {
              stage,
              round: 2,
              position: Math.ceil(position / 2),
              slot: position % 2 === 1 ? 'A' : 'B',
            }
          : undefined,
    });
  }

  // Folgerunden.
  for (let runde = 2; runde <= runden; runde += 1) {
    const anzahlMatches = groesse / 2 ** runde;
    for (let position = 1; position <= anzahlMatches; position += 1) {
      matches.push({
        stage,
        round: runde,
        position,
        a: null,
        b: null,
        bye: false,
        winnerTo:
          runde < runden
            ? {
                stage,
                round: runde + 1,
                position: Math.ceil(position / 2),
                slot: position % 2 === 1 ? 'A' : 'B',
              }
            : undefined,
      });
    }
  }

  return loeseFreilose(matches);
}

/**
 * Freilose aufloesen.
 *
 * Ein Match mit nur einer Seite ist keins. Der Anwesende ruecke direkt in die
 * naechste Runde; das Freilos-Match verschwindet. Das kann eine Kette
 * ausloesen - bei drei Teilnehmern in einem Vierer-Bracket steht danach schon
 * jemand im Finale.
 */
function loeseFreilose(matches: PlannedMatch[]): PlannedMatch[] {
  const nachSchluessel = new Map<string, PlannedMatch>();
  const schluessel = (stage: BracketStage, round: number, position: number): string =>
    `${stage}:${round}:${position}`;

  for (const match of matches) {
    nachSchluessel.set(schluessel(match.stage, match.round, match.position), match);
  }

  // Runde fuer Runde, damit eine Kette in einem Durchgang ankommt.
  const runden = [...new Set(matches.map((match) => match.round))].sort((a, b) => a - b);
  const entfernt = new Set<PlannedMatch>();

  for (const runde of runden) {
    for (const match of matches.filter((eintrag) => eintrag.round === runde)) {
      if (entfernt.has(match)) {
        continue;
      }
      const besetzt = [match.a, match.b].filter((wert): wert is string => wert !== null);

      // Beide leer: das Match kann es nicht geben (mehr Plaetze als Leute).
      if (besetzt.length === 0 && match.round === 1) {
        entfernt.add(match);
        continue;
      }

      if (besetzt.length === 1 && match.round === 1) {
        const durchmarsch = besetzt[0]!;
        if (match.winnerTo) {
          const ziel = nachSchluessel.get(
            schluessel(match.winnerTo.stage, match.winnerTo.round, match.winnerTo.position),
          );
          if (ziel) {
            if (match.winnerTo.slot === 'A') {
              ziel.a = durchmarsch;
            } else {
              ziel.b = durchmarsch;
            }
            ziel.bye = (ziel.a === null) !== (ziel.b === null);
          }
        }
        entfernt.add(match);
        continue;
      }

      // Zweite Runde und spaeter: ein Platz kann durch die Aufloesung oben
      // besetzt worden sein, waehrend der andere nie kommt.
      if (match.round > 1) {
        const zufuehrende = matches.filter(
          (eintrag) =>
            !entfernt.has(eintrag) &&
            eintrag.winnerTo &&
            eintrag.winnerTo.stage === match.stage &&
            eintrag.winnerTo.round === match.round &&
            eintrag.winnerTo.position === match.position,
        );
        const offeneSlots = new Set(zufuehrende.map((eintrag) => eintrag.winnerTo!.slot));

        const aFehlt = match.a === null && !offeneSlots.has('A');
        const bFehlt = match.b === null && !offeneSlots.has('B');

        if (aFehlt && bFehlt) {
          entfernt.add(match);
          continue;
        }
        if ((aFehlt && match.b !== null) || (bFehlt && match.a !== null)) {
          const durchmarsch = (match.a ?? match.b)!;
          if (match.winnerTo) {
            const ziel = nachSchluessel.get(
              schluessel(match.winnerTo.stage, match.winnerTo.round, match.winnerTo.position),
            );
            if (ziel) {
              if (match.winnerTo.slot === 'A') {
                ziel.a = durchmarsch;
              } else {
                ziel.b = durchmarsch;
              }
            }
          }
          entfernt.add(match);
        }
      }
    }
  }

  return matches
    .filter((match) => !entfernt.has(match))
    .map((match) => ({ ...match, bye: false }));
}

// --- Doppel-K.-o. ----------------------------------------------------------

/**
 * Double Elimination.
 *
 * Wer einmal verliert, faellt in die Verliererrunde; wer dort verliert, ist
 * draussen. Die Struktur der Verliererrunde wechselt zwischen zwei Arten:
 * ungerade Runden lassen die Gefallenen untereinander spielen, gerade Runden
 * stellen ihnen die frisch aus der Siegerrunde Gefallenen gegenueber.
 *
 * Die Reihenfolge, in der die Gefallenen einlaufen, ist gedreht. Das ist eine
 * Faustregel und keine Garantie: sie soll verhindern, dass zwei Teams sich
 * eine Runde spaeter gleich wieder gegenueberstehen.
 */
export function doubleElimination(teilnehmer: readonly string[]): PlannedMatch[] {
  const anzahl = teilnehmer.length;
  if (anzahl < 2) {
    return [];
  }

  const groesse = bracketSize(anzahl);
  const wbRunden = Math.log2(groesse);
  const wb = singleElimination(teilnehmer, { stage: 'WINNERS' });

  const matches: PlannedMatch[] = [...wb];

  // --- Verliererrunde aufbauen ---------------------------------------
  const lbRunden = Math.max(0, 2 * wbRunden - 2);
  const lbGroesse = new Map<number, number>();
  for (let i = 1; i <= wbRunden - 1; i += 1) {
    lbGroesse.set(2 * i - 1, groesse / 2 ** (i + 1));
    lbGroesse.set(2 * i, groesse / 2 ** (i + 1));
  }

  for (let runde = 1; runde <= lbRunden; runde += 1) {
    const anzahlMatches = lbGroesse.get(runde) ?? 0;
    for (let position = 1; position <= anzahlMatches; position += 1) {
      const naechsteGroesse = lbGroesse.get(runde + 1) ?? 0;
      matches.push({
        stage: 'LOSERS',
        round: runde,
        position,
        a: null,
        b: null,
        bye: false,
        winnerTo:
          runde < lbRunden
            ? {
                stage: 'LOSERS',
                round: runde + 1,
                position:
                  // Ungerade -> gerade: die Zahl der Matches bleibt gleich,
                  // der Sieger behaelt seinen Platz. Gerade -> ungerade: sie
                  // halbiert sich, also je zwei zusammen.
                  naechsteGroesse === anzahlMatches ? position : Math.ceil(position / 2),
                slot:
                  naechsteGroesse === anzahlMatches
                    ? 'A'
                    : position % 2 === 1
                      ? 'A'
                      : 'B',
              }
            : { stage: 'GRAND_FINAL', round: 1, position: 1, slot: 'B' },
      });
    }
  }

  // --- Gefallene aus der Siegerrunde einweisen ------------------------
  for (const match of matches) {
    if (match.stage !== 'WINNERS') {
      continue;
    }

    if (match.round === 1) {
      // Erste Runde: beide Gefallenen fuellen die erste Verliererrunde.
      const lbPosition = Math.ceil(match.position / 2);
      if ((lbGroesse.get(1) ?? 0) >= lbPosition) {
        match.loserTo = {
          stage: 'LOSERS',
          round: 1,
          position: lbPosition,
          slot: match.position % 2 === 1 ? 'A' : 'B',
        };
      } else {
        // Bei zwei Teilnehmern gibt es keine Verliererrunde.
        match.loserTo = { stage: 'GRAND_FINAL', round: 1, position: 1, slot: 'B' };
      }
      continue;
    }

    // Ab der zweiten Runde: in die gerade Verliererrunde 2*(r-1).
    const lbRunde = 2 * (match.round - 1);
    const anzahlDort = lbGroesse.get(lbRunde) ?? 0;
    if (anzahlDort === 0) {
      match.loserTo = { stage: 'GRAND_FINAL', round: 1, position: 1, slot: 'B' };
      continue;
    }

    // Gedrehte Reihenfolge gegen sofortige Wiederholungen.
    const position = anzahlDort - ((match.position - 1) % anzahlDort);
    match.loserTo = { stage: 'LOSERS', round: lbRunde, position, slot: 'B' };
  }

  // --- Grosses Finale -------------------------------------------------
  const wbFinale = matches.find(
    (match) => match.stage === 'WINNERS' && match.round === wbRunden,
  );
  if (wbFinale) {
    wbFinale.winnerTo = { stage: 'GRAND_FINAL', round: 1, position: 1, slot: 'A' };
  }

  matches.push({
    stage: 'GRAND_FINAL',
    round: 1,
    position: 1,
    a: null,
    b: null,
    bye: false,
  });

  return matches;
}

// --- Jeder gegen jeden -----------------------------------------------------

/**
 * Round Robin nach dem Kreisverfahren.
 *
 * Bei ungerader Teilnehmerzahl setzt in jeder Runde einer aus; das ist kein
 * Freilos-Match, sondern schlicht ein Spiel weniger.
 */
export function roundRobin(
  teilnehmer: readonly string[],
  optionen: { stage?: BracketStage; groupIndex?: number; startRound?: number } = {},
): PlannedMatch[] {
  const stage = optionen.stage ?? 'ROUND_ROBIN';
  const startRunde = optionen.startRound ?? 1;

  if (teilnehmer.length < 2) {
    return [];
  }

  // Ein Platzhalter macht die Zahl gerade; wer gegen ihn spielt, setzt aus.
  const feld: Array<string | null> = [...teilnehmer];
  if (feld.length % 2 === 1) {
    feld.push(null);
  }

  const anzahl = feld.length;
  const runden = anzahl - 1;
  const matches: PlannedMatch[] = [];

  let drehung = feld.slice(1);
  const fest = feld[0]!;

  for (let runde = 0; runde < runden; runde += 1) {
    const reihe: Array<[string | null, string | null]> = [[fest, drehung[drehung.length - 1] ?? null]];
    for (let paar = 0; paar < (anzahl - 2) / 2; paar += 1) {
      reihe.push([drehung[paar] ?? null, drehung[drehung.length - 2 - paar] ?? null]);
    }

    let position = 1;
    for (const [a, b] of reihe) {
      if (a === null || b === null) {
        continue;
      }
      matches.push({
        stage,
        round: startRunde + runde,
        position,
        a,
        b,
        bye: false,
        ...(optionen.groupIndex !== undefined ? { groupIndex: optionen.groupIndex } : {}),
      });
      position += 1;
    }

    drehung = [drehung[drehung.length - 1] ?? null, ...drehung.slice(0, -1)];
  }

  return matches;
}

// --- Gruppen ---------------------------------------------------------------

/**
 * Teilnehmer auf Gruppen verteilen.
 *
 * Schlangenlinie: 1 in Gruppe A, 2 in B, 3 in C, 4 in C, 5 in B, 6 in A ...
 * So verteilen sich die Gesetzten gleichmaessig, statt dass Gruppe A alle
 * starken und Gruppe D alle schwachen Teams bekommt.
 */
export function verteileAufGruppen(
  teilnehmer: readonly string[],
  gruppen: number,
): string[][] {
  if (gruppen < 1) {
    throw new Error('Es braucht mindestens eine Gruppe.');
  }
  const verteilt: string[][] = Array.from({ length: gruppen }, () => []);

  teilnehmer.forEach((eintrag, index) => {
    const reihe = Math.floor(index / gruppen);
    const spalte = index % gruppen;
    const ziel = reihe % 2 === 0 ? spalte : gruppen - 1 - spalte;
    verteilt[ziel]!.push(eintrag);
  });

  return verteilt;
}

export function gruppenphase(
  teilnehmer: readonly string[],
  gruppen: number,
): { gruppen: string[][]; matches: PlannedMatch[] } {
  const verteilt = verteileAufGruppen(teilnehmer, gruppen);
  const matches: PlannedMatch[] = [];

  for (const [index, gruppe] of verteilt.entries()) {
    matches.push(...roundRobin(gruppe, { stage: 'GROUPS', groupIndex: index }));
  }

  // Positionen je Runde ueber alle Gruppen hinweg eindeutig machen: die
  // Eindeutigkeit in der Datenbank haengt an (Abschnitt, Runde, Position).
  const zaehler = new Map<number, number>();
  for (const match of matches) {
    const naechste = (zaehler.get(match.round) ?? 0) + 1;
    zaehler.set(match.round, naechste);
    match.position = naechste;
  }

  return { gruppen: verteilt, matches };
}

// --- Schweizer System ------------------------------------------------------

/** Wie viele Runden ein Schweizer System bei dieser Teilnehmerzahl braucht. */
export function swissRunden(anzahl: number): number {
  if (anzahl < 2) {
    return 0;
  }
  return Math.max(1, Math.ceil(Math.log2(anzahl)));
}

export interface SwissBilanz {
  participantId: string;
  punkte: number;
  /** Gegen wen bereits gespielt wurde - Wiederholungen werden vermieden. */
  gegner: string[];
  /** Bereits einmal ausgesetzt? Zweimal soll niemand. */
  hatteFreilos: boolean;
}

/**
 * Die Paarungen einer Schweizer Runde.
 *
 * Anders als beim K.-o.-System laesst sich das nicht im Voraus planen: wer
 * gegen wen spielt, haengt am Stand nach der letzten Runde. Deshalb entsteht
 * hier immer nur die naechste Runde.
 *
 * Gepaart wird innerhalb gleicher Punktzahl, absteigend, unter Vermeidung von
 * Wiederholungen. Findet sich in einer Punktgruppe kein Gegner mehr, ruecke
 * der Uebriggebliebene in die naechsttiefere.
 */
export function swissPaarung(
  bilanzen: readonly SwissBilanz[],
  runde: number,
): PlannedMatch[] {
  const offen = [...bilanzen].sort((a, b) => b.punkte - a.punkte);
  const matches: PlannedMatch[] = [];
  const vergeben = new Set<string>();
  let position = 1;

  // Freilos zuerst: bei ungerader Zahl setzt der hinterste aus, der noch
  // keines hatte.
  if (offen.length % 2 === 1) {
    const kandidat =
      [...offen].reverse().find((eintrag) => !eintrag.hatteFreilos) ?? offen[offen.length - 1]!;
    vergeben.add(kandidat.participantId);
  }

  for (const eintrag of offen) {
    if (vergeben.has(eintrag.participantId)) {
      continue;
    }
    const gegner =
      offen.find(
        (kandidat) =>
          !vergeben.has(kandidat.participantId) &&
          kandidat.participantId !== eintrag.participantId &&
          !eintrag.gegner.includes(kandidat.participantId),
      ) ??
      // Notfall: lieber eine Wiederholung als niemand.
      offen.find(
        (kandidat) =>
          !vergeben.has(kandidat.participantId) &&
          kandidat.participantId !== eintrag.participantId,
      );

    if (!gegner) {
      continue;
    }

    vergeben.add(eintrag.participantId);
    vergeben.add(gegner.participantId);
    matches.push({
      stage: 'SWISS',
      round: runde,
      position,
      a: eintrag.participantId,
      b: gegner.participantId,
      bye: false,
    });
    position += 1;
  }

  return matches;
}

// --- Tabellen --------------------------------------------------------------

export interface TabellenZeile {
  participantId: string;
  gespielt: number;
  siege: number;
  unentschieden: number;
  niederlagen: number;
  punkte: number;
  /** Erzielte und erhaltene Punkte innerhalb der Matches. */
  erzielt: number;
  erhalten: number;
  differenz: number;
  /** Summe der Punkte aller Gegner - der Buchholz-Wert im Schweizer System. */
  buchholz: number;
  /** Ergebnisse gegen die direkten Konkurrenten. */
  direktvergleich: Map<string, number>;
}

export interface AbgeschlossenesMatch {
  aId: string | null;
  bId: string | null;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
}

export interface Punkteschema {
  win: number;
  draw: number;
  loss: number;
}

/** Die Tabelle einer Gruppe oder eines Schweizer Feldes. */
export function berechneTabelle(
  teilnehmer: readonly string[],
  matches: readonly AbgeschlossenesMatch[],
  punkte: Punkteschema,
): TabellenZeile[] {
  const zeilen = new Map<string, TabellenZeile>(
    teilnehmer.map((id) => [
      id,
      {
        participantId: id,
        gespielt: 0,
        siege: 0,
        unentschieden: 0,
        niederlagen: 0,
        punkte: 0,
        erzielt: 0,
        erhalten: 0,
        differenz: 0,
        buchholz: 0,
        direktvergleich: new Map<string, number>(),
      },
    ]),
  );

  for (const match of matches) {
    if (!match.aId || !match.bId) {
      continue;
    }
    const a = zeilen.get(match.aId);
    const b = zeilen.get(match.bId);
    if (!a || !b) {
      continue;
    }

    a.gespielt += 1;
    b.gespielt += 1;
    a.erzielt += match.scoreA;
    a.erhalten += match.scoreB;
    b.erzielt += match.scoreB;
    b.erhalten += match.scoreA;

    if (match.winnerId === match.aId) {
      a.siege += 1;
      b.niederlagen += 1;
      a.punkte += punkte.win;
      b.punkte += punkte.loss;
      a.direktvergleich.set(match.bId, (a.direktvergleich.get(match.bId) ?? 0) + 1);
      b.direktvergleich.set(match.aId, (b.direktvergleich.get(match.aId) ?? 0) - 1);
    } else if (match.winnerId === match.bId) {
      b.siege += 1;
      a.niederlagen += 1;
      b.punkte += punkte.win;
      a.punkte += punkte.loss;
      b.direktvergleich.set(match.aId, (b.direktvergleich.get(match.aId) ?? 0) + 1);
      a.direktvergleich.set(match.bId, (a.direktvergleich.get(match.bId) ?? 0) - 1);
    } else {
      a.unentschieden += 1;
      b.unentschieden += 1;
      a.punkte += punkte.draw;
      b.punkte += punkte.draw;
    }
  }

  for (const zeile of zeilen.values()) {
    zeile.differenz = zeile.erzielt - zeile.erhalten;
  }

  // Buchholz erst, wenn alle Punktzahlen stehen.
  for (const match of matches) {
    if (!match.aId || !match.bId) {
      continue;
    }
    const a = zeilen.get(match.aId);
    const b = zeilen.get(match.bId);
    if (!a || !b) {
      continue;
    }
    a.buchholz += b.punkte;
    b.buchholz += a.punkte;
  }

  return [...zeilen.values()];
}

export type Tiebreaker =
  | 'HEAD_TO_HEAD'
  | 'SCORE_DIFFERENCE'
  | 'SCORE_FOR'
  | 'WINS'
  | 'BUCHHOLZ';

/**
 * Die Tabelle sortieren.
 *
 * Punkte zuerst, danach die eingestellten Tiebreaker der Reihe nach. Bleibt
 * es gleich, bleibt es gleich: eine erfundene Reihenfolge waere schlimmer als
 * ein sichtbarer Gleichstand, den die Leitung entscheidet.
 */
export function sortiereTabelle(
  zeilen: readonly TabellenZeile[],
  tiebreakers: readonly string[],
): TabellenZeile[] {
  const vergleiche: Record<Tiebreaker, (a: TabellenZeile, b: TabellenZeile) => number> = {
    // `direktvergleich.get(b)` ist +1, wenn a gegen b gewonnen hat. Sortiert
    // wird aufsteigend, der Bessere zuerst - also muss der Sieger einen
    // negativen Wert liefern.
    HEAD_TO_HEAD: (a, b) => -(a.direktvergleich.get(b.participantId) ?? 0),
    SCORE_DIFFERENCE: (a, b) => b.differenz - a.differenz,
    SCORE_FOR: (a, b) => b.erzielt - a.erzielt,
    WINS: (a, b) => b.siege - a.siege,
    BUCHHOLZ: (a, b) => b.buchholz - a.buchholz,
  };

  return [...zeilen].sort((a, b) => {
    if (b.punkte !== a.punkte) {
      return b.punkte - a.punkte;
    }
    for (const name of tiebreakers) {
      const vergleich = vergleiche[name as Tiebreaker];
      if (!vergleich) {
        continue;
      }
      const ergebnis = vergleich(a, b);
      if (ergebnis !== 0) {
        return ergebnis;
      }
    }
    return 0;
  });
}

/**
 * Wer aus den Gruppen weiterkommt.
 *
 * Die Gruppensieger zuerst, dann die Zweiten und so fort - so trifft in der
 * ersten K.-o.-Runde ein Erster auf einen Letzten der Qualifizierten und
 * nicht zwei Gruppensieger aufeinander.
 */
export function qualifikanten(
  tabellenJeGruppe: readonly (readonly TabellenZeile[])[],
  proGruppe: number,
): string[] {
  const nachRang: string[] = [];
  for (let rang = 0; rang < proGruppe; rang += 1) {
    for (const tabelle of tabellenJeGruppe) {
      const zeile = tabelle[rang];
      if (zeile) {
        nachRang.push(zeile.participantId);
      }
    }
  }
  return nachRang;
}
