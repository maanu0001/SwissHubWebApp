/**
 * Zeitpunkte fuer `<input type="datetime-local">`.
 *
 * Bewusst in einem eigenen Modul ohne `'use client'`: die Umrechnung wird auf
 * beiden Seiten gebraucht - die Bearbeitungsseite fuellt damit das Formular
 * (Server), das Formular selbst liest sie zurueck (Browser). Stuende sie in
 * der Formulardatei, waere sie eine Client-Funktion, und ein Aufruf vom
 * Server bricht zur Laufzeit ab: der Uebersetzer sieht das nicht, weil der
 * Typ stimmt.
 */

/** Einen Zeitpunkt fuer das Feld schreiben - in Ortszeit, ohne Zone. */
export function fuerZeitfeld(zeitpunkt: Date | null): string {
  if (!zeitpunkt) {
    return '';
  }
  const versetzt = new Date(zeitpunkt.getTime() - zeitpunkt.getTimezoneOffset() * 60_000);
  return versetzt.toISOString().slice(0, 16);
}

/**
 * Was das Feld liefert, als ISO-Zeitpunkt.
 *
 * `datetime-local` gibt Ortszeit ohne Zone. `new Date(...)` legt die Zone des
 * Browsers zugrunde - genau das, was jemand meint, der «20:00» eintippt.
 */
export function ausZeitfeld(wert: string): string | null {
  if (wert.trim() === '') {
    return null;
  }
  const zeitpunkt = new Date(wert);
  return Number.isNaN(zeitpunkt.getTime()) ? null : zeitpunkt.toISOString();
}
