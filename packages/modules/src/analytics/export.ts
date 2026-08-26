import type { DiscordEvent } from '@swisshub/database';
import type { EventOhneInhalt } from './queries';

/**
 * CSV-Ausgabe des gefilterten Verlaufs.
 *
 * Zwei Dinge, die leicht falsch gemacht werden:
 *
 * **Formeln.** Ein Feld, das mit `=`, `+`, `-` oder `@` beginnt, fuehrt
 * Excel und LibreOffice als Formel aus. Ein Discord-Nutzername darf so
 * anfangen, und dann liefe fremder Text als Formel auf dem Rechner dessen,
 * der exportiert hat. Deshalb bekommt jedes solche Feld ein vorangestelltes
 * Apostroph.
 *
 * **Inhalte.** Die Textspalten erscheinen nur, wenn der Exportierende sie
 * auch sehen darf. Ein Export ist keine Hintertuer um die Berechtigung herum.
 */

const KOPF_OHNE_INHALT = [
  'Zeitpunkt',
  'Kategorie',
  'Typ',
  'Schwere',
  'Verursacher',
  'Verursacher-ID',
  'Zuordnung',
  'Betroffen',
  'Betroffen-ID',
  'Kanal',
  'Nachricht-ID',
] as const;

const KOPF_MIT_INHALT = [...KOPF_OHNE_INHALT, 'Vorher', 'Nachher'] as const;

/** Neutralisiert Formeln und maskiert nach RFC 4180. */
function feld(wert: unknown): string {
  if (wert === null || wert === undefined) {
    return '';
  }
  let text = wert instanceof Date ? wert.toISOString() : String(wert);
  if (/^[=+\-@\t\r]/u.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(zeilen: Array<DiscordEvent | EventOhneInhalt>, mitInhalten: boolean): string {
  const kopf = mitInhalten ? KOPF_MIT_INHALT : KOPF_OHNE_INHALT;
  const reihen = zeilen.map((zeile) => {
    const werte: unknown[] = [
      zeile.occurredAt,
      zeile.category,
      zeile.type,
      zeile.severity,
      zeile.actorUsername,
      zeile.actorDiscordId,
      zeile.actorSource,
      zeile.subjectUsername,
      zeile.subjectDiscordId,
      zeile.channelName,
      zeile.messageId,
    ];
    if (mitInhalten) {
      const mitText = zeile as DiscordEvent;
      werte.push(mitText.contentBefore, mitText.contentAfter);
    }
    return werte.map(feld).join(',');
  });

  // BOM voran, damit Excel die Umlaute als UTF-8 liest statt als Latin-1.
  // Als Escape geschrieben: als unsichtbares Zeichen im Quelltext waere es
  // beim naechsten Lesen ein Raetsel.
  const bom = '\uFEFF';
  return `${bom}${[kopf.map(feld).join(','), ...reihen].join('\r\n')}\r\n`;
}
