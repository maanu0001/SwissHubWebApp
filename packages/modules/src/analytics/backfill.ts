import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { tag, stunde } from './zeit';
import { intern } from './zaehler';

const log = createLogger('analytics:backfill');

/**
 * Aggregate aus dem vorhandenen Ereignisprotokoll nachziehen.
 *
 * Was hier geht und was nicht, ist der wichtigste Teil:
 *
 * - **Beitritte und Austritte** stehen im Protokoll und lassen sich
 *   vollstaendig nachziehen.
 * - **Sprachzeit** laesst sich aus Betreten, Verlassen und Verschieben
 *   rekonstruieren - die Ereignisse tragen ihren Zeitpunkt.
 * - **Nachrichten nicht.** Eine geschriebene Nachricht war nie ein Ereignis;
 *   aufgezeichnet wurde nur Bearbeitung und Loeschung. Was nie erfasst wurde,
 *   laesst sich nicht nachtraeglich zaehlen, und eine Hochrechnung waere eine
 *   erfundene Vergangenheit.
 *
 * Der Lauf ist **wiederholbar**: er raeumt den bearbeiteten Bereich vorher
 * aus und schreibt ihn neu. Zweimal laufen lassen ergibt dieselben Zahlen,
 * nicht die doppelten.
 *
 * Er ist **fortsetzbar**: `backfilledUntil` haelt fest, wie weit er gekommen
 * ist, und ein Abbruch verliert hoechstens den letzten Stapel.
 */

export interface BackfillErgebnis {
  ereignisse: number;
  beitritte: number;
  austritte: number;
  sprachAbschnitte: number;
  sprachSekunden: number;
  /** Nachrichten koennen nicht nachgezogen werden - hier steht, warum. */
  hinweis: string;
}

const STAPEL = 2000;

export async function backfill(
  guildId: string,
  optionen: { bis?: Date; maxStapel?: number } = {},
): Promise<BackfillErgebnis> {
  const bis = optionen.bis ?? new Date();
  const stand = await prisma.analyticsTracking.findUnique({ where: { guildId } });
  const von = stand?.backfilledUntil ?? new Date(0);

  const ergebnis: BackfillErgebnis = {
    ereignisse: 0,
    beitritte: 0,
    austritte: 0,
    sprachAbschnitte: 0,
    sprachSekunden: 0,
    hinweis:
      'Nachrichten lassen sich nicht nachziehen: eine geschriebene Nachricht war vor dieser Erweiterung kein Ereignis. Gezählt wird ab jetzt.',
  };

  // Bereits nachgezogene Werte im Zielbereich verwerfen, damit ein zweiter
  // Lauf nicht addiert. Die Zeilen entstehen neu.
  await raeumeAuf(guildId, von, bis);

  let cursor: string | undefined;
  const maxStapel = optionen.maxStapel ?? 500;

  for (let runde = 0; runde < maxStapel; runde += 1) {
    const zeilen = await prisma.discordEvent.findMany({
      where: {
        guildId,
        occurredAt: { gt: von, lte: bis },
        type: { in: ['MEMBER_JOIN', 'MEMBER_LEAVE', 'VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE'] },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: STAPEL,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (zeilen.length === 0) {
      break;
    }

    for (const zeile of zeilen) {
      ergebnis.ereignisse += 1;
      if (zeile.type === 'MEMBER_JOIN') {
        await nachziehenMitglied(guildId, zeile.subjectDiscordId, zeile.occurredAt, 'joins');
        ergebnis.beitritte += 1;
      } else if (zeile.type === 'MEMBER_LEAVE') {
        await nachziehenMitglied(guildId, zeile.subjectDiscordId, zeile.occurredAt, 'leaves');
        ergebnis.austritte += 1;
      }
    }

    cursor = zeilen.at(-1)?.id;
    // Fortschritt festhalten - ein Abbruch verliert hoechstens diesen Stapel.
    await prisma.analyticsTracking.upsert({
      where: { guildId },
      create: {
        guildId,
        startedAt: zeilen[0]?.occurredAt ?? bis,
        backfilledUntil: zeilen.at(-1)?.occurredAt,
      },
      update: { backfilledUntil: zeilen.at(-1)?.occurredAt },
    });

    if (zeilen.length < STAPEL) {
      break;
    }
  }

  const sprache = await sprachzeitNachziehen(guildId, von, bis);
  ergebnis.sprachAbschnitte = sprache.abschnitte;
  ergebnis.sprachSekunden = sprache.sekunden;

  await prisma.analyticsTracking.upsert({
    where: { guildId },
    create: { guildId, startedAt: bis, backfilledUntil: bis },
    update: { backfilledUntil: bis },
  });

  log.info('Backfill abgeschlossen', { ...ergebnis, hinweis: undefined });
  return ergebnis;
}

/** Verwirft, was ein frueherer Lauf im selben Bereich geschrieben hat. */
async function raeumeAuf(guildId: string, von: Date, bis: Date): Promise<void> {
  // Nur die nachziehbaren Groessen zuruecksetzen. Nachrichtenzahlen stammen
  // aus dem laufenden Betrieb und duerfen nicht angetastet werden.
  await prisma.analyticsDaily.updateMany({
    where: { guildId, day: { gte: tag(von), lte: tag(bis) } },
    data: { joins: 0, leaves: 0, voiceSeconds: 0, voiceSessions: 0 },
  });
  await prisma.analyticsHourly.updateMany({
    where: { guildId, hourStart: { gte: stunde(von), lte: stunde(bis) } },
    data: { joins: 0, leaves: 0, voiceSeconds: 0, voiceSessions: 0 },
  });
  await prisma.analyticsUserDaily.updateMany({
    where: { guildId, day: { gte: tag(von), lte: tag(bis) } },
    data: { voiceSeconds: 0, voiceSessions: 0 },
  });
  await prisma.analyticsChannelDaily.updateMany({
    where: { guildId, kind: 'VOICE', day: { gte: tag(von), lte: tag(bis) } },
    data: { voiceSeconds: 0 },
  });
  await prisma.analyticsVoiceSegment.deleteMany({
    where: { guildId, joinedAt: { gte: von, lte: bis } },
  });
}

async function nachziehenMitglied(
  guildId: string,
  discordId: string | null,
  at: Date,
  feld: 'joins' | 'leaves',
): Promise<void> {
  const tagesWert = tag(at);
  const stundenWert = stunde(at);

  await Promise.all([
    prisma.analyticsHourly.upsert({
      where: { guildId_hourStart: { guildId, hourStart: stundenWert } },
      create: { guildId, hourStart: stundenWert, [feld]: 1 },
      update: { [feld]: { increment: 1 } },
    }),
    prisma.analyticsDaily.upsert({
      where: { guildId_day: { guildId, day: tagesWert } },
      create: { guildId, day: tagesWert, [feld]: 1 },
      update: { [feld]: { increment: 1 } },
    }),
  ]);

  if (!discordId) {
    return;
  }
  await prisma.analyticsMemberProfile
    .upsert({
      where: { guildId_discordId: { guildId, discordId } },
      create: {
        guildId,
        discordId,
        ...(feld === 'joins' ? { joinedAt: at } : { leftAt: at }),
      },
      update: feld === 'joins' ? { joinedAt: at, leftAt: null } : { leftAt: at },
    })
    .catch(() => undefined);
}

/**
 * Sprachabschnitte aus den Ereignissen rekonstruieren.
 *
 * Je Person werden die Ereignisse der Reihe nach durchgegangen: Betreten
 * oeffnet einen Abschnitt, Verschieben schliesst ihn und oeffnet den
 * naechsten unter derselben Sitzung, Verlassen schliesst ihn.
 *
 * Ein Abschnitt ohne Ende - der Bot war weg, als die Person ging - wird
 * **verworfen** und nicht geschaetzt. Lieber eine fehlende Sitzung als eine
 * erfundene Dauer.
 */
async function sprachzeitNachziehen(
  guildId: string,
  von: Date,
  bis: Date,
): Promise<{ abschnitte: number; sekunden: number }> {
  const ereignisse = await prisma.discordEvent.findMany({
    where: {
      guildId,
      occurredAt: { gt: von, lte: bis },
      type: { in: ['VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE'] },
    },
    orderBy: [{ subjectDiscordId: 'asc' }, { occurredAt: 'asc' }],
    select: {
      subjectDiscordId: true,
      type: true,
      channelId: true,
      channelName: true,
      occurredAt: true,
      metadata: true,
    },
    // Obergrenze gegen einen Lauf, der den Speicher sprengt. Wer mehr
    // Ereignisse hat, laesst den Backfill in mehreren Zeitfenstern laufen.
    take: 200_000,
  });

  let abschnitte = 0;
  let sekunden = 0;
  let offen: { channelId: string; channelName: string | null; von: Date } | null = null;
  let letztePerson: string | null = null;

  const schliessen = async (person: string, ende: Date): Promise<void> => {
    if (!offen || ende <= offen.von) {
      offen = null;
      return;
    }
    const dauer = Math.round((ende.getTime() - offen.von.getTime()) / 1000);
    await prisma.analyticsVoiceSegment.create({
      data: {
        guildId,
        sessionId: `backfill-${person}-${offen.von.getTime()}`,
        discordId: person,
        channelId: offen.channelId,
        channelName: offen.channelName,
        joinedAt: offen.von,
        leftAt: ende,
        seconds: dauer,
      },
    });
    await intern.verbucheSprachSekunden({
      guildId,
      discordId: person,
      channelId: offen.channelId,
      channelName: offen.channelName,
      parentId: null,
      von: offen.von,
      bis: ende,
    });
    abschnitte += 1;
    sekunden += dauer;
    offen = null;
  };

  for (const ereignis of ereignisse) {
    const person = ereignis.subjectDiscordId;
    if (!person) {
      continue;
    }
    if (person !== letztePerson) {
      // Personenwechsel: ein noch offener Abschnitt der vorigen Person hat
      // kein Ende im Protokoll und wird verworfen.
      offen = null;
      letztePerson = person;
    }

    if (ereignis.type === 'VOICE_JOIN') {
      offen = {
        channelId: ereignis.channelId ?? 'unbekannt',
        channelName: ereignis.channelName,
        von: ereignis.occurredAt,
      };
      continue;
    }
    if (ereignis.type === 'VOICE_MOVE') {
      await schliessen(person, ereignis.occurredAt);
      offen = {
        channelId: ereignis.channelId ?? 'unbekannt',
        channelName: ereignis.channelName,
        von: ereignis.occurredAt,
      };
      continue;
    }
    await schliessen(person, ereignis.occurredAt);
  }

  return { abschnitte, sekunden };
}
