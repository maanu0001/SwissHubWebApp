import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CalendarEvent, CalendarReminder } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { CALENDAR_ACCENT_COLOR, CALENDAR_MODULE_ID } from './config';
import { eventUrl, formatiereZeit, ortsZeile } from './discord';
import { calendarSettings, erlaubteErwaehnung, AKTIVE_STATUS } from './service';

const logger = createLogger('calendar:reminders');

/**
 * Erinnerungen an bevorstehende Termine.
 *
 * Der faellige Zeitpunkt steht als Zeile in der Datenbank, nicht als
 * `setTimeout`: ein Neustart wuerde jeden so gemerkten Termin verlieren, und
 * eine Erinnerung, die nie kommt, faellt erst auf, wenn alle daheim sitzen.
 * Dieser Lauf holt nur nach, was faellig geworden ist.
 *
 * Gegen doppelte Nachrichten wirken zwei Dinge zusammen:
 *
 *  - `sentAt` wird gesetzt, **bevor** gesendet wird, und zwar unter einer
 *    Bedingung, die nur einmal zutrifft. Wer den Zuschlag nicht bekommt,
 *    sendet nicht. Damit ist auch bei mehreren Bot-Instanzen genau eine
 *    zustaendig - ohne einen zweiten Koordinierungsdienst.
 *  - Schlaegt der Versand danach fehl, wird `sentAt` wieder freigegeben und
 *    ein Fehlversuch gezaehlt. Nach genug Fehlversuchen bleibt es liegen,
 *    statt Discord endlos zu bedraengen.
 *
 * Die Reihenfolge ist Absicht: lieber eine Erinnerung verlieren, wenn der
 * Prozess mitten im Senden stirbt, als denselben Ping fuenfmal schicken.
 */

/** Nach so vielen Fehlversuchen wird es nicht mehr probiert. */
export const MAX_VERSUCHE = 5;

export interface ReminderTickResult {
  gesendet: number;
  uebersprungen: number;
  gescheitert: number;
}

/** Text der Erinnerung. Kurz - sie kommt kurz vor dem Termin. */
export function reminderText(event: CalendarEvent, minutesBefore: number): string {
  const { datum, zeit } = formatiereZeit(event);
  const vorlauf =
    minutesBefore >= 1440
      ? `in ${Math.round(minutesBefore / 1440)} Tag(en)`
      : minutesBefore >= 60
        ? `in ${Math.round(minutesBefore / 60)} Stunde(n)`
        : `in ${minutesBefore} Minuten`;
  return [
    `**${event.title}** beginnt ${vorlauf}.`,
    `📅 ${datum} · 🕗 ${zeit}`,
    `📍 ${ortsZeile(event)}`,
    eventUrl(event),
  ].join('\n');
}

/**
 * Faellige Erinnerungen verschicken.
 *
 * `now` ist Parameter statt `new Date()` im Rumpf, damit sich der Lauf
 * pruefen laesst, ohne die Uhr zu stellen.
 */
export async function runReminderTick(
  now = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<ReminderTickResult> {
  const settings = await calendarSettings();
  if (!settings.remindersEnabled) {
    return { gesendet: 0, uebersprungen: 0, gescheitert: 0 };
  }

  const faellig = await prisma.calendarReminder.findMany({
    where: {
      sentAt: null,
      dueAt: { lte: now },
      attempts: { lt: MAX_VERSUCHE },
      // Nur fuer Termine, die noch anstehen oder laufen. Ein abgesagter Abend
      // erinnert an nichts, und ein laengst gelaufener erst recht nicht.
      event: { status: { in: [...AKTIVE_STATUS] } },
    },
    include: { event: true },
    orderBy: { dueAt: 'asc' },
    take: 50,
  });

  let gesendet = 0;
  let uebersprungen = 0;
  let gescheitert = 0;

  for (const erinnerung of faellig) {
    const event = erinnerung.event;

    // Eine Erinnerung, deren Termin laengst begonnen hat, wird nicht
    // nachgereicht - sie kaeme zu spaet und stiftete nur Verwirrung. Sie
    // gilt als erledigt, damit der naechste Lauf sie nicht erneut ansieht.
    if (event.startAt.getTime() + 5 * 60_000 < now.getTime()) {
      await prisma.calendarReminder.update({
        where: { id: erinnerung.id },
        data: { sentAt: now, lastError: 'Fällig geworden, nachdem das Event begonnen hatte.' },
      });
      uebersprungen += 1;
      continue;
    }

    const kanal =
      erinnerung.channelId ??
      event.announcementChannelId ??
      settings.defaultAnnouncementChannelId;
    if (!kanal) {
      await prisma.calendarReminder.update({
        where: { id: erinnerung.id },
        data: { sentAt: now, lastError: 'Kein Zielkanal hinterlegt.' },
      });
      uebersprungen += 1;
      continue;
    }

    // Den Zuschlag holen: `sentAt: null` in der Bedingung sorgt dafuer, dass
    // genau ein Lauf durchkommt. Wer null Zeilen aktualisiert, war zu spaet
    // und laesst die Finger davon.
    const zugeteilt = await prisma.calendarReminder.updateMany({
      where: { id: erinnerung.id, sentAt: null },
      data: { sentAt: now, attempts: { increment: 1 } },
    });
    if (zugeteilt.count === 0) {
      uebersprungen += 1;
      continue;
    }

    try {
      const nachricht = await sendeErinnerung(gateway, kanal, erinnerung, event, settings);
      await prisma.calendarReminder.update({
        where: { id: erinnerung.id },
        data: { discordMessageId: nachricht, lastError: null },
      });
      await safeRecordAudit({
        action: AUDIT_ACTIONS.CALENDAR_REMINDER_SENT,
        module: CALENDAR_MODULE_ID,
        actorDiscordId: 'system',
        actorUsername: 'Zeitsteuerung',
        targetLabel: event.title,
        success: true,
        metadata: {
          eventId: event.id,
          reminderId: erinnerung.id,
          minutesBefore: erinnerung.minutesBefore,
          channelId: kanal,
        },
      });
      gesendet += 1;
    } catch (error) {
      // Zurueckgeben statt aufgeben: Discord kann kurz weg sein. Der
      // Fehlversuch ist bereits gezaehlt, `MAX_VERSUCHE` begrenzt das Ganze.
      await prisma.calendarReminder.update({
        where: { id: erinnerung.id },
        data: {
          sentAt: null,
          lastError: error instanceof Error ? error.message.slice(0, 300) : 'unbekannt',
        },
      });
      logger.warn('Erinnerung konnte nicht gesendet werden', {
        eventId: event.id,
        reminderId: erinnerung.id,
        versuche: erinnerung.attempts + 1,
        error,
      });
      gescheitert += 1;
    }
  }

  if (gesendet > 0 || gescheitert > 0) {
    logger.info('Erinnerungen verarbeitet', { gesendet, uebersprungen, gescheitert });
  }
  return { gesendet, uebersprungen, gescheitert };
}

async function sendeErinnerung(
  gateway: DiscordGateway,
  kanal: string,
  erinnerung: CalendarReminder,
  event: CalendarEvent,
  settings: Awaited<ReturnType<typeof calendarSettings>>,
): Promise<string> {
  const rolle = erlaubteErwaehnung(erinnerung.mentionRoleId, settings);

  // Nur Angemeldete erwaehnen: dann geht die Erinnerung an die, die kommen
  // wollen, statt an den ganzen Kanal.
  const teilnehmer = erinnerung.mentionRegistrants
    ? await prisma.calendarRegistration.findMany({
        where: { eventId: event.id, status: 'CONFIRMED' },
        select: { discordId: true },
        take: 50,
      })
    : [];

  const erwaehnungen = [
    rolle ? `<@&${rolle}>` : null,
    ...teilnehmer.map((eintrag) => `<@${eintrag.discordId}>`),
  ].filter(Boolean);

  const nachricht = await gateway.channels.send(kanal, {
    content: [erwaehnungen.join(' '), reminderText(event, erinnerung.minutesBefore)]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1900),
    embeds: [
      {
        color: CALENDAR_ACCENT_COLOR,
        title: event.title.slice(0, 256),
        url: eventUrl(event),
        description: (event.shortDescription ?? event.description).slice(0, 500),
        ...(event.iconUrl ? { thumbnail: { url: event.iconUrl } } : {}),
      },
    ],
    allowedMentions: {
      parse: [] as never[],
      ...(rolle ? { roles: [rolle] } : {}),
      ...(teilnehmer.length > 0
        ? { users: teilnehmer.map((eintrag) => eintrag.discordId) }
        : {}),
    },
  });
  return nachricht.id;
}

/**
 * Faelligkeiten nach einer Terminverschiebung nachziehen.
 *
 * Wird nach jeder Aenderung aufgerufen. Bereits verschickte Erinnerungen
 * bleiben unangetastet - sie sind Verlauf, kein Plan.
 */
export async function reberechneFaelligkeiten(eventId: string): Promise<number> {
  const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return 0;
  }
  const offene = await prisma.calendarReminder.findMany({
    where: { eventId, sentAt: null },
    select: { id: true, minutesBefore: true },
  });
  for (const eintrag of offene) {
    await prisma.calendarReminder.update({
      where: { id: eintrag.id },
      data: { dueAt: new Date(event.startAt.getTime() - eintrag.minutesBefore * 60_000) },
    });
  }
  return offene.length;
}
