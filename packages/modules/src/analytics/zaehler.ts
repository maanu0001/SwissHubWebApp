import { randomUUID } from 'node:crypto';
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { ANALYTICS_MODULE_ID, type AnalyticsSettings } from './config';
import { aufStundenVerteilen, aufTageVerteilen, stunde, tag } from './zeit';

const log = createLogger('analytics:zaehler');

/**
 * Das Fortschreiben der Statistik.
 *
 * Die Zahlen entstehen beim Aufzeichnen, nicht beim Anschauen. Eine
 * Statistikseite, die Millionen Ereigniszeilen bei jedem Aufruf durchrechnet,
 * ist am ersten Tag schnell und nach einem Jahr unbenutzbar.
 *
 * Drei Grundsaetze:
 *
 * 1. **Kein Inhalt.** Fuer eine Nachrichtenzahl braucht es den Text nicht.
 *    Was nicht gelesen wird, kann auch nicht auslaufen.
 * 2. **Nichts darf den Bot anhalten.** Jeder Aufruf faengt selbst; eine
 *    misslungene Zaehlung darf keine Nachricht verschlucken.
 * 3. **Sekunden landen dort, wo sie vergangen sind.** Eine Sprachsitzung von
 *    23:30 bis 01:30 gehoert zu 30 Minuten dem einen Tag und zu 90 Minuten
 *    dem naechsten - nicht ganz dem Starttag.
 */

interface Grunddaten {
  guildId: string;
  discordId: string;
  isBot?: boolean;
}

/** Prueft Modul, Einstellungen und Bot-Filter in einem Schritt. */
async function darfZaehlen(
  guildId: string,
  input: { isBot?: boolean; channelId?: string | null },
): Promise<AnalyticsSettings | null> {
  if (!guildId) {
    return null;
  }
  if (!(await isModuleEnabled(ANALYTICS_MODULE_ID))) {
    return null;
  }
  const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
  if (input.isBot && !settings.logBots) {
    return null;
  }
  if (input.channelId && settings.ignoredChannelIds.includes(input.channelId)) {
    return null;
  }
  return settings;
}

/**
 * Haelt fest, seit wann gezaehlt wird.
 *
 * Beim ersten Wert der jeweiligen Art. Ohne diesen Zeitpunkt sieht eine Null
 * fuer den letzten Januar aus wie «es war nichts los», obwohl sie «wir haben
 * damals noch nicht gezaehlt» heisst.
 */
export async function merkeTrackingBeginn(
  guildId: string,
  art: 'messages' | 'voice',
  zeitpunkt: Date,
): Promise<void> {
  const feld = art === 'messages' ? 'messagesSince' : 'voiceSince';
  await prisma.analyticsTracking
    .upsert({
      where: { guildId },
      create: { guildId, startedAt: zeitpunkt, [feld]: zeitpunkt },
      // Nur setzen, wenn noch nichts dasteht - der Beginn ist der Beginn und
      // wandert nicht mit jeder neuen Nachricht nach vorn.
      update: {},
    })
    .catch(() => undefined);

  await prisma.analyticsTracking
    .updateMany({ where: { guildId, [feld]: null }, data: { [feld]: zeitpunkt } })
    .catch(() => undefined);
}

/** Der Stand der Aufzeichnung - `null`, wenn noch nie gezaehlt wurde. */
export async function trackingStand(guildId: string) {
  return prisma.analyticsTracking.findUnique({ where: { guildId } }).catch(() => null);
}

// --- Nachrichten ------------------------------------------------------------

export interface NachrichtInput extends Grunddaten {
  channelId: string;
  channelName?: string | null;
  parentId?: string | null;
  at: Date;
}

/**
 * Zaehlt eine Nachricht.
 *
 * Vier Zeilen werden fortgeschrieben: Stunde, Tag, Person-und-Tag,
 * Kanal-und-Tag. Die Person-und-Tag-Zeile ist die wichtigste - ohne sie
 * liessen sich eindeutige aktive Mitglieder ueber einen Monat nicht
 * berechnen, denn die Summe der Tageswerte zaehlt jeden mehrfach.
 */
export async function zaehleNachricht(input: NachrichtInput): Promise<void> {
  try {
    const settings = await darfZaehlen(input.guildId, input);
    if (!settings || !settings.logMessages) {
      return;
    }

    const stundenBeginn = stunde(input.at);
    const tagesWert = tag(input.at);

    await Promise.all([
      prisma.analyticsHourly.upsert({
        where: { guildId_hourStart: { guildId: input.guildId, hourStart: stundenBeginn } },
        create: { guildId: input.guildId, hourStart: stundenBeginn, messages: 1 },
        update: { messages: { increment: 1 } },
      }),
      prisma.analyticsDaily.upsert({
        where: { guildId_day: { guildId: input.guildId, day: tagesWert } },
        create: { guildId: input.guildId, day: tagesWert, messages: 1 },
        update: { messages: { increment: 1 } },
      }),
      prisma.analyticsUserDaily.upsert({
        where: {
          guildId_discordId_day: {
            guildId: input.guildId,
            discordId: input.discordId,
            day: tagesWert,
          },
        },
        create: {
          guildId: input.guildId,
          discordId: input.discordId,
          day: tagesWert,
          messages: 1,
        },
        update: { messages: { increment: 1 } },
      }),
      prisma.analyticsChannelDaily.upsert({
        where: {
          guildId_channelId_day: {
            guildId: input.guildId,
            channelId: input.channelId,
            day: tagesWert,
          },
        },
        create: {
          guildId: input.guildId,
          channelId: input.channelId,
          day: tagesWert,
          kind: 'TEXT',
          channelName: input.channelName ?? null,
          parentId: input.parentId ?? null,
          messages: 1,
        },
        update: {
          messages: { increment: 1 },
          channelName: input.channelName ?? undefined,
          parentId: input.parentId ?? undefined,
        },
      }),
      merkeTrackingBeginn(input.guildId, 'messages', input.at),
      beruehreAktivitaet(input.guildId, input.discordId, input.at, input.isBot ?? false),
    ]);
  } catch (error) {
    log.warn('Nachricht konnte nicht gezählt werden', { error });
  }
}

// --- Sprachkanäle -----------------------------------------------------------

export interface SprachBeitrittInput extends Grunddaten {
  channelId: string;
  channelName?: string | null;
  parentId?: string | null;
  isAfk?: boolean;
  at: Date;
  /** Fortsetzung nach einem Kanalwechsel - dieselbe Sitzung. */
  sessionId?: string;
}

/**
 * Beginnt einen Abschnitt in einem Sprachkanal.
 *
 * Sekunden werden hier noch nicht gezaehlt: sie stehen erst fest, wenn der
 * Abschnitt endet. Wuerde laufende Zeit fortlaufend addiert, wuechse ein
 * bereits abgeschlossener Tag noch nachtraeglich.
 */
export async function starteSprachAbschnitt(input: SprachBeitrittInput): Promise<string | null> {
  try {
    const settings = await darfZaehlen(input.guildId, input);
    if (!settings || !settings.logVoice) {
      return null;
    }

    // Ein liegengebliebener Abschnitt derselben Person waere ein zweiter
    // offener - vorher schliessen, sonst zaehlt die Zeit doppelt.
    await schliesseOffene(input.guildId, input.discordId, input.at);

    const sessionId = input.sessionId ?? randomUUID();
    await prisma.analyticsVoiceSegment.create({
      data: {
        guildId: input.guildId,
        sessionId,
        discordId: input.discordId,
        isBot: input.isBot ?? false,
        channelId: input.channelId,
        channelName: input.channelName ?? null,
        parentId: input.parentId ?? null,
        isAfk: input.isAfk ?? false,
        joinedAt: input.at,
      },
    });

    // Eine neue Sitzung, kein Kanalwechsel: nur die zaehlt als Sitzung.
    if (!input.sessionId) {
      await zaehleSitzung(input.guildId, input.discordId, input.at, input.isAfk ?? false);
    }

    await merkeTrackingBeginn(input.guildId, 'voice', input.at);
    await beruehreAktivitaet(input.guildId, input.discordId, input.at, input.isBot ?? false);
    return sessionId;
  } catch (error) {
    log.warn('Sprachabschnitt konnte nicht begonnen werden', { error });
    return null;
  }
}

/** Beendet den offenen Abschnitt und verbucht seine Sekunden. */
export async function beendeSprachAbschnitt(
  guildId: string,
  discordId: string,
  at: Date,
): Promise<{ sessionId: string | null }> {
  try {
    return { sessionId: await schliesseOffene(guildId, discordId, at) };
  } catch (error) {
    log.warn('Sprachabschnitt konnte nicht beendet werden', { error });
    return { sessionId: null };
  }
}

/**
 * Schliesst offene Abschnitte einer Person und schreibt die Sekunden fort.
 *
 * Liefert die Sitzungskennung des zuletzt geschlossenen Abschnitts - der
 * Kanalwechsel setzt sie im neuen Abschnitt fort.
 */
async function schliesseOffene(guildId: string, discordId: string, at: Date): Promise<string | null> {
  const offene = await prisma.analyticsVoiceSegment.findMany({
    where: { guildId, discordId, leftAt: null },
    orderBy: { joinedAt: 'asc' },
  });
  let letzte: string | null = null;

  for (const abschnitt of offene) {
    const ende = at > abschnitt.joinedAt ? at : abschnitt.joinedAt;
    const sekunden = Math.max(0, Math.round((ende.getTime() - abschnitt.joinedAt.getTime()) / 1000));

    await prisma.analyticsVoiceSegment.update({
      where: { id: abschnitt.id },
      data: { leftAt: ende, seconds: sekunden },
    });
    letzte = abschnitt.sessionId;

    // Zeit im AFK-Kanal ist Anwesenheit, keine Aktivitaet. Der Abschnitt
    // bleibt als Beleg stehen, seine Sekunden fliessen aber nicht in die
    // Aktivitaetszahlen.
    if (sekunden > 0 && !abschnitt.isAfk) {
      await verbucheSprachSekunden({
        guildId,
        discordId,
        channelId: abschnitt.channelId,
        channelName: abschnitt.channelName,
        parentId: abschnitt.parentId,
        von: abschnitt.joinedAt,
        bis: ende,
      });
    }
  }

  return letzte;
}

interface SekundenInput {
  guildId: string;
  discordId: string;
  channelId: string;
  channelName: string | null;
  parentId: string | null;
  von: Date;
  bis: Date;
}

/** Verteilt die Sekunden eines Abschnitts auf Stunden, Tage, Person und Kanal. */
async function verbucheSprachSekunden(input: SekundenInput): Promise<void> {
  for (const eimer of aufStundenVerteilen(input.von, input.bis)) {
    await prisma.analyticsHourly.upsert({
      where: { guildId_hourStart: { guildId: input.guildId, hourStart: eimer.schluessel } },
      create: { guildId: input.guildId, hourStart: eimer.schluessel, voiceSeconds: eimer.sekunden },
      update: { voiceSeconds: { increment: eimer.sekunden } },
    });
  }

  for (const eimer of aufTageVerteilen(input.von, input.bis)) {
    const tagesWert = zuTag(eimer.schluessel);
    await Promise.all([
      prisma.analyticsDaily.upsert({
        where: { guildId_day: { guildId: input.guildId, day: tagesWert } },
        create: { guildId: input.guildId, day: tagesWert, voiceSeconds: eimer.sekunden },
        update: { voiceSeconds: { increment: eimer.sekunden } },
      }),
      prisma.analyticsUserDaily.upsert({
        where: {
          guildId_discordId_day: {
            guildId: input.guildId,
            discordId: input.discordId,
            day: tagesWert,
          },
        },
        create: {
          guildId: input.guildId,
          discordId: input.discordId,
          day: tagesWert,
          voiceSeconds: eimer.sekunden,
        },
        update: { voiceSeconds: { increment: eimer.sekunden } },
      }),
      prisma.analyticsChannelDaily.upsert({
        where: {
          guildId_channelId_day: {
            guildId: input.guildId,
            channelId: input.channelId,
            day: tagesWert,
          },
        },
        create: {
          guildId: input.guildId,
          channelId: input.channelId,
          day: tagesWert,
          kind: 'VOICE',
          channelName: input.channelName,
          parentId: input.parentId,
          voiceSeconds: eimer.sekunden,
        },
        update: {
          voiceSeconds: { increment: eimer.sekunden },
          channelName: input.channelName ?? undefined,
          parentId: input.parentId ?? undefined,
        },
      }),
    ]);
  }
}

/** Zaehlt eine begonnene Sitzung - unabhaengig davon, wie lange sie dauert. */
async function zaehleSitzung(guildId: string, discordId: string, at: Date, istAfk: boolean): Promise<void> {
  if (istAfk) {
    return;
  }
  const tagesWert = tag(at);
  await Promise.all([
    prisma.analyticsHourly.upsert({
      where: { guildId_hourStart: { guildId, hourStart: stunde(at) } },
      create: { guildId, hourStart: stunde(at), voiceSessions: 1 },
      update: { voiceSessions: { increment: 1 } },
    }),
    prisma.analyticsDaily.upsert({
      where: { guildId_day: { guildId, day: tagesWert } },
      create: { guildId, day: tagesWert, voiceSessions: 1 },
      update: { voiceSessions: { increment: 1 } },
    }),
    prisma.analyticsUserDaily.upsert({
      where: { guildId_discordId_day: { guildId, discordId, day: tagesWert } },
      create: { guildId, discordId, day: tagesWert, voiceSessions: 1 },
      update: { voiceSessions: { increment: 1 } },
    }),
  ]);
}

/**
 * Schliesst Abschnitte, die ein Absturz offen gelassen hat.
 *
 * Der heikle Teil ist das Ende: wir wissen nicht, wann die Leute den Kanal
 * verlassen haben. Was wir wissen, ist der letzte Herzschlag des Bots -
 * danach hat er nichts mehr gesehen. Bis dorthin zu zaehlen ist belegbar;
 * bis jetzt zu zaehlen hiesse, aus drei Tagen Ausfall drei Tage Sprachzeit
 * zu machen.
 */
export async function schliesseVerwaisteAbschnitte(
  guildId: string,
  nochAnwesend: ReadonlySet<string> = new Set(),
): Promise<number> {
  const status = await prisma.botStatus.findUnique({ where: { id: 'singleton' } }).catch(() => null);
  const grenze = status?.lastHeartbeatAt ?? new Date();
  const jetzt = new Date();
  const ende = grenze < jetzt ? grenze : jetzt;

  const offene = await prisma.analyticsVoiceSegment.findMany({
    where: { guildId, leftAt: null },
    select: { discordId: true },
    distinct: ['discordId'],
  });

  let geschlossen = 0;
  for (const { discordId } of offene) {
    // Wer noch im selben Kanal sitzt, hat seinen Abschnitt nicht beendet -
    // er laeuft weiter.
    if (nochAnwesend.has(discordId)) {
      continue;
    }
    await schliesseOffene(guildId, discordId, ende);
    geschlossen += 1;
  }

  if (geschlossen > 0) {
    log.info('Verwaiste Sprachabschnitte geschlossen', { geschlossen, bis: ende.toISOString() });
  }
  return geschlossen;
}

// --- Mitglieder -------------------------------------------------------------

export async function zaehleBeitritt(
  guildId: string,
  discordId: string,
  at: Date,
  isBot = false,
): Promise<void> {
  try {
    const settings = await darfZaehlen(guildId, { isBot });
    if (!settings || !settings.logMembers) {
      return;
    }
    const tagesWert = tag(at);
    await Promise.all([
      prisma.analyticsHourly.upsert({
        where: { guildId_hourStart: { guildId, hourStart: stunde(at) } },
        create: { guildId, hourStart: stunde(at), joins: 1 },
        update: { joins: { increment: 1 } },
      }),
      prisma.analyticsDaily.upsert({
        where: { guildId_day: { guildId, day: tagesWert } },
        create: { guildId, day: tagesWert, joins: 1 },
        update: { joins: { increment: 1 } },
      }),
      prisma.analyticsMemberProfile.upsert({
        where: { guildId_discordId: { guildId, discordId } },
        create: { guildId, discordId, joinedAt: at, isBot },
        // Ein Wiedereintritt setzt den Beitritt neu und loescht den Austritt:
        // fuer die Bindungsquote zaehlt der aktuelle Aufenthalt.
        update: { joinedAt: at, leftAt: null, isBot },
      }),
    ]);
  } catch (error) {
    log.warn('Beitritt konnte nicht gezählt werden', { error });
  }
}

export async function zaehleAustritt(
  guildId: string,
  discordId: string,
  at: Date,
  isBot = false,
): Promise<void> {
  try {
    const settings = await darfZaehlen(guildId, { isBot });
    if (!settings || !settings.logMembers) {
      return;
    }
    const tagesWert = tag(at);
    await Promise.all([
      prisma.analyticsHourly.upsert({
        where: { guildId_hourStart: { guildId, hourStart: stunde(at) } },
        create: { guildId, hourStart: stunde(at), leaves: 1 },
        update: { leaves: { increment: 1 } },
      }),
      prisma.analyticsDaily.upsert({
        where: { guildId_day: { guildId, day: tagesWert } },
        create: { guildId, day: tagesWert, leaves: 1 },
        update: { leaves: { increment: 1 } },
      }),
      prisma.analyticsMemberProfile.upsert({
        where: { guildId_discordId: { guildId, discordId } },
        create: { guildId, discordId, leftAt: at, isBot },
        update: { leftAt: at },
      }),
    ]);
    // Wer geht, sitzt nicht mehr im Sprachkanal.
    await schliesseOffene(guildId, discordId, at);
  } catch (error) {
    log.warn('Austritt konnte nicht gezählt werden', { error });
  }
}

/** Haelt die erste und letzte Aeusserung einer Person fest. */
async function beruehreAktivitaet(
  guildId: string,
  discordId: string,
  at: Date,
  isBot: boolean,
): Promise<void> {
  await prisma.analyticsMemberProfile
    .upsert({
      where: { guildId_discordId: { guildId, discordId } },
      create: { guildId, discordId, firstActivityAt: at, lastActivityAt: at, isBot },
      update: { lastActivityAt: at },
    })
    .catch(() => undefined);

  // `firstActivityAt` nur setzen, wenn noch keine dasteht - sonst wanderte die
  // erste Aeusserung mit jeder neuen nach vorn.
  await prisma.analyticsMemberProfile
    .updateMany({
      where: { guildId, discordId, firstActivityAt: null },
      data: { firstActivityAt: at },
    })
    .catch(() => undefined);
}

/**
 * Haelt die Mitgliederzahl des Tages fest.
 *
 * Eine Momentaufnahme, keine Summe. Sie ist der einzige Weg zu einem
 * Mitgliederverlauf: aus Beitritten und Austritten allein liesse er sich nur
 * rekonstruieren, wenn man auch den Anfangsstand kennte - und den kennen wir
 * fuer die Zeit vor der Aufzeichnung nicht.
 */
export async function haltMitgliederzahlFest(
  guildId: string,
  anzahl: number,
  at: Date = new Date(),
): Promise<void> {
  try {
    if (!(await isModuleEnabled(ANALYTICS_MODULE_ID))) {
      return;
    }
    const tagesWert = tag(at);
    await prisma.analyticsDaily.upsert({
      where: { guildId_day: { guildId, day: tagesWert } },
      create: { guildId, day: tagesWert, memberCount: anzahl },
      update: { memberCount: anzahl },
    });
  } catch (error) {
    log.warn('Mitgliederzahl konnte nicht festgehalten werden', { error });
  }
}

/** `YYYY-MM-DD` als reines Datum, wie es in den Tagesspalten steht. */
function zuTag(schluessel: string): Date {
  return new Date(`${schluessel}T00:00:00.000Z`);
}

/** Nur fuer den Backfill: dieselbe Verbuchung ohne Modul- und Einstellungspruefung. */
export const intern = {
  verbucheSprachSekunden,
  schliesseOffene,
  zaehleSitzung,
};
