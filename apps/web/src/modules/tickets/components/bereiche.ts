/**
 * Arbeit und Einrichtung im Ticket-Modul.
 *
 * Ein Mitglied der Verwaltung sah zwoelf gleichwertige Reiter nebeneinander:
 * «Offene Tickets» stand genauso da wie «Panels», obwohl man das eine
 * mehrmals taeglich oeffnet und das andere zweimal im Jahr. Eine Leiste, in
 * der alles gleich wichtig aussieht, ist eine Leiste, die man jedes Mal ganz
 * liest.
 *
 * Hier steht die Unterscheidung - und nur sie. Welcher Bereich fuer wen
 * ueberhaupt sichtbar ist, entscheidet unveraendert `ticketSections` anhand
 * der Berechtigungen; diese Datei bekommt das Ergebnis und sortiert es auf
 * zwei Plaetze in derselben Kopfzeile.
 *
 * Die tragende Zusicherung: **jeder hereingegebene Bereich kommt genau einmal
 * wieder heraus.** Ein Bereich, der in keinem der beiden Toepfe landet, waere
 * aus der Oberflaeche verschwunden - ohne dass jemand ihn entfernt haette.
 */

/** Wozu ein Bereich gehoert. */
export type BereichsArt = 'arbeit' | 'einrichtung';

export interface TicketSection {
  href: string;
  label: string;
}

/**
 * Die Bereiche, die das Verhalten des Moduls einstellen.
 *
 * Nach Adresse und nicht nach Beschriftung: die Beschriftung ist Text fuer
 * Menschen und darf sich aendern, ohne dass ein Bereich dabei stillschweigend
 * die Seite wechselt.
 *
 * Was hier **nicht** steht, ist taegliche Arbeit - auch die Statistiken. Sie
 * stellen nichts ein, sie berichten; wer morgens nachsieht, wie das Team
 * dasteht, soll dafuer kein Zahnrad oeffnen muessen.
 */
const EINRICHTUNG: ReadonlySet<string> = new Set([
  '/tickets/schlagwoerter',
  '/tickets/vorlagen',
  '/tickets/kategorien',
  '/tickets/panels',
  '/tickets/sperren',
  '/modules/tickets',
]);

/** Gehoert dieser Bereich zur Einrichtung? */
export function istEinrichtung(href: string): boolean {
  return EINRICHTUNG.has(href);
}

export interface Aufteilung {
  /** Bleibt als Reiter stehen. */
  arbeit: TicketSection[];
  /** Wandert hinter das Zahnrad oben rechts. */
  einrichtung: TicketSection[];
}

/**
 * Teilt die sichtbaren Bereiche in taegliche Arbeit und Einrichtung.
 *
 * Die Reihenfolge bleibt in beiden Toepfen die der Eingabe: `ticketSections`
 * hat sie bereits sinnvoll gewaehlt, und eine zweite Sortierung hier waere
 * eine zweite Meinung darueber.
 */
export function teileBereiche(sections: readonly TicketSection[]): Aufteilung {
  return {
    arbeit: sections.filter((section) => !istEinrichtung(section.href)),
    einrichtung: sections.filter((section) => istEinrichtung(section.href)),
  };
}
