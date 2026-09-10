/**
 * Was auf dem Dashboard oben steht - und was darunter.
 *
 * Das Dashboard beantwortete bisher genau eine Frage: «welche Zahlen gibt es?»
 * Fuenf gleich grosse Karten nebeneinander, die Mitgliederzahl so laut wie die
 * Zahl der Leute, die auf eine Entscheidung warten. Beides sind Zahlen; nur
 * eine davon ist eine Aufgabe.
 *
 * Hier steht die Unterscheidung, und zwar als reine Funktion: keine Datenbank,
 * keine Berechtigungen, keine Darstellung. Was jemand ueberhaupt sehen darf,
 * ist vorher entschieden - diese Datei bekommt nur noch, was sichtbar ist, und
 * sortiert es. Damit laesst sich pruefen, dass beim Sortieren nichts verloren
 * geht, ohne eine Seite zu rendern.
 *
 * Die eine Zusicherung, die alles traegt: **jede hereingegebene Kennzahl kommt
 * genau einmal wieder heraus.** Eine Kennzahl, die weder wichtig noch Kontext
 * ist, waere still verschwunden - und eine verschwundene Zahl ist schlimmer
 * als eine schlecht platzierte.
 */

/** Die Kennzahlen des Dashboards. */
export type KennzahlId = 'mitglieder' | 'jails' | 'verifikationen' | 'bot' | 'aktionen';

/** Die Schnellaktionen des Dashboards. */
export type AktionId =
  'verifikation' | 'ticket' | 'spielersuche' | 'musik' | 'jail' | 'mitglieder' | 'audit' | 'einstellungen';

/**
 * Der Zustand, an dem sich «wichtig» entscheidet.
 *
 * `null` heisst durchgehend «diese Person darf es nicht wissen» - nicht
 * «null». Die Unterscheidung kommt aus `loadDashboardData` und wird hier
 * beibehalten: eine Null waere eine Auskunft ueber den Server, die ein
 * gewoehnliches Mitglied nichts angeht.
 */
export interface Lage {
  jailsAktiv: number | null;
  verifikationenOffen: number | null;
  botOnline: boolean;
}

/**
 * Verlangt diese Kennzahl gerade eine Handlung?
 *
 * Nicht «ist sie interessant», sondern «muss jemand etwas tun». Die
 * Mitgliederzahl ist immer interessant und nie eine Aufgabe; ein Bot, der
 * offline ist, ist immer eine.
 *
 * Der Zustand entscheidet, nicht die Art der Kennzahl: dieselbe Jail-Karte ist
 * wichtig, solange jemand einsitzt, und blosser Kontext, wenn niemand
 * einsitzt. Deshalb keine feste Liste «diese drei sind wichtig».
 */
export function istDringend(id: KennzahlId, lage: Lage): boolean {
  switch (id) {
    case 'bot':
      return !lage.botOnline;
    case 'verifikationen':
      return (lage.verifikationenOffen ?? 0) > 0;
    case 'jails':
      return (lage.jailsAktiv ?? 0) > 0;
    case 'mitglieder':
    case 'aktionen':
      return false;
  }
}

/**
 * Die Rangfolge innerhalb des wichtigen Bereichs.
 *
 * Ein Bot, der nicht laeuft, macht jede andere Zahl auf dieser Seite
 * gegenstandslos - deshalb zuoberst. Danach die Menschen, die auf eine
 * Entscheidung warten; sie merken das Warten. Erst dann ein Zustand, der
 * ohnehin von selbst weiterlaeuft.
 */
const WICHTIG_RANG: Record<KennzahlId, number> = {
  bot: 0,
  verifikationen: 1,
  jails: 2,
  mitglieder: 3,
  aktionen: 4,
};

export interface Aufteilung<T> {
  /** Gehoert nach oben: verlangt eine Handlung. */
  wichtig: T[];
  /** Bleibt sichtbar, aber als Zeile statt als Karte. */
  kontext: T[];
}

/**
 * Teilt die sichtbaren Kennzahlen in «jetzt wichtig» und «Kontext».
 *
 * `sichtbar` ist bereits gefiltert: was jemand nicht sehen darf, steht gar
 * nicht drin. Hier wird nur noch einsortiert - und nichts weggelassen. Der
 * Kontext behaelt seine urspruengliche Reihenfolge, damit die Zeile nicht bei
 * jedem Seitenaufruf anders aussieht, nur weil eine Zahl gestiegen ist.
 */
export function teileKennzahlen(sichtbar: readonly KennzahlId[], lage: Lage): Aufteilung<KennzahlId> {
  const wichtig = sichtbar
    .filter((id) => istDringend(id, lage))
    .sort((a, b) => WICHTIG_RANG[a] - WICHTIG_RANG[b]);
  const kontext = sichtbar.filter((id) => !istDringend(id, lage));
  return { wichtig, kontext };
}

/**
 * Die Rangfolge der Schnellaktionen.
 *
 * Zuerst, was auf jemanden wartet (die Warteschlange, sobald etwas drin
 * liegt). Dann, was man erstellt - das ist die Frage «was kann ich als
 * Naechstes tun?». Zuletzt die Wege, die man auch ueber die Seitenleiste
 * findet: eine Schnellaktion, die nur eine zweite Tuer zu einem
 * Navigationseintrag ist, gehoert nach unten, nicht weg.
 */
const AKTION_RANG: Record<AktionId, number> = {
  verifikation: 1,
  ticket: 2,
  spielersuche: 3,
  jail: 4,
  musik: 5,
  mitglieder: 6,
  audit: 7,
  einstellungen: 8,
};

/**
 * Bringt die Schnellaktionen in ihre Reihenfolge.
 *
 * Die Warteschlange rueckt an die Spitze, sobald tatsaechlich etwas offen ist
 * - und faellt auf ihren gewoehnlichen Platz zurueck, wenn nicht. Eine
 * Schaltflaeche «Warteschlange (0 offen)» ganz oben waere eine Aufgabe, die
 * es nicht gibt.
 *
 * Es wird nur sortiert. Wer acht Aktionen hineingibt, bekommt acht heraus.
 */
export function ordneAktionen(sichtbar: readonly AktionId[], lage: Lage): AktionId[] {
  const dringend = (lage.verifikationenOffen ?? 0) > 0;
  const rang = (id: AktionId): number => (id === 'verifikation' && dringend ? 0 : AKTION_RANG[id]);
  return [...sichtbar].sort((a, b) => rang(a) - rang(b));
}
