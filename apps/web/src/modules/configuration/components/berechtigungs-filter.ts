/**
 * Suchen und filtern in der Berechtigungsmatrix.
 *
 * Eine Rolle kann ueber zweihundert Berechtigungen tragen. Als eine Liste
 * gelesen sagt sie wenig: man sucht «darf diese Rolle Tickets schliessen?»
 * und blaettert an zweihundert Zeilen vorbei, von denen die allermeisten
 * dieselbe Antwort geben.
 *
 * Hier steht deshalb nur, **welche Zeilen** gezeigt werden - nicht, was sie
 * bedeuten. Ob eine Berechtigung erlaubt ist und woher, entscheidet weiterhin
 * `explainPermission` aus der Engine; diese Datei liest deren Ergebnis und
 * legt es beiseite oder nicht. Eine zweite Regel im Browser liefe irgendwann
 * auseinander, und dann zeigte die Oberflaeche etwas anderes an als das, was
 * beim Speichern gilt.
 *
 * Reine Funktionen, kein React, keine Engine: so laesst sich pruefen, dass
 * ueber alle Filter zusammen jede Berechtigung erreichbar bleibt.
 */

/** Die Herkunft eines Zustands, wie sie die Engine benennt. */
export type Herkunft = 'EXPLICIT_ALLOW' | 'EXPLICIT_DENY' | 'FULL_ACCESS' | 'WILDCARD' | 'NOT_GRANTED';

/**
 * Die Filter der Matrix.
 *
 * `erlaubt` meint ausdruecklich erteilt, `geerbt` durch Vollzugriff oder eine
 * Wildcard eingeschlossen. Die Trennung ist keine Spitzfindigkeit: nur das
 * ausdruecklich Erteilte laesst sich zuruecknehmen, das Geerbte wird zur
 * Ausnahme. Wer aufraeumen will, sucht das eine; wer verstehen will, warum
 * jemand etwas darf, das andere.
 */
export type FilterId = 'alle' | 'erlaubt' | 'verweigert' | 'geerbt';

export const FILTER: readonly { id: FilterId; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'erlaubt', label: 'Erlaubt' },
  { id: 'verweigert', label: 'Verweigert' },
  { id: 'geerbt', label: 'Geerbt' },
] as const;

/** Was ein Eintrag mindestens mitbringen muss, um gefiltert zu werden. */
export interface Eintrag {
  key: string;
  label: string;
  description: string;
  module: string;
}

/**
 * Passt dieser Zustand zum gewaehlten Filter?
 *
 * `alle` laesst alles durch - auch das nie Erteilte. Ohne diesen Fall waere
 * eine Berechtigung, die noch niemand hat, ueber keinen Filter erreichbar,
 * und man koennte sie nicht erteilen.
 */
export function passtZuFilter(herkunft: Herkunft, filter: FilterId): boolean {
  switch (filter) {
    case 'alle':
      return true;
    case 'erlaubt':
      return herkunft === 'EXPLICIT_ALLOW';
    case 'verweigert':
      return herkunft === 'EXPLICIT_DENY';
    case 'geerbt':
      return herkunft === 'FULL_ACCESS' || herkunft === 'WILDCARD';
  }
}

/**
 * Passt dieser Eintrag zur Suche?
 *
 * Gesucht wird in Beschriftung, Schluessel und Beschreibung - der Schluessel,
 * weil in einem Fehlerprotokoll `tickets.close` steht und nicht «Ticket
 * schliessen»; die Beschreibung, weil man den Namen einer Berechtigung selten
 * kennt, ihre Wirkung aber schon. Leere Suche heisst «alles».
 */
export function passtZurSuche(eintrag: Eintrag, suche: string): boolean {
  const gesucht = suche.trim().toLowerCase();
  if (gesucht === '') {
    return true;
  }
  return (
    eintrag.label.toLowerCase().includes(gesucht) ||
    eintrag.key.toLowerCase().includes(gesucht) ||
    eintrag.description.toLowerCase().includes(gesucht)
  );
}

/**
 * «Modul sehen» steht in jeder Gruppe zuoberst.
 *
 * Alphabetisch landete es irgendwo in der Mitte, und es ist die Berechtigung,
 * ohne die keine andere dieser Gruppe jemandem etwas nuetzt.
 */
function reihenfolge<T extends Eintrag>(eintraege: readonly T[]): T[] {
  return [...eintraege].sort((a, b) => {
    const aSehen = a.key.endsWith('.module.view');
    const bSehen = b.key.endsWith('.module.view');
    return aSehen === bSehen ? 0 : aSehen ? -1 : 1;
  });
}

/**
 * Gruppiert die passenden Berechtigungen nach Modul.
 *
 * Gruppen, in denen nach dem Filtern nichts uebrig bleibt, fallen weg - eine
 * Ueberschrift ohne Zeilen darunter ist eine Zeile mehr zu lesen und keine
 * Auskunft. Die Reihenfolge der Module folgt der Eingabe, damit dieselbe
 * Matrix nicht bei jedem Tastendruck anders sortiert erscheint.
 */
export function gruppiere<T extends Eintrag>(
  eintraege: readonly T[],
  suche: string,
  filter: FilterId,
  herkunftVon: (eintrag: T) => Herkunft,
): [string, T[]][] {
  const gruppen = new Map<string, T[]>();
  for (const eintrag of eintraege) {
    if (!passtZurSuche(eintrag, suche)) {
      continue;
    }
    if (!passtZuFilter(herkunftVon(eintrag), filter)) {
      continue;
    }
    gruppen.set(eintrag.module, [...(gruppen.get(eintrag.module) ?? []), eintrag]);
  }
  return [...gruppen.entries()].map(([modul, liste]) => [modul, reihenfolge(liste)]);
}

/**
 * Wie viele Berechtigungen jeder Filter gerade zeigen wuerde.
 *
 * Die Zahl steht an der Schaltflaeche. Ohne sie klickt man auf «Verweigert»
 * und sieht eine leere Liste, ohne zu wissen, ob das an der Suche liegt oder
 * daran, dass es keine Ausnahmen gibt. Die laufende Suche zaehlt mit, denn
 * genau diese Frage stellt sich waehrend des Suchens.
 */
export function zaehleFilter<T extends Eintrag>(
  eintraege: readonly T[],
  suche: string,
  herkunftVon: (eintrag: T) => Herkunft,
): Record<FilterId, number> {
  const zahlen: Record<FilterId, number> = { alle: 0, erlaubt: 0, verweigert: 0, geerbt: 0 };
  for (const eintrag of eintraege) {
    if (!passtZurSuche(eintrag, suche)) {
      continue;
    }
    const herkunft = herkunftVon(eintrag);
    for (const { id } of FILTER) {
      if (passtZuFilter(herkunft, id)) {
        zahlen[id] += 1;
      }
    }
  }
  return zahlen;
}
