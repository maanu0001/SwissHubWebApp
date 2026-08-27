import type { CalendarEvent } from '@swisshub/database';
import { appUrl } from '@swisshub/config';
import { tagesBeginnIn, tageSpaeter } from '@swisshub/shared';
import { eventUrl, ortsZeile } from './discord';

/**
 * Termine als iCalendar-Datei.
 *
 * Bewusst ohne Zusatzpaket: der Standard (RFC 5545) verlangt fuer einen
 * einzelnen Termin wenig, und die vorhandenen Pakete braechten mehr
 * Abhaengigkeit als Nutzen.
 *
 * Zeiten gehen als UTC hinaus (`...Z`). Das ist die eine Schreibweise, die
 * ohne mitgelieferte Zeitzonendefinition ueberall dasselbe bedeutet: Apple
 * Kalender, Outlook und Google rechnen sie in die Ortszeit des Betrachters
 * um, und eine Sommerzeitumstellung zwischen Anlage und Termin verschiebt
 * nichts. Eine `VTIMEZONE`-Definition mitzugeben waere der andere gangbare
 * Weg - und deutlich mehr Text fuer dasselbe Ergebnis.
 */

/** Zeilenumbrueche und Sonderzeichen nach RFC 5545 entschaerfen. */
function escape(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r?\n/gu, '\\n');
}

/** `20260904T180000Z` */
function stempel(wert: Date): string {
  return `${wert.toISOString().replace(/[-:]/gu, '').split('.')[0]}Z`;
}

/** Nur das Datum - fuer ganztaegige Termine. */
function datumsStempel(wert: Date, timezone: string): string {
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(wert);
  return teile.replace(/-/gu, '');
}

/**
 * Zeilen auf 75 Oktette falten.
 *
 * Steht so im Standard, und Outlook nimmt es genau. Ohne das Falten
 * zerbricht eine lange Beschreibung die Datei.
 */
function falte(zeile: string): string {
  const bytes = Buffer.from(zeile, 'utf8');
  if (bytes.length <= 75) {
    return zeile;
  }
  const teile: string[] = [];
  let rest = zeile;
  let grenze = 74;
  while (Buffer.from(rest, 'utf8').length > grenze) {
    let schnitt = grenze;
    // Nicht mitten in ein Mehrbyte-Zeichen schneiden.
    while (Buffer.from(rest.slice(0, schnitt), 'utf8').length > grenze && schnitt > 0) {
      schnitt -= 1;
    }
    teile.push(rest.slice(0, schnitt));
    rest = rest.slice(schnitt);
    grenze = 73;
  }
  teile.push(rest);
  return teile.map((teil, index) => (index === 0 ? teil : ` ${teil}`)).join('\r\n');
}

export interface IcsOptions {
  /** Dauer in Minuten fuer Termine ohne Endzeit. */
  defaultDurationMinutes: number;
}

/**
 * Der Folgetag des letzten Tages - `DTEND` ist bei Datumsangaben
 * ausschliessend.
 *
 * Die eine Millisekunde Abzug ist der Kern: ein Ende um genau Mitternacht
 * gehoert noch zum Vortag. Ohne sie bekaeme ein Abend von 20 bis 24 Uhr im
 * Kalender zwei Tage - und ein ganztaegiges Event am Samstag reichte bis
 * Montag.
 */
function ganztagsEnde(event: CalendarEvent, ende: Date): Date {
  const ersterTag = tagesBeginnIn(event.startAt, event.timezone);
  const letzterTag = tagesBeginnIn(new Date(ende.getTime() - 1), event.timezone);
  const basis = letzterTag < ersterTag ? ersterTag : letzterTag;
  return tageSpaeter(basis, event.timezone, 1);
}

export function buildIcs(event: CalendarEvent, options: IcsOptions): string {
  const ende =
    event.endAt ?? new Date(event.startAt.getTime() + options.defaultDurationMinutes * 60_000);

  const zeiten = event.allDay
    ? [
        `DTSTART;VALUE=DATE:${datumsStempel(event.startAt, event.timezone)}`,
        `DTEND;VALUE=DATE:${datumsStempel(ganztagsEnde(event, ende), event.timezone)}`,
      ]
    : [`DTSTART:${stempel(event.startAt)}`, `DTEND:${stempel(ende)}`];

  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SwissHub//Community-Kalender//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stabil ueber Aenderungen hinweg: derselbe Termin ersetzt beim erneuten
    // Import den alten Eintrag, statt einen zweiten anzulegen.
    `UID:${event.id}@swisshub`,
    `DTSTAMP:${stempel(event.updatedAt)}`,
    ...zeiten,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(`${event.shortDescription ?? event.description}\n\n${eventUrl(event)}`)}`,
    `LOCATION:${escape(ortsZeile(event))}`,
    `URL:${eventUrl(event)}`,
    // Eine Absage verschwindet nicht aus dem Kalender des Teilnehmers,
    // sondern wird dort als abgesagt gefuehrt.
    `STATUS:${event.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SEQUENCE:${Math.floor(event.updatedAt.getTime() / 1000)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${zeilen.map(falte).join('\r\n')}\r\n`;
}

/** Dateiname fuer den Download - ohne Sonderzeichen. */
export function icsDateiname(event: CalendarEvent): string {
  const basis = event.slug.replace(/[^a-z0-9-]/giu, '') || 'event';
  return `swisshub-${basis}.ics`;
}

export const icsUrl = (event: Pick<CalendarEvent, 'slug'>): string =>
  appUrl(`/api/kalender/${event.slug}/ics`);
