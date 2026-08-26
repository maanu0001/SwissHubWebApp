import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const log = createLogger('analytics:dedup');

/**
 * Dasselbe Geschehen, zweimal gesehen.
 *
 * Bannt jemand ueber das Dashboard, entstehen zwei Aufzeichnungen: der
 * Moderationsvorgang (mit Grund und Verantwortlichem) und, Sekundenbruchteile
 * spaeter, das Discord-Ereignis, das der Bot ueber das Gateway empfaengt. Ohne
 * Verknuepfung stuenden zwei Vorgaenge da, wo einer war - und beim Zaehlen
 * ergaebe das die doppelte Zahl.
 *
 * Die Loesung ist eine Verknuepfung, keine Unterdrueckung: **beide Zeilen
 * bleiben stehen.** Sie beantworten verschiedene Fragen. Der
 * Moderationsvorgang sagt, warum es geschah; das Ereignis sagt, dass Discord
 * es tatsaechlich vollzogen hat. Faende der Abgleich nicht statt, waere gerade
 * das interessant: eine Massnahme ohne Discord-Ereignis ist eine, die nicht
 * angekommen ist.
 *
 * Die Zeitleiste zeigt an der verknuepften Zeile «über dieses Dashboard» und
 * verlinkt hinueber, statt dasselbe zweimal zu erzaehlen.
 */

/** Wie lange nach der Massnahme ein Ereignis noch dazugehoeren kann. */
const FENSTER_MS = 30_000;

/** Welche Massnahme welchen Ereignistyp erzeugt. */
const ZUORDNUNG: Record<string, string> = {
  BAN: 'MEMBER_BAN',
  UNBAN: 'MEMBER_UNBAN',
  KICK: 'MEMBER_LEAVE',
  TIMEOUT: 'MEMBER_TIMEOUT',
  TIMEOUT_REMOVE: 'MEMBER_TIMEOUT_END',
};

/**
 * Verknuepft die juengsten Massnahmen mit ihren Discord-Ereignissen.
 *
 * Laeuft nach dem Schreiben eines Ereignisses und sucht rueckwaerts: das
 * Ereignis ist immer das spaetere der beiden. Findet sich nichts, bleibt die
 * Zeile unverknuepft - auch das ist eine Aussage.
 */
export async function verknuepfeMitMassnahme(eventId: string): Promise<boolean> {
  try {
    const ereignis = await prisma.discordEvent.findUnique({
      where: { id: eventId },
      select: { id: true, type: true, subjectDiscordId: true, occurredAt: true, moderationActionId: true },
    });
    if (!ereignis || ereignis.moderationActionId || !ereignis.subjectDiscordId) {
      return false;
    }

    const massnahmeTyp = Object.entries(ZUORDNUNG).find(([, wert]) => wert === ereignis.type)?.[0];
    if (!massnahmeTyp) {
      return false;
    }

    const massnahme = await prisma.moderationAction.findFirst({
      where: {
        type: massnahmeTyp as never,
        status: 'COMPLETED',
        targetDiscordId: ereignis.subjectDiscordId,
        createdAt: {
          gte: new Date(ereignis.occurredAt.getTime() - FENSTER_MS),
          lte: new Date(ereignis.occurredAt.getTime() + FENSTER_MS),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, actorDiscordId: true, actorUsername: true },
    });
    if (!massnahme) {
      return false;
    }

    await prisma.discordEvent.update({
      where: { id: ereignis.id },
      data: {
        moderationActionId: massnahme.id,
        // Jetzt ist der Verursacher belegt und nicht mehr geraten: wir waren
        // es selbst, und wir wissen, wer den Knopf gedrueckt hat.
        actorDiscordId: massnahme.actorDiscordId,
        actorUsername: massnahme.actorUsername,
        actorSource: 'WEBAPP',
      },
    });
    return true;
  } catch (error) {
    log.debug('Abgleich mit einer Massnahme fehlgeschlagen', { error });
    return false;
  }
}
