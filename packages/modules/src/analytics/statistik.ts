import { prisma } from '@swisshub/database';
import { getModuleSettings } from '../module-state';
import { ANALYTICS_MODULE_ID, type AnalyticsSettings } from './config';
import { tag, tagesSchluessel, zuercherTeile } from './zeit';
import { tageZwischen, vergleiche, type Veraenderung, type Zeitraum } from './zeitraum';
import { trackingStand } from './zaehler';

/**
 * Die Statistik.
 *
 * Alles hier liest ausschliesslich aus den Aggregaten - nie aus der
 * Ereignistabelle. Das ist der Grund, warum die Seite auch bei zehn Millionen
 * Ereignissen in Sekundenbruchteilen antwortet: die teure Arbeit ist beim
 * Aufzeichnen schon geschehen.
 *
 * Die eine Ausnahme von «einfach summieren» sind die aktiven Mitglieder.
 * Eindeutige Personen ueber einen Monat sind **nicht** die Summe der
 * Tageswerte - wer an zwanzig Tagen schreibt, ist eine Person und nicht
 * zwanzig. Dafuer gibt es die Zeile je Person und Tag, und dafuer steht hier
 * ueberall `distinct` statt `sum`.
 */

/** Wann gilt jemand als aktiv - einmal definiert, nirgends neu erfunden. */
const AKTIV_BEDINGUNG = { OR: [{ messages: { gt: 0 } }, { voiceSeconds: { gt: 0 } }] };

export interface StatistikScope {
  guildId: string;
  zeitraum: Zeitraum;
  /** Bots mitzaehlen. Standard: nein. */
  mitBots?: boolean;
}

async function botFilter(mitBots: boolean | undefined, guildId: string): Promise<string[]> {
  if (mitBots) {
    return [];
  }
  const bots = await prisma.analyticsMemberProfile.findMany({
    where: { guildId, isBot: true },
    select: { discordId: true },
  });
  return bots.map((eintrag) => eintrag.discordId);
}

// --- Kennzahlen -------------------------------------------------------------

export interface Kennzahlen {
  mitglieder: number | null;
  nachrichten: Veraenderung;
  sprachSekunden: Veraenderung;
  neueMitglieder: Veraenderung;
  austritte: Veraenderung;
  nettoWachstum: Veraenderung;
  aktiveMitglieder: Veraenderung;
  /** Anteil aktiver an allen Mitgliedern. `null` ohne bekannte Mitgliederzahl. */
  aktivenAnteil: number | null;
  sprachSitzungen: Veraenderung;
  /** Durchschnitte im gewaehlten Zeitraum. */
  nachrichtenProAktivem: number | null;
  sprachSekundenProAktivem: number | null;
  nachrichtenProTag: number | null;
  sprachSekundenProTag: number | null;
  /** Verhaeltnis Beitritte zu Austritten - `null` bei zu duenner Grundlage. */
  beitrittsVerhaeltnis: number | null;
}

async function summen(guildId: string, von: Date, bis: Date) {
  const werte = await prisma.analyticsDaily.aggregate({
    where: { guildId, day: { gte: tag(von), lte: tag(bis) } },
    _sum: { messages: true, voiceSeconds: true, voiceSessions: true, joins: true, leaves: true },
  });
  return {
    messages: werte._sum.messages ?? 0,
    voiceSeconds: werte._sum.voiceSeconds ?? 0,
    voiceSessions: werte._sum.voiceSessions ?? 0,
    joins: werte._sum.joins ?? 0,
    leaves: werte._sum.leaves ?? 0,
  };
}

/**
 * Eindeutige aktive Mitglieder in einem Zeitraum.
 *
 * `distinct` und nicht `count`: Wer an zwanzig Tagen aktiv war, hat zwanzig
 * Zeilen und ist trotzdem eine Person.
 */
async function aktiveMitglieder(
  guildId: string,
  von: Date,
  bis: Date,
  ausgeschlossen: string[],
): Promise<number> {
  const zeilen = await prisma.analyticsUserDaily.findMany({
    where: {
      guildId,
      day: { gte: tag(von), lte: tag(bis) },
      ...AKTIV_BEDINGUNG,
      ...(ausgeschlossen.length > 0 ? { discordId: { notIn: ausgeschlossen } } : {}),
    },
    select: { discordId: true },
    distinct: ['discordId'],
  });
  return zeilen.length;
}

export async function kennzahlen(scope: StatistikScope): Promise<Kennzahlen> {
  const { guildId, zeitraum } = scope;
  const bots = await botFilter(scope.mitBots, guildId);

  const [jetztWerte, vorherWerte, aktivJetzt, aktivVorher, mitglieder] = await Promise.all([
    summen(guildId, zeitraum.von, zeitraum.bis),
    zeitraum.vergleichVon && zeitraum.vergleichBis
      ? summen(guildId, zeitraum.vergleichVon, zeitraum.vergleichBis)
      : Promise.resolve(null),
    aktiveMitglieder(guildId, zeitraum.von, zeitraum.bis, bots),
    zeitraum.vergleichVon && zeitraum.vergleichBis
      ? aktiveMitglieder(guildId, zeitraum.vergleichVon, zeitraum.vergleichBis, bots)
      : Promise.resolve(null),
    // Die letzte bekannte Mitgliederzahl - eine Momentaufnahme, kein Mittel.
    prisma.analyticsDaily.findFirst({
      where: { guildId, memberCount: { not: null } },
      orderBy: { day: 'desc' },
      select: { memberCount: true },
    }),
  ]);

  const tageImZeitraum = Math.max(
    1,
    Math.round((zeitraum.bis.getTime() - zeitraum.von.getTime()) / 86_400_000),
  );
  const netto = jetztWerte.joins - jetztWerte.leaves;
  const nettoVorher = vorherWerte ? vorherWerte.joins - vorherWerte.leaves : null;

  return {
    mitglieder: mitglieder?.memberCount ?? null,
    nachrichten: vergleiche(jetztWerte.messages, vorherWerte?.messages ?? null),
    sprachSekunden: vergleiche(jetztWerte.voiceSeconds, vorherWerte?.voiceSeconds ?? null),
    neueMitglieder: vergleiche(jetztWerte.joins, vorherWerte?.joins ?? null),
    austritte: vergleiche(jetztWerte.leaves, vorherWerte?.leaves ?? null),
    nettoWachstum: vergleiche(netto, nettoVorher),
    aktiveMitglieder: vergleiche(aktivJetzt, aktivVorher),
    aktivenAnteil:
      mitglieder?.memberCount && mitglieder.memberCount > 0
        ? Math.round((aktivJetzt / mitglieder.memberCount) * 1000) / 10
        : null,
    sprachSitzungen: vergleiche(jetztWerte.voiceSessions, vorherWerte?.voiceSessions ?? null),
    nachrichtenProAktivem: aktivJetzt > 0 ? Math.round(jetztWerte.messages / aktivJetzt) : null,
    sprachSekundenProAktivem: aktivJetzt > 0 ? Math.round(jetztWerte.voiceSeconds / aktivJetzt) : null,
    nachrichtenProTag: Math.round(jetztWerte.messages / tageImZeitraum),
    sprachSekundenProTag: Math.round(jetztWerte.voiceSeconds / tageImZeitraum),
    // Unter zehn Austritten sagt ein Verhaeltnis mehr ueber den Zufall als
    // ueber die Gemeinschaft.
    beitrittsVerhaeltnis:
      jetztWerte.leaves >= 10 ? Math.round((jetztWerte.joins / jetztWerte.leaves) * 10) / 10 : null,
  };
}

// --- Verläufe ---------------------------------------------------------------

export interface VerlaufPunkt {
  /** ISO-Zeitpunkt des Intervallbeginns. */
  zeit: string;
  /** Beschriftung fuer die Achse. */
  label: string;
  nachrichten: number;
  sprachSekunden: number;
  beitritte: number;
  austritte: number;
  mitglieder: number | null;
  aktive: number | null;
}

/**
 * Die Kennzahlen ueber die Zeit.
 *
 * Die Aufloesung richtet sich nach der Laenge des Zeitraums, nicht nach dem,
 * was gerade zur Hand ist: 8760 Stundenpunkte fuer ein Jahr sind nicht
 * genauer, sondern nur mehr.
 */
export async function verlauf(scope: StatistikScope): Promise<VerlaufPunkt[]> {
  const { guildId, zeitraum } = scope;
  const bots = await botFilter(scope.mitBots, guildId);

  if (zeitraum.granularitaet === 'hour') {
    const zeilen = await prisma.analyticsHourly.findMany({
      where: { guildId, hourStart: { gte: zeitraum.von, lte: zeitraum.bis } },
      orderBy: { hourStart: 'asc' },
    });
    return zeilen.map((zeile) => {
      const teile = zuercherTeile(zeile.hourStart);
      return {
        zeit: zeile.hourStart.toISOString(),
        label: `${String(teile.stunde).padStart(2, '0')}:00`,
        nachrichten: zeile.messages,
        sprachSekunden: zeile.voiceSeconds,
        beitritte: zeile.joins,
        austritte: zeile.leaves,
        mitglieder: null,
        // Aktive je Stunde waeren eine eigene Aggregation - hier bewusst
        // nicht behauptet statt geschaetzt.
        aktive: null,
      };
    });
  }

  const tage = await prisma.analyticsDaily.findMany({
    where: { guildId, day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) } },
    orderBy: { day: 'asc' },
  });

  // Aktive je Tag: eine Abfrage fuer alle Tage, dann im Speicher gruppiert -
  // eine Abfrage je Tag waeren bei einem Jahr 365 Rundreisen.
  const aktiveZeilen = await prisma.analyticsUserDaily.findMany({
    where: {
      guildId,
      day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) },
      ...AKTIV_BEDINGUNG,
      ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
    },
    select: { day: true, discordId: true },
  });
  const aktiveProTag = new Map<string, Set<string>>();
  for (const zeile of aktiveZeilen) {
    const schluessel = zeile.day.toISOString().slice(0, 10);
    const menge = aktiveProTag.get(schluessel) ?? new Set<string>();
    menge.add(zeile.discordId);
    aktiveProTag.set(schluessel, menge);
  }

  const punkte = tage.map((zeile) => {
    const schluessel = zeile.day.toISOString().slice(0, 10);
    return {
      zeit: zeile.day.toISOString(),
      label: schluessel.slice(8, 10) + '.' + schluessel.slice(5, 7) + '.',
      nachrichten: zeile.messages,
      sprachSekunden: zeile.voiceSeconds,
      beitritte: zeile.joins,
      austritte: zeile.leaves,
      mitglieder: zeile.memberCount,
      aktive: aktiveProTag.get(schluessel)?.size ?? 0,
    };
  });

  if (zeitraum.granularitaet !== 'week') {
    return punkte;
  }

  // Wochenweise zusammenfassen. Aktive lassen sich dabei **nicht** addieren -
  // dieselbe Person kann an mehreren Tagen der Woche aktiv gewesen sein.
  // Deshalb wird sie hier ueber die Kennungen neu bestimmt.
  const wochen = new Map<string, VerlaufPunkt & { aktiveMenge: Set<string> }>();
  for (const zeile of tage) {
    const schluessel = wochenSchluessel(zeile.day);
    const vorhanden = wochen.get(schluessel) ?? {
      zeit: zeile.day.toISOString(),
      label: schluessel,
      nachrichten: 0,
      sprachSekunden: 0,
      beitritte: 0,
      austritte: 0,
      mitglieder: null as number | null,
      aktive: 0,
      aktiveMenge: new Set<string>(),
    };
    vorhanden.nachrichten += zeile.messages;
    vorhanden.sprachSekunden += zeile.voiceSeconds;
    vorhanden.beitritte += zeile.joins;
    vorhanden.austritte += zeile.leaves;
    // Mitgliederzahl: der letzte bekannte Stand der Woche, keine Summe.
    vorhanden.mitglieder = zeile.memberCount ?? vorhanden.mitglieder;
    wochen.set(schluessel, vorhanden);
  }
  for (const zeile of aktiveZeilen) {
    const schluessel = wochenSchluessel(zeile.day);
    wochen.get(schluessel)?.aktiveMenge.add(zeile.discordId);
  }

  return [...wochen.values()].map(({ aktiveMenge, ...punkt }) => ({
    ...punkt,
    aktive: aktiveMenge.size,
  }));
}

/** Kalenderwoche als `KW 34 / 2026`. */
function wochenSchluessel(datum: Date): string {
  const kopie = new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()));
  const wochentag = kopie.getUTCDay() || 7;
  kopie.setUTCDate(kopie.getUTCDate() + 4 - wochentag);
  const jahresBeginn = new Date(Date.UTC(kopie.getUTCFullYear(), 0, 1));
  const woche = Math.ceil(((kopie.getTime() - jahresBeginn.getTime()) / 86_400_000 + 1) / 7);
  return `KW ${woche} / ${kopie.getUTCFullYear()}`;
}

// --- Ranglisten -------------------------------------------------------------

export interface RanglisteEintrag {
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  nachrichten: number;
  sprachSekunden: number;
  sprachSitzungen: number;
  /** Anteil an der Gesamtsumme des Zeitraums, in Prozent. */
  anteil: number;
}

/**
 * Die aktivsten Mitglieder.
 *
 * `groupBy` ueber die Tageszeilen statt ueber Ereignisse: das sind bei einem
 * Jahr und tausend aktiven Personen ein paar hunderttausend Zeilen statt
 * Millionen, und der Index traegt sie.
 */
export async function topMitglieder(
  scope: StatistikScope,
  nach: 'messages' | 'voice',
  limit = 10,
): Promise<RanglisteEintrag[]> {
  const { guildId, zeitraum } = scope;
  const bots = await botFilter(scope.mitBots, guildId);

  const zeilen = await prisma.analyticsUserDaily.groupBy({
    by: ['discordId'],
    where: {
      guildId,
      day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) },
      ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
      ...(nach === 'messages' ? { messages: { gt: 0 } } : { voiceSeconds: { gt: 0 } }),
    },
    _sum: { messages: true, voiceSeconds: true, voiceSessions: true },
    orderBy: nach === 'messages' ? { _sum: { messages: 'desc' } } : { _sum: { voiceSeconds: 'desc' } },
    take: Math.min(limit, 50),
  });

  const [gesamt, profile] = await Promise.all([
    summen(guildId, zeitraum.von, zeitraum.bis),
    // Namen in einer Abfrage statt einer je Zeile.
    prisma.analyticsMemberProfile.findMany({
      where: { guildId, discordId: { in: zeilen.map((zeile) => zeile.discordId) } },
      select: { discordId: true, username: true, displayName: true, avatarHash: true },
    }),
  ]);
  const nachId = new Map(profile.map((eintrag) => [eintrag.discordId, eintrag]));
  const nenner = nach === 'messages' ? gesamt.messages : gesamt.voiceSeconds;

  return zeilen.map((zeile) => {
    const wert = nach === 'messages' ? (zeile._sum.messages ?? 0) : (zeile._sum.voiceSeconds ?? 0);
    const person = nachId.get(zeile.discordId);
    return {
      discordId: zeile.discordId,
      username: person?.username ?? null,
      displayName: person?.displayName ?? null,
      avatarHash: person?.avatarHash ?? null,
      nachrichten: zeile._sum.messages ?? 0,
      sprachSekunden: zeile._sum.voiceSeconds ?? 0,
      sprachSitzungen: zeile._sum.voiceSessions ?? 0,
      anteil: nenner > 0 ? Math.round((wert / nenner) * 1000) / 10 : 0,
    };
  });
}

export interface KanalEintrag {
  channelId: string;
  channelName: string | null;
  parentId: string | null;
  nachrichten: number;
  sprachSekunden: number;
  anteil: number;
  /** Veraenderung gegenueber dem Vergleichszeitraum. */
  veraenderung: Veraenderung;
}

export async function topKanaele(
  scope: StatistikScope,
  kind: 'TEXT' | 'VOICE',
  limit = 10,
): Promise<KanalEintrag[]> {
  const { guildId, zeitraum } = scope;
  const feld = kind === 'TEXT' ? 'messages' : 'voiceSeconds';

  const [zeilen, vorherZeilen, gesamt] = await Promise.all([
    prisma.analyticsChannelDaily.groupBy({
      by: ['channelId'],
      where: { guildId, kind, day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) } },
      _sum: { messages: true, voiceSeconds: true },
      orderBy: { _sum: { [feld]: 'desc' } },
      take: Math.min(limit, 50),
    }),
    zeitraum.vergleichVon && zeitraum.vergleichBis
      ? prisma.analyticsChannelDaily.groupBy({
          by: ['channelId'],
          where: {
            guildId,
            kind,
            day: { gte: tag(zeitraum.vergleichVon), lte: tag(zeitraum.vergleichBis) },
          },
          _sum: { messages: true, voiceSeconds: true },
        })
      : Promise.resolve([]),
    summen(guildId, zeitraum.von, zeitraum.bis),
  ]);

  // Namen kommen aus der juengsten Zeile - ein umbenannter Kanal soll unter
  // seinem heutigen Namen erscheinen.
  const namen = await prisma.analyticsChannelDaily.findMany({
    where: { guildId, channelId: { in: zeilen.map((zeile) => zeile.channelId) } },
    orderBy: { day: 'desc' },
    select: { channelId: true, channelName: true, parentId: true },
    distinct: ['channelId'],
  });
  const namenNach = new Map(namen.map((eintrag) => [eintrag.channelId, eintrag]));
  const vorherNach = new Map(
    vorherZeilen.map((zeile) => [
      zeile.channelId,
      kind === 'TEXT' ? (zeile._sum.messages ?? 0) : (zeile._sum.voiceSeconds ?? 0),
    ]),
  );

  const nenner = kind === 'TEXT' ? gesamt.messages : gesamt.voiceSeconds;

  return zeilen.map((zeile) => {
    const wert = kind === 'TEXT' ? (zeile._sum.messages ?? 0) : (zeile._sum.voiceSeconds ?? 0);
    return {
      channelId: zeile.channelId,
      channelName: namenNach.get(zeile.channelId)?.channelName ?? null,
      parentId: namenNach.get(zeile.channelId)?.parentId ?? null,
      nachrichten: zeile._sum.messages ?? 0,
      sprachSekunden: zeile._sum.voiceSeconds ?? 0,
      anteil: nenner > 0 ? Math.round((wert / nenner) * 1000) / 10 : 0,
      veraenderung: vergleiche(wert, vorherNach.get(zeile.channelId) ?? null, 50),
    };
  });
}

// --- Aktivitätszeiten -------------------------------------------------------

export interface HeatmapZelle {
  /** 0 = Sonntag ... 6 = Samstag. */
  wochentag: number;
  stunde: number;
  nachrichten: number;
  sprachSekunden: number;
}

export interface Heatmap {
  zellen: HeatmapZelle[];
  /** Spitzenwerte fuer die Faerbung. */
  maxNachrichten: number;
  maxSprachSekunden: number;
  /** Aktivster Wochentag und aktivste Stunde - `null` ohne Daten. */
  spitzeNachrichten: { wochentag: number; stunde: number } | null;
  spitzeSprache: { wochentag: number; stunde: number } | null;
}

/**
 * Wann ist auf dem Server am meisten los?
 *
 * Wochentag und Stunde werden in Zuercher Zeit bestimmt. In UTC laege der
 * Feierabend im Sommer eine Stunde anders als im Winter, und die Spitze
 * verteilte sich auf zwei Balken.
 */
export async function heatmap(scope: StatistikScope): Promise<Heatmap> {
  const zeilen = await prisma.analyticsHourly.findMany({
    where: { guildId: scope.guildId, hourStart: { gte: scope.zeitraum.von, lte: scope.zeitraum.bis } },
    select: { hourStart: true, messages: true, voiceSeconds: true },
  });

  const raster = new Map<string, HeatmapZelle>();
  for (let wochentag = 0; wochentag < 7; wochentag += 1) {
    for (let stunde = 0; stunde < 24; stunde += 1) {
      raster.set(`${wochentag}-${stunde}`, { wochentag, stunde, nachrichten: 0, sprachSekunden: 0 });
    }
  }

  for (const zeile of zeilen) {
    const teile = zuercherTeile(zeile.hourStart);
    const zelle = raster.get(`${teile.wochentag}-${teile.stunde}`);
    if (zelle) {
      zelle.nachrichten += zeile.messages;
      zelle.sprachSekunden += zeile.voiceSeconds;
    }
  }

  const zellen = [...raster.values()];
  const spitze = (feld: 'nachrichten' | 'sprachSekunden') => {
    const beste = zellen.reduce((a, b) => (b[feld] > a[feld] ? b : a), zellen[0]!);
    return beste[feld] > 0 ? { wochentag: beste.wochentag, stunde: beste.stunde } : null;
  };

  return {
    zellen,
    maxNachrichten: Math.max(0, ...zellen.map((zelle) => zelle.nachrichten)),
    maxSprachSekunden: Math.max(0, ...zellen.map((zelle) => zelle.sprachSekunden)),
    spitzeNachrichten: spitze('nachrichten'),
    spitzeSprache: spitze('sprachSekunden'),
  };
}

// --- Nutzungsart ------------------------------------------------------------

export interface Nutzungsart {
  nurText: number;
  nurSprache: number;
  beides: number;
  /** Mitglieder ohne Aktivitaet - `null` ohne bekannte Mitgliederzahl. */
  inaktiv: number | null;
}

/** Schreiben, sprechen oder beides - wie wird der Server benutzt? */
export async function nutzungsart(scope: StatistikScope): Promise<Nutzungsart> {
  const { guildId, zeitraum } = scope;
  const bots = await botFilter(scope.mitBots, guildId);

  const zeilen = await prisma.analyticsUserDaily.groupBy({
    by: ['discordId'],
    where: {
      guildId,
      day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) },
      ...AKTIV_BEDINGUNG,
      ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
    },
    _sum: { messages: true, voiceSeconds: true },
  });

  let nurText = 0;
  let nurSprache = 0;
  let beides = 0;
  for (const zeile of zeilen) {
    const hatText = (zeile._sum.messages ?? 0) > 0;
    const hatSprache = (zeile._sum.voiceSeconds ?? 0) > 0;
    if (hatText && hatSprache) {
      beides += 1;
    } else if (hatText) {
      nurText += 1;
    } else if (hatSprache) {
      nurSprache += 1;
    }
  }

  const mitglieder = await prisma.analyticsDaily.findFirst({
    where: { guildId, memberCount: { not: null } },
    orderBy: { day: 'desc' },
    select: { memberCount: true },
  });
  const gesamt = mitglieder?.memberCount ?? null;

  return {
    nurText,
    nurSprache,
    beides,
    inaktiv: gesamt === null ? null : Math.max(0, gesamt - (nurText + nurSprache + beides)),
  };
}

// --- Neue Mitglieder --------------------------------------------------------

export interface NeuMitglieder {
  /** Beigetretene im Zeitraum. */
  beigetreten: number;
  /** Davon innerhalb von sieben Tagen aktiv geworden. */
  aktiviert: number;
  aktivierungsQuote: number | null;
  /** Mittlere Zeit bis zur ersten Aeusserung, in Sekunden. */
  zeitBisAktivitaet: number | null;
  /** Anteil der vor 7/30/90 Tagen Beigetretenen, die noch da sind. */
  bindung: Array<{ tage: number; kohorte: number; geblieben: number; quote: number | null }>;
}

/**
 * Wie gut kommen neue Mitglieder an?
 *
 * Alle drei Zahlen brauchen einen bekannten Beitritt. Wer schon vor Beginn
 * der Aufzeichnung da war, hat keinen - und faellt deshalb heraus, statt die
 * Quote mit einem geratenen Datum zu verfaelschen.
 */
export async function neueMitglieder(scope: StatistikScope): Promise<NeuMitglieder> {
  const { guildId, zeitraum } = scope;
  const AKTIVIERUNGS_FENSTER_MS = 7 * 86_400_000;

  const kohorte = await prisma.analyticsMemberProfile.findMany({
    where: {
      guildId,
      isBot: false,
      joinedAt: { gte: zeitraum.von, lte: zeitraum.bis },
    },
    select: { joinedAt: true, firstActivityAt: true },
  });

  const mitAktivitaet = kohorte.filter(
    (eintrag) =>
      eintrag.joinedAt &&
      eintrag.firstActivityAt &&
      eintrag.firstActivityAt.getTime() - eintrag.joinedAt.getTime() <= AKTIVIERUNGS_FENSTER_MS,
  );
  const abstaende = mitAktivitaet.map((eintrag) =>
    Math.max(0, (eintrag.firstActivityAt as Date).getTime() - (eintrag.joinedAt as Date).getTime()),
  );

  /**
   * Bindung als echte Kohorte.
   *
   * Die Frage lautet: «Von denen, die vor N Tagen beigetreten sind - wie
   * viele waren N Tage spaeter noch da?» Entscheidend ist das **jeweils
   * eigene** N-Tage-Datum jedes Mitglieds, nicht der heutige Stichtag. Wer
   * nur zaehlt, wer heute noch da ist, misst fuer die 7- und die 90-Tage-
   * Marke fast dieselbe Gruppe und bekommt drei Zahlen, die alle dasselbe
   * sagen.
   *
   * In die Kohorte kommt nur, wer die Marke ueberhaupt erreichen konnte -
   * wer gestern beigetreten ist, hat noch keine 30-Tage-Bindung.
   */
  const bindung = await Promise.all(
    [7, 30, 90].map(async (tage) => {
      const spaetestensBeigetreten = new Date(Date.now() - tage * 86_400_000);
      const kohorteZeilen = await prisma.analyticsMemberProfile.findMany({
        where: {
          guildId,
          isBot: false,
          joinedAt: { lte: spaetestensBeigetreten, not: null },
        },
        select: { joinedAt: true, leftAt: true },
      });

      const geblieben = kohorteZeilen.filter((eintrag) => {
        const marke = (eintrag.joinedAt as Date).getTime() + tage * 86_400_000;
        // Noch da, oder erst nach der Marke gegangen.
        return !eintrag.leftAt || eintrag.leftAt.getTime() > marke;
      }).length;

      return {
        tage,
        kohorte: kohorteZeilen.length,
        geblieben,
        // Unter zwanzig Personen sagt eine Quote mehr ueber den Zufall aus.
        quote: kohorteZeilen.length >= 20 ? Math.round((geblieben / kohorteZeilen.length) * 1000) / 10 : null,
      };
    }),
  );

  return {
    beigetreten: kohorte.length,
    aktiviert: mitAktivitaet.length,
    aktivierungsQuote:
      kohorte.length >= 10 ? Math.round((mitAktivitaet.length / kohorte.length) * 1000) / 10 : null,
    zeitBisAktivitaet:
      abstaende.length >= 5
        ? Math.round(abstaende.reduce((a, b) => a + b, 0) / abstaende.length / 1000)
        : null,
    bindung,
  };
}

// --- Wiederkehrende ---------------------------------------------------------

export interface Wiederkehrende {
  aktiv: number;
  wiederkehrend: number;
  neuAktiv: number;
  quote: number | null;
}

/** Wie viele der Aktiven waren auch im Zeitraum davor schon aktiv? */
export async function wiederkehrende(scope: StatistikScope): Promise<Wiederkehrende | null> {
  const { guildId, zeitraum } = scope;
  if (!zeitraum.vergleichVon || !zeitraum.vergleichBis) {
    return null;
  }
  const bots = await botFilter(scope.mitBots, guildId);

  const lade = async (von: Date, bis: Date): Promise<Set<string>> => {
    const zeilen = await prisma.analyticsUserDaily.findMany({
      where: {
        guildId,
        day: { gte: tag(von), lte: tag(bis) },
        ...AKTIV_BEDINGUNG,
        ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
      },
      select: { discordId: true },
      distinct: ['discordId'],
    });
    return new Set(zeilen.map((zeile) => zeile.discordId));
  };

  const [jetzt, vorher] = await Promise.all([
    lade(zeitraum.von, zeitraum.bis),
    lade(zeitraum.vergleichVon, zeitraum.vergleichBis),
  ]);

  const wiederkehrendeAnzahl = [...jetzt].filter((id) => vorher.has(id)).length;
  return {
    aktiv: jetzt.size,
    wiederkehrend: wiederkehrendeAnzahl,
    neuAktiv: jetzt.size - wiederkehrendeAnzahl,
    quote: jetzt.size >= 10 ? Math.round((wiederkehrendeAnzahl / jetzt.size) * 1000) / 10 : null,
  };
}

// --- Datenlage --------------------------------------------------------------

export interface Datenlage {
  /** Beginn der Aufzeichnung insgesamt. */
  seit: Date | null;
  nachrichtenSeit: Date | null;
  spracheSeit: Date | null;
  /** Liegt der gewaehlte Zeitraum teilweise vor dem Beginn? */
  unvollstaendig: boolean;
  /** Ab wann im gewaehlten Zeitraum es Daten gibt. */
  abgedeckenAb: Date | null;
  /** Gibt es ueberhaupt schon Zahlen? */
  leer: boolean;
}

/**
 * Was die Zahlen ueberhaupt abdecken koennen.
 *
 * Die wichtigste Auskunft der ganzen Seite. Ohne sie sieht eine Null fuer den
 * letzten Januar aus wie «es war nichts los» - dabei heisst sie «wir haben
 * damals noch nicht gezaehlt». Die Statistik erfindet keine Vergangenheit.
 */
export async function datenlage(guildId: string, zeitraum: Zeitraum): Promise<Datenlage> {
  const [stand, ersterTag] = await Promise.all([
    trackingStand(guildId),
    prisma.analyticsDaily.findFirst({
      where: { guildId },
      orderBy: { day: 'asc' },
      select: { day: true },
    }),
  ]);

  const seit = stand?.startedAt ?? ersterTag?.day ?? null;
  const unvollstaendig = Boolean(seit && zeitraum.von < seit);

  return {
    seit,
    nachrichtenSeit: stand?.messagesSince ?? null,
    spracheSeit: stand?.voiceSince ?? null,
    unvollstaendig,
    abgedeckenAb: unvollstaendig ? seit : zeitraum.von,
    leer: !ersterTag,
  };
}

// --- Laufende Werte ---------------------------------------------------------

export interface HeuteWerte {
  nachrichten: number;
  sprachSekunden: number;
  beitritte: number;
  austritte: number;
  /** Wer gerade im Sprachkanal sitzt. */
  imSprachkanal: number;
  aktive: number;
}

/**
 * Die Zahlen des laufenden Tages.
 *
 * Getrennt von den Zeitraumkennzahlen, weil sie sich staendig aendern und
 * deshalb kuerzer zwischengespeichert werden duerfen als ein abgeschlossener
 * Monat.
 */
export async function heute(guildId: string, mitBots = false): Promise<HeuteWerte> {
  const heuteWert = tag(new Date());
  const bots = await botFilter(mitBots, guildId);

  const [zeile, aktive, imKanal] = await Promise.all([
    prisma.analyticsDaily.findUnique({ where: { guildId_day: { guildId, day: heuteWert } } }),
    prisma.analyticsUserDaily.findMany({
      where: {
        guildId,
        day: heuteWert,
        ...AKTIV_BEDINGUNG,
        ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
      },
      select: { discordId: true },
      distinct: ['discordId'],
    }),
    prisma.analyticsVoiceSegment.findMany({
      where: { guildId, leftAt: null, ...(mitBots ? {} : { isBot: false }) },
      select: { discordId: true },
      distinct: ['discordId'],
    }),
  ]);

  return {
    nachrichten: zeile?.messages ?? 0,
    sprachSekunden: zeile?.voiceSeconds ?? 0,
    beitritte: zeile?.joins ?? 0,
    austritte: zeile?.leaves ?? 0,
    imSprachkanal: imKanal.length,
    aktive: aktive.length,
  };
}

/** Die Einstellungen, soweit die Statistik sie braucht. */
export async function statistikEinstellungen(): Promise<{ mitBots: boolean }> {
  const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
  return { mitBots: settings.logBots };
}

export { tagesSchluessel, tageZwischen };
