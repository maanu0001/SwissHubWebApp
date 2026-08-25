import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { schreibeEreignis, SYSTEM_ACTOR, type VoiceActor } from './service';
import { transferOwnership } from './members';

const log = createLogger('voice:lifecycle');

/**
 * Der Lebenszyklus eines temporaeren Sprachkanals.
 *
 * Zwei Dinge muessen einen Neustart des Bots ueberleben: der Loeschauftrag
 * eines leeren Kanals und die Schonfrist, bis jemand anderes einen verwaisten
 * Talk uebernimmt. Beides steht deshalb als Zeitpunkt in der Datenbank und
 * nicht als `setTimeout` im Arbeitsspeicher - ein Zeitgeber, der beim
 * Neustart verschwindet, laesst leere Kanaele fuer immer stehen.
 *
 * Der Abgleich unten faehrt periodisch und holt nach, was liegen geblieben
 * ist. Er ist damit zugleich die Rettung nach einem Absturz und das Netz
 * gegen Ereignisse, die Discord nie geschickt hat.
 */

/** Wer gerade in diesem Sprachkanal sitzt - Menschen wie Bots. */
export async function anwesende(discordChannelId: string) {
  return prisma.voicePresence.findMany({
    where: { channelId: discordChannelId },
    orderBy: { updatedAt: 'asc' },
  });
}

/**
 * Wie viele Menschen im Kanal sind.
 *
 * Bots zaehlen nicht: ein Musikbot allein im Kanal ist kein Gespraech, und ein
 * Talk, den nur noch der Player besetzt, soll trotzdem aufgeraeumt werden.
 */
export async function menschenImKanal(discordChannelId: string): Promise<number> {
  return prisma.voicePresence.count({
    where: { channelId: discordChannelId, isBot: false },
  });
}

/**
 * Plant das Loeschen eines leer gewordenen Kanals.
 *
 * Nicht sofort: eine kurze Verbindungsstoerung soll den Talk nicht zerstoeren,
 * waehrend die Gruppe noch redet. Betritt jemand den Kanal wieder, hebt
 * `haltePlanungAn` den Auftrag auf.
 */
export async function planeLoeschung(
  kanal: TemporaryVoiceChannel,
  graceSeconds: number,
): Promise<void> {
  if (kanal.closedAt) {
    return;
  }
  const faellig = new Date(Date.now() + Math.max(0, graceSeconds) * 1000);
  await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanal.id, closedAt: null },
    data: { deleteScheduledAt: faellig },
  });
  log.debug('Löschung geplant', { id: kanal.id, faellig: faellig.toISOString() });
}

/** Hebt einen geplanten Loeschauftrag wieder auf. */
export async function haltePlanungAn(kanalId: string): Promise<void> {
  await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanalId, closedAt: null, deleteScheduledAt: { not: null } },
    data: { deleteScheduledAt: null, lastActiveAt: new Date() },
  });
}

/**
 * Loescht den Kanal und schliesst die Zeile.
 *
 * Die Zeile bleibt stehen - sie traegt die Statistik. Geloescht wird nur der
 * Kanal auf Discord, und auch dessen Verschwinden ist kein Fehler: wenn er
 * schon weg ist, war das Ziel ohnehin erreicht.
 */
export async function deleteTemporaryVoice(
  kanal: TemporaryVoiceChannel,
  actor: VoiceActor,
  grund = 'Talk beendet',
): Promise<void> {
  if (kanal.discordChannelId) {
    await discord.managedChannels.remove(kanal.discordChannelId, grund).catch((error: unknown) => {
      log.warn('Sprachkanal konnte nicht gelöscht werden', {
        error: error instanceof Error ? error.message : 'unbekannt',
        channelId: kanal.discordChannelId,
      });
    });
  }

  const { count } = await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanal.id, closedAt: null },
    data: { closedAt: new Date(), deleteScheduledAt: null },
  });

  if (count > 0) {
    await schreibeEreignis(kanal, 'VOICE_DELETED', actor, { grund });
    log.info('Talk beendet', { id: kanal.id, grund });
  }
}

/**
 * Haelt fest, dass der Kanal benutzt wird.
 *
 * Nebenbei waechst der Hoechststand mit - fuer die Statistik. Sie soll sagen
 * koennen, wie gross Talks tatsaechlich werden, und nicht nur, wie viele es
 * gab.
 */
export async function notiereAnwesenheit(
  kanal: TemporaryVoiceChannel,
  anzahl: number,
): Promise<void> {
  await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanal.id, closedAt: null },
    data: {
      lastActiveAt: new Date(),
      ...(anzahl > kanal.peakMembers ? { peakMembers: anzahl } : {}),
    },
  });
}

/**
 * Der Besitzer hat den Kanal verlassen.
 *
 * Nicht sofort uebergeben: wer kurz die Verbindung verliert oder in einen
 * anderen Kanal wechselt und zurueckkommt, soll sein eigener Talk nicht
 * abhandenkommen. Erst wenn die Schonfrist verstreicht und er nicht
 * zurueckkehrt, uebernimmt jemand anderes.
 */
export async function merkeBesitzerFort(kanalId: string): Promise<void> {
  await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanalId, closedAt: null, ownerLeftAt: null },
    data: { ownerLeftAt: new Date() },
  });
}

/** Der Besitzer ist zurueck - die Schonfrist entfaellt. */
export async function besitzerIstZurueck(kanalId: string): Promise<void> {
  await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanalId, closedAt: null, ownerLeftAt: { not: null } },
    data: { ownerLeftAt: null },
  });
}

/**
 * Sucht den geeignetsten Nachfolger.
 *
 * Wer am laengsten da ist, uebernimmt. Bots kommen nicht in Frage - ein
 * Musikbot als Besitzer waere ein Talk, den niemand mehr verwalten kann -,
 * und wer gesperrt ist, erst recht nicht.
 */
export async function findeNachfolger(
  kanal: TemporaryVoiceChannel,
): Promise<{ discordId: string; username: string } | null> {
  if (!kanal.discordChannelId) {
    return null;
  }

  const [drin, gesperrt] = await Promise.all([
    prisma.voicePresence.findMany({
      where: { channelId: kanal.discordChannelId, isBot: false },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.temporaryVoiceAccess.findMany({
      where: { channelId: kanal.id, kind: 'DENY' },
      select: { discordId: true },
    }),
  ]);

  const verboten = new Set(gesperrt.map((eintrag) => eintrag.discordId));

  for (const kandidat of drin) {
    if (kandidat.discordId === kanal.ownerDiscordId || verboten.has(kandidat.discordId)) {
      continue;
    }
    const mitglied = await discord.members.get(kandidat.discordId).catch(() => null);
    if (!mitglied || mitglied.isBot) {
      continue;
    }
    return { discordId: mitglied.discordId, username: mitglied.displayName };
  }
  return null;
}

/**
 * Uebergibt einen verwaisten Talk an den naechsten Anwesenden.
 *
 * Der alte Besitzer bekommt ihn nicht automatisch zurueck, wenn er spaeter
 * wiederkommt: der neue hat den Talk inzwischen eingerichtet, und ihn ihm
 * ohne Zutun wieder wegzunehmen waere die groessere Ueberraschung.
 */
export async function uebergibAnNachfolger(
  kanal: TemporaryVoiceChannel,
  ownerModeration: boolean,
): Promise<boolean> {
  const nachfolger = await findeNachfolger(kanal);
  if (!nachfolger) {
    return false;
  }
  await transferOwnership(kanal, nachfolger, SYSTEM_ACTOR, {
    ownerModeration,
    automatisch: true,
  });
  return true;
}
