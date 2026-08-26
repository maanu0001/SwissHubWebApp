import { naechsterTagesBeginn, tagesBeginn, tagesSchluessel, zuercherMitternacht } from './zeit';

/**
 * Der gewaehlte Zeitraum - und der davor.
 *
 * Der Vergleichszeitraum ist genau gleich lang und liegt unmittelbar davor.
 * «Letzte 30 Tage» vergleicht sich also mit den 30 Tagen davor, nicht mit dem
 * Vormonat: ein Vormonat hat 28 bis 31 Tage, und ein Vergleich zwischen
 * ungleich langen Zeitraeumen misst vor allem die Laenge.
 */

export const ZEITRAUM_VORGABEN = [
  { id: '24h', label: '24 Stunden', stunden: 24 },
  { id: '7d', label: '7 Tage', stunden: 24 * 7 },
  { id: '30d', label: '30 Tage', stunden: 24 * 30 },
  { id: '90d', label: '90 Tage', stunden: 24 * 90 },
  { id: '1y', label: '1 Jahr', stunden: 24 * 365 },
  { id: 'all', label: 'Gesamt', stunden: null },
] as const;

export type ZeitraumId = (typeof ZEITRAUM_VORGABEN)[number]['id'] | 'custom';

/** Aufloesung der Verlaufsgrafiken. */
export type Granularitaet = 'hour' | 'day' | 'week';

export interface Zeitraum {
  id: ZeitraumId;
  label: string;
  von: Date;
  bis: Date;
  /** Der gleich lange Zeitraum davor - `null` bei «Gesamt». */
  vergleichVon: Date | null;
  vergleichBis: Date | null;
  granularitaet: Granularitaet;
}

export interface ZeitraumEingabe {
  id?: string;
  /** `YYYY-MM-DD`, nur bei `custom`. */
  von?: string;
  bis?: string;
  /** Frueheste Daten - begrenzt «Gesamt» auf das, was es wirklich gibt. */
  datenBeginn?: Date | null;
  jetzt?: Date;
}

/**
 * Waehlt die Aufloesung nach der Laenge des Zeitraums.
 *
 * Nicht der Schoenheit wegen: ein Jahr in Stunden waeren 8760 Punkte, die
 * niemand unterscheiden kann und die trotzdem alle durch die Leitung muessen.
 */
export function granularitaetFuer(vonMs: number, bisMs: number): Granularitaet {
  const stunden = (bisMs - vonMs) / 3600_000;
  if (stunden <= 48) {
    return 'hour';
  }
  if (stunden <= 24 * 120) {
    return 'day';
  }
  return 'week';
}

/** Loest die Auswahl in konkrete Zeitpunkte auf. */
export function aufloesen(eingabe: ZeitraumEingabe = {}): Zeitraum {
  const jetzt = eingabe.jetzt ?? new Date();

  if (eingabe.id === 'custom' && eingabe.von && eingabe.bis) {
    const von = zuercherMitternacht(eingabe.von);
    // Das «bis» schliesst den gewaehlten Tag ein - wer den 31. waehlt, will
    // den 31. dabeihaben und nicht bis zu seinem Anfang.
    const bis = naechsterTagesBeginn(zuercherMitternacht(eingabe.bis));
    const gueltig = von < bis;
    const echterBis = gueltig ? (bis < jetzt ? bis : jetzt) : jetzt;
    const echterVon = gueltig ? von : new Date(jetzt.getTime() - 30 * 86_400_000);
    const dauer = echterBis.getTime() - echterVon.getTime();

    return {
      id: 'custom',
      label: `${eingabe.von} bis ${eingabe.bis}`,
      von: echterVon,
      bis: echterBis,
      vergleichVon: new Date(echterVon.getTime() - dauer),
      vergleichBis: echterVon,
      granularitaet: granularitaetFuer(echterVon.getTime(), echterBis.getTime()),
    };
  }

  const vorgabe =
    ZEITRAUM_VORGABEN.find((eintrag) => eintrag.id === eingabe.id) ??
    ZEITRAUM_VORGABEN.find((eintrag) => eintrag.id === '30d');

  if (!vorgabe || vorgabe.stunden === null) {
    // «Gesamt» beginnt beim ersten Datenpunkt, nicht bei der Servergruendung.
    // Es gibt keinen Vergleichszeitraum davor - dort war schlicht nichts.
    const von = eingabe.datenBeginn ?? new Date(jetzt.getTime() - 30 * 86_400_000);
    return {
      id: 'all',
      label: 'Gesamt',
      von,
      bis: jetzt,
      vergleichVon: null,
      vergleichBis: null,
      granularitaet: granularitaetFuer(von.getTime(), jetzt.getTime()),
    };
  }

  const von = new Date(jetzt.getTime() - vorgabe.stunden * 3600_000);
  const dauer = jetzt.getTime() - von.getTime();

  return {
    id: vorgabe.id,
    label: vorgabe.label,
    von,
    bis: jetzt,
    vergleichVon: new Date(von.getTime() - dauer),
    vergleichBis: von,
    granularitaet: granularitaetFuer(von.getTime(), jetzt.getTime()),
  };
}

export interface Veraenderung {
  /** Wert im gewaehlten Zeitraum. */
  wert: number;
  /** Wert im Zeitraum davor - `null`, wenn es keinen gibt. */
  vorher: number | null;
  /** Prozentuale Veraenderung - `null`, wenn sie nichts aussagt. */
  prozent: number | null;
  richtung: 'auf' | 'ab' | 'gleich' | 'unbekannt';
}

/**
 * Vergleicht zwei Werte.
 *
 * Die Sonderfaelle sind der eigentliche Inhalt: von 0 auf 5 ist kein
 * Wachstum von unendlich Prozent, sondern «vorher gab es nichts». Und eine
 * winzige Grundlage - 1 auf 3 - als «+200 %» zu feiern, ist eine Zahl, die
 * mehr verspricht, als sie weiss.
 */
export function vergleiche(wert: number, vorher: number | null, mindestBasis = 5): Veraenderung {
  if (vorher === null) {
    return { wert, vorher: null, prozent: null, richtung: 'unbekannt' };
  }
  if (wert === vorher) {
    return { wert, vorher, prozent: 0, richtung: 'gleich' };
  }
  const richtung = wert > vorher ? 'auf' : 'ab';
  if (vorher < mindestBasis) {
    // Richtung ja, Prozentzahl nein.
    return { wert, vorher, prozent: null, richtung };
  }
  return {
    wert,
    vorher,
    prozent: Math.round(((wert - vorher) / vorher) * 1000) / 10,
    richtung,
  };
}

/** Alle Kalendertage eines Zeitraums als `YYYY-MM-DD`. */
export function tageZwischen(von: Date, bis: Date, grenze = 800): string[] {
  const tage: string[] = [];
  let laufend = tagesBeginn(von);
  for (let schutz = 0; schutz < grenze && laufend < bis; schutz += 1) {
    tage.push(tagesSchluessel(laufend));
    laufend = naechsterTagesBeginn(laufend);
  }
  return tage;
}
