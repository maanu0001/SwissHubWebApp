/**
 * Rechnen mit benannten Zeitzonen.
 *
 * Der Kern ist die Verschiebung gegenüber UTC, und die ist kein fester Wert:
 * in Zürich sind es im Winter eine Stunde, im Sommer zwei. Wer mit einer
 * festen Zahl rechnet, liegt zweimal im Jahr daneben - und zwar genau an den
 * beiden Tagen, an denen es jemandem auffällt.
 *
 * Deshalb wird die Verschiebung nicht angenommen, sondern bei `Intl`
 * erfragt. Für die Rückrichtung - von einer Ortszeit auf den UTC-Zeitpunkt -
 * reicht ein Blick nicht: die Verschiebung hängt am Ergebnis, das man erst
 * sucht. Zwei Durchgänge lösen das für jeden Tag ausser der übersprungenen
 * Stunde selbst, und dort gibt es keine richtige Antwort, nur eine
 * nachvollziehbare.
 *
 * Diese Datei kennt keine bestimmte Zone. Wo SwissHub durchgängig Zürich
 * meint - Statistiken etwa - steht die Zone dort fest; der Kalender führt sie
 * je Termin, weil ein LAN in Berlin nicht in Zürcher Zeit stattfindet.
 */

const FORMATE = new Map<string, Intl.DateTimeFormat>();

function format(zone: string): Intl.DateTimeFormat {
  let vorhanden = FORMATE.get(zone);
  if (!vorhanden) {
    vorhanden = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    FORMATE.set(zone, vorhanden);
  }
  return vorhanden;
}

/** Kennt diese Laufzeitumgebung die Zone? */
export function istBekannteZeitzone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
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

export interface ZeitTeile {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
  /** 0 = Sonntag ... 6 = Samstag. */
  wochentag: number;
}

/** Zerlegt einen Zeitpunkt in die Bestandteile, die er in `zone` hat. */
export function teileIn(zeitpunkt: Date, zone: string): ZeitTeile {
  const teile = new Map(
    format(zone)
      .formatToParts(zeitpunkt)
      .map((teil) => [teil.type, teil.value] as const),
  );
  return {
    jahr: Number(teile.get('year')),
    monat: Number(teile.get('month')),
    tag: Number(teile.get('day')),
    // `24` an Mitternacht ist in manchen Umgebungen die Antwort von `hour12: false`.
    stunde: Number(teile.get('hour')) % 24,
    minute: Number(teile.get('minute')),
    wochentag: WOCHENTAGE[teile.get('weekday') ?? 'Sun'] ?? 0,
  };
}

/** Verschiebung der Zone gegenüber UTC an diesem Zeitpunkt, in Millisekunden. */
export function verschiebungMs(zeitpunkt: Date, zone: string): number {
  const t = teileIn(zeitpunkt, zone);
  const sekunden = Number(
    new Map(
      format(zone)
        .formatToParts(zeitpunkt)
        .map((teil) => [teil.type, teil.value] as const),
    ).get('second') ?? '0',
  );
  const alsUtc = Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, sekunden);
  return alsUtc - zeitpunkt.getTime();
}

/** `2026-09-04` - der Kalendertag, auf den der Zeitpunkt in `zone` fällt. */
export function tagesSchluesselIn(zeitpunkt: Date, zone: string): string {
  const t = teileIn(zeitpunkt, zone);
  return `${t.jahr}-${String(t.monat).padStart(2, '0')}-${String(t.tag).padStart(2, '0')}`;
}

/**
 * Eine Ortszeit als UTC-Zeitpunkt.
 *
 * Zwei Durchgänge: erst mit der Verschiebung am geratenen Zeitpunkt rechnen,
 * dann mit der Verschiebung am Ergebnis nachbessern. Der erste Durchgang
 * genügt an 363 Tagen im Jahr, der zweite an den übrigen beiden.
 */
export function ortszeitAlsUtc(
  zone: string,
  jahr: number,
  monat: number,
  tag: number,
  stunde = 0,
  minute = 0,
): Date {
  const alsUtc = Date.UTC(jahr, monat - 1, tag, stunde, minute, 0, 0);
  let kandidat = new Date(alsUtc - verschiebungMs(new Date(alsUtc), zone));
  kandidat = new Date(alsUtc - verschiebungMs(kandidat, zone));
  return kandidat;
}

/** Mitternacht des Kalendertags, auf den `zeitpunkt` in `zone` fällt. */
export function tagesBeginnIn(zeitpunkt: Date, zone: string): Date {
  const t = teileIn(zeitpunkt, zone);
  return ortszeitAlsUtc(zone, t.jahr, t.monat, t.tag);
}

/**
 * Mitternacht des Folgetags.
 *
 * Über 26 Stunden gerechnet: das liegt auch am 25-Stunden-Tag der
 * Rückstellung sicher im Folgetag.
 */
export function naechsterTagesBeginnIn(zeitpunkt: Date, zone: string): Date {
  const beginn = tagesBeginnIn(zeitpunkt, zone);
  return tagesBeginnIn(new Date(beginn.getTime() + 26 * 3600_000), zone);
}

/** Mitternacht des Tages `anzahl` Tage später - über Umstellungen hinweg. */
export function tageSpaeter(zeitpunkt: Date, zone: string, anzahl: number): Date {
  const t = teileIn(zeitpunkt, zone);
  return ortszeitAlsUtc(zone, t.jahr, t.monat, t.tag + anzahl);
}

/** Beginn der Woche (Montag) um Mitternacht. */
export function wochenBeginnIn(zeitpunkt: Date, zone: string): Date {
  const t = teileIn(zeitpunkt, zone);
  // Montag als erster Tag - so steht es in jedem Schweizer Kalender.
  const versatz = (t.wochentag + 6) % 7;
  return ortszeitAlsUtc(zone, t.jahr, t.monat, t.tag - versatz);
}

/** Erster Tag des Monats um Mitternacht. */
export function monatsBeginnIn(zeitpunkt: Date, zone: string): Date {
  const t = teileIn(zeitpunkt, zone);
  return ortszeitAlsUtc(zone, t.jahr, t.monat, 1);
}

/** Erster Tag des Folgemonats um Mitternacht. */
export function naechsterMonatsBeginnIn(zeitpunkt: Date, zone: string): Date {
  const t = teileIn(zeitpunkt, zone);
  return ortszeitAlsUtc(zone, t.jahr, t.monat + 1, 1);
}
