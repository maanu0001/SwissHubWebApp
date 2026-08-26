/**
 * Zeitrechnung der Statistik.
 *
 * Alles wird in UTC gespeichert und in **Europe/Zurich** ausgewertet. Das ist
 * kein Schoenheitsdetail: ein Server, auf dem abends am meisten los ist, haette
 * seinen Hoehepunkt in UTC je nach Jahreszeit um 19 oder um 20 Uhr - die
 * Heatmap zeigte zwei Balken, wo einer hingehoert.
 *
 * Zwei Groessen, zwei Behandlungen:
 *
 * - **Stunden** decken sich. Zuerich liegt auf vollen Stunden zu UTC (+1/+2),
 *   deshalb ist der Beginn einer Zuercher Stunde zugleich der Beginn einer
 *   UTC-Stunde. Gespeichert wird die UTC-Instanz.
 * - **Tage** decken sich nicht. Ein Zuercher Tag beginnt um 22:00 oder 23:00
 *   UTC des Vortags, und am Sommerzeitwechsel ist er 23 oder 25 Stunden lang.
 *   Gespeichert wird deshalb das Kalenderdatum als reines Datum, nicht ein
 *   Zeitpunkt.
 */

export const ZEITZONE = 'Europe/Zurich';

const DATUM_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZEITZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TEILE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZEITZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  weekday: 'short',
});

/** Kalendertag in Zuerich als `YYYY-MM-DD`. */
export function tagesSchluessel(zeitpunkt: Date): string {
  return DATUM_FORMAT.format(zeitpunkt);
}

/**
 * Kalendertag als reines Datum.
 *
 * Mitternacht UTC, aber gemeint ist das Datum, nicht der Zeitpunkt - so
 * speichert Prisma eine `@db.Date`-Spalte. Wer daraus wieder eine Uhrzeit
 * liest, liest sie falsch.
 */
export function tag(zeitpunkt: Date): Date {
  return new Date(`${tagesSchluessel(zeitpunkt)}T00:00:00.000Z`);
}

/** Beginn der Stunde, in der dieser Zeitpunkt liegt (UTC-Instanz). */
export function stunde(zeitpunkt: Date): Date {
  const kopie = new Date(zeitpunkt);
  kopie.setUTCMinutes(0, 0, 0);
  return kopie;
}

export interface ZuercherTeile {
  jahr: number;
  monat: number;
  tagImMonat: number;
  stunde: number;
  /** 0 = Sonntag, 1 = Montag ... 6 = Samstag. */
  wochentag: number;
}

const WOCHENTAGE: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Zerlegt einen Zeitpunkt in seine Zuercher Bestandteile. */
export function zuercherTeile(zeitpunkt: Date): ZuercherTeile {
  const teile = new Map(
    TEILE_FORMAT.formatToParts(zeitpunkt).map((teil) => [teil.type, teil.value] as const),
  );
  return {
    jahr: Number(teile.get('year')),
    monat: Number(teile.get('month')),
    tagImMonat: Number(teile.get('day')),
    // `24` an Mitternacht ist in manchen Umgebungen die Antwort von `hour12: false`.
    stunde: Number(teile.get('hour')) % 24,
    wochentag: WOCHENTAGE[teile.get('weekday') ?? 'Sun'] ?? 0,
  };
}

/**
 * Der Zeitpunkt, an dem der Zuercher Kalendertag von `zeitpunkt` beginnt.
 *
 * Ueber die Verschiebung berechnet statt ueber eine feste Stundenzahl: die
 * Verschiebung ist im Sommer eine andere als im Winter, und genau an den zwei
 * Umstellungstagen im Jahr faellt eine feste Zahl auf die Nase.
 */
export function tagesBeginn(zeitpunkt: Date): Date {
  const schluessel = tagesSchluessel(zeitpunkt);
  return zuercherMitternacht(schluessel);
}

/** Der naechste Tagesbeginn nach `zeitpunkt`. */
export function naechsterTagesBeginn(zeitpunkt: Date): Date {
  const beginn = tagesBeginn(zeitpunkt);
  // 26 Stunden weiter liegt sicher im Folgetag, auch am 25-Stunden-Tag der
  // Rueckstellung. Der Tagesbeginn davon ist der gesuchte.
  return tagesBeginn(new Date(beginn.getTime() + 26 * 3600_000));
}

/**
 * Mitternacht eines Zuercher Kalendertages als UTC-Zeitpunkt.
 *
 * Sucht die Verschiebung, indem sie geprueft wird: erst mit der Vermutung
 * rechnen, dann nachsehen, ob das Ergebnis wirklich auf dem gewuenschten Tag
 * um 00 Uhr liegt. An den Umstellungstagen stimmt der erste Versuch nicht,
 * der zweite immer.
 */
export function zuercherMitternacht(tagesSchluesselWert: string): Date {
  const [jahr, monat, tagWert] = tagesSchluesselWert.split('-').map(Number);
  const alsUtc = Date.UTC(jahr ?? 1970, (monat ?? 1) - 1, tagWert ?? 1, 0, 0, 0, 0);

  // Erste Naeherung: die Verschiebung an diesem UTC-Zeitpunkt.
  let kandidat = new Date(alsUtc - verschiebungMs(new Date(alsUtc)));
  // Zweiter Durchgang mit der Verschiebung am Kandidaten selbst - noetig an
  // den beiden Umstellungstagen.
  kandidat = new Date(alsUtc - verschiebungMs(kandidat));

  return kandidat;
}

/** Verschiebung Zuerich gegenueber UTC in Millisekunden. */
function verschiebungMs(zeitpunkt: Date): number {
  const teile = new Map(
    TEILE_FORMAT.formatToParts(zeitpunkt).map((teil) => [teil.type, teil.value] as const),
  );
  const alsUtc = Date.UTC(
    Number(teile.get('year')),
    Number(teile.get('month')) - 1,
    Number(teile.get('day')),
    Number(teile.get('hour')) % 24,
    Number(teile.get('minute')),
    Number(teile.get('second')),
  );
  return alsUtc - zeitpunkt.getTime();
}

export interface Bucket<T> {
  schluessel: T;
  von: Date;
  bis: Date;
  sekunden: number;
}

/**
 * Verteilt eine Zeitspanne auf Zuercher Kalendertage.
 *
 * Eine Sprachsitzung von 23:30 bis 01:30 gehoert nicht einem Tag, sondern zu
 * 30 Minuten dem einen und zu 90 Minuten dem naechsten. Wer sie ganz dem
 * Starttag zuschriebe, haette an jedem Abend zu viel und an jedem Morgen zu
 * wenig.
 */
export function aufTageVerteilen(von: Date, bis: Date): Array<Bucket<string>> {
  if (bis <= von) {
    return [];
  }
  const eimer: Array<Bucket<string>> = [];
  let laufend = von;

  // Obergrenze gegen eine kaputte Zeitspanne: mehr als drei Jahre Sitzung gibt
  // es nicht, und eine Endlosschleife im Aufraeumjob waere schlimmer als eine
  // fehlende Zeile.
  for (let schutz = 0; schutz < 1200 && laufend < bis; schutz += 1) {
    const grenze = naechsterTagesBeginn(laufend);
    const ende = grenze < bis ? grenze : bis;
    eimer.push({
      schluessel: tagesSchluessel(laufend),
      von: laufend,
      bis: ende,
      sekunden: Math.round((ende.getTime() - laufend.getTime()) / 1000),
    });
    laufend = ende;
  }
  return eimer;
}

/** Verteilt eine Zeitspanne auf Stunden. */
export function aufStundenVerteilen(von: Date, bis: Date): Array<Bucket<Date>> {
  if (bis <= von) {
    return [];
  }
  const eimer: Array<Bucket<Date>> = [];
  let laufend = von;

  for (let schutz = 0; schutz < 100_000 && laufend < bis; schutz += 1) {
    const beginn = stunde(laufend);
    const grenze = new Date(beginn.getTime() + 3600_000);
    const ende = grenze < bis ? grenze : bis;
    eimer.push({
      schluessel: beginn,
      von: laufend,
      bis: ende,
      sekunden: Math.round((ende.getTime() - laufend.getTime()) / 1000),
    });
    laufend = ende;
  }
  return eimer;
}
