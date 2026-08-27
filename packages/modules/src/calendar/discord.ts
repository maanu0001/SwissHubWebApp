import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CalendarEvent, CalendarNoticeKind } from '@swisshub/database';
import { appUrl } from '@swisshub/config';
import {
  BUTTON_STYLE,
  discord as defaultDiscord,
  type DiscordEmbed,
  type DiscordGateway,
  type DiscordMessagePayload,
  type SentMessage,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { CALENDAR_ACCENT_COLOR, CALENDAR_MODULE_ID } from './config';
import { belegung } from './registrations';
import { calendarSettings, erlaubteErwaehnung, requireEvent } from './service';
import type { CalendarActor } from './schemas';

const logger = createLogger('calendar:discord');

/**
 * Der Kalender auf Discord.
 *
 * Eine Ankuendigung wird einmal gesendet und danach fortgeschrieben - ihre
 * Kennung steht am Termin. Das ist der Unterschied zwischen «bei jeder
 * Aenderung eine neue Nachricht» und «die Nachricht stimmt»: wer den Kanal
 * liest, soll nicht fuenf Fassungen desselben Abends sehen, und wer die
 * Absage verpasst, soll sie am urspruenglichen Beitrag erkennen.
 *
 * Verschickt wird ueber dieselbe Schnittstelle wie bei Verlosungen und
 * Turnieren; ein eigener Discord-Zugang existiert nicht.
 */

export const eventUrl = (event: Pick<CalendarEvent, 'slug'>): string =>
  appUrl(`/kalender/${event.slug}`);

const STATUS_PRAEFIX: Partial<Record<CalendarEvent['status'], string>> = {
  CANCELLED: 'ABGESAGT — ',
  ONGOING: 'LÄUFT JETZT — ',
  COMPLETED: 'BEENDET — ',
};

/**
 * Datum und Uhrzeit in der Zone des Termins.
 *
 * Bewusst nicht als Discord-Zeitstempel: der zeigt jedem seine eigene
 * Ortszeit, was fuer einen Termin vor Ort in Zuerich irrefuehrend waere.
 * Stattdessen die Zeit des Termins, mit ihrer Zone benannt.
 */
export function formatiereZeit(event: CalendarEvent): { datum: string; zeit: string } {
  const datum = new Intl.DateTimeFormat('de-CH', {
    timeZone: event.timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(event.startAt);

  if (event.allDay) {
    return { datum, zeit: 'Ganztägig' };
  }

  const uhr = (wert: Date) =>
    new Intl.DateTimeFormat('de-CH', {
      timeZone: event.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(wert);

  const zone =
    new Intl.DateTimeFormat('de-CH', { timeZone: event.timezone, timeZoneName: 'short' })
      .formatToParts(event.startAt)
      .find((teil) => teil.type === 'timeZoneName')?.value ?? '';

  const zeit = event.endAt
    ? `${uhr(event.startAt)} – ${uhr(event.endAt)} Uhr ${zone}`.trim()
    : `${uhr(event.startAt)} Uhr ${zone}`.trim();
  return { datum, zeit };
}

/** Wo der Abend stattfindet, in einer Zeile. */
export function ortsZeile(event: CalendarEvent): string {
  const teile: string[] = [];
  if (event.locationKind === 'DISCORD' || event.locationKind === 'HYBRID') {
    if (event.locationVoiceId) {
      teile.push(`<#${event.locationVoiceId}>`);
    } else if (event.locationChannelId) {
      teile.push(`<#${event.locationChannelId}>`);
    } else {
      teile.push('SwissHub Discord');
    }
  }
  if (event.locationKind === 'ONLINE' && event.locationUrl) {
    teile.push(event.locationUrl);
  }
  if (event.locationKind === 'OFFLINE' || event.locationKind === 'HYBRID') {
    teile.push([event.locationName, event.locationAddress].filter(Boolean).join(', '));
  }
  return teile.filter(Boolean).join(' · ') || 'Wird noch bekannt gegeben';
}

export interface EmbedZahlen {
  confirmed: number;
  capacity: number;
  waitlist: number;
}

export function buildEventEmbed(
  event: CalendarEvent,
  zahlen: EmbedZahlen,
  kategorie?: { name: string; icon: string | null } | null,
): DiscordEmbed {
  const { datum, zeit } = formatiereZeit(event);
  const symbol = kategorie?.icon ? `${kategorie.icon} ` : '';

  const zeilen = [
    `📅 ${datum}`,
    `🕗 ${zeit}`,
    `📍 ${ortsZeile(event)}`,
    '',
    (event.shortDescription ?? event.description).slice(0, 1500),
  ];

  if (event.status === 'CANCELLED' && event.cancelReason) {
    zeilen.push('', `**Abgesagt:** ${event.cancelReason.slice(0, 300)}`);
  }

  const felder = [];
  if (event.registrationEnabled) {
    felder.push({
      name: 'Teilnehmer',
      value:
        zahlen.capacity > 0
          ? `${zahlen.confirmed} / ${zahlen.capacity}${zahlen.waitlist > 0 ? ` (+${zahlen.waitlist} Warteliste)` : ''}`
          : `${zahlen.confirmed}`,
      inline: true,
    });
  }
  if (kategorie) {
    felder.push({ name: 'Kategorie', value: kategorie.name, inline: true });
  }

  return {
    title: `${STATUS_PRAEFIX[event.status] ?? ''}${symbol}${event.title}`.slice(0, 256),
    description: zeilen.join('\n').slice(0, 4000),
    color: CALENDAR_ACCENT_COLOR,
    url: eventUrl(event),
    author: { name: 'SWISSHUB EVENT' },
    ...(event.bannerUrl ? { image: { url: event.bannerUrl } } : {}),
    ...(event.iconUrl ? { thumbnail: { url: event.iconUrl } } : {}),
    ...(felder.length > 0 ? { fields: felder } : {}),
    timestamp: event.startAt.toISOString(),
    footer: { text: 'SwissHub Community-Kalender' },
  };
}

async function payload(
  event: CalendarEvent,
  options: { mentionRoleId?: string | null } = {},
): Promise<DiscordMessagePayload> {
  const [zahlen, kategorie] = await Promise.all([
    belegung(event.id),
    event.categoryId
      ? prisma.calendarCategory.findUnique({
          where: { id: event.categoryId },
          select: { name: true, icon: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    ...(options.mentionRoleId ? { content: `<@&${options.mentionRoleId}>` } : {}),
    embeds: [buildEventEmbed(event, zahlen, kategorie)],
    components: [
      {
        type: 1 as const,
        components: [
          {
            type: 2 as const,
            style: BUTTON_STYLE.LINK,
            label: event.registrationEnabled ? 'Event ansehen & anmelden' : 'Event ansehen',
            url: eventUrl(event),
          },
        ],
      },
    ],
    // Erwaehnt wird nur die ausdruecklich freigegebene Rolle. Beim
    // Fortschreiben faellt sie weg - sonst pingt jede Aenderung erneut.
    allowedMentions: options.mentionRoleId
      ? { parse: [] as never[], roles: [options.mentionRoleId] }
      : { parse: [] as never[] },
  };
}

/**
 * Haelt fest, dass etwas verschickt wurde.
 *
 * Die Eindeutigkeit `(eventId, kind)` ist der Grund, weshalb ein wiederholter
 * Lauf nichts doppelt - dasselbe Verfahren wie bei Turnieren.
 */
async function vermerke(
  eventId: string,
  kind: CalendarNoticeKind,
  channelId: string | null,
  messageId: string | null,
  actorDiscordId?: string,
): Promise<void> {
  await prisma.calendarNotice.upsert({
    where: { eventId_kind: { eventId, kind } },
    create: {
      eventId,
      kind,
      channelId,
      discordMessageId: messageId,
      sentByDiscordId: actorDiscordId ?? null,
    },
    update: { channelId, discordMessageId: messageId, sentAt: new Date() },
  });
}

export async function wurdeVersandt(eventId: string, kind: CalendarNoticeKind): Promise<boolean> {
  const vorhanden = await prisma.calendarNotice.findUnique({
    where: { eventId_kind: { eventId, kind } },
  });
  return vorhanden !== null;
}

/**
 * Die Ankuendigung veroeffentlichen.
 *
 * Ohne hinterlegten Kanal geschieht nichts - ein Termin ohne
 * Discord-Ankuendigung ist zulaessig und funktioniert ueber die Webseite.
 */
export async function announceEvent(
  eventId: string,
  options: { gateway?: DiscordGateway; actor?: CalendarActor; republish?: boolean } = {},
): Promise<SentMessage | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const event = await requireEvent(eventId);
  const settings = await calendarSettings();
  const kanal = event.announcementChannelId ?? settings.defaultAnnouncementChannelId;

  if (!event.announceOnDiscord || !kanal) {
    return null;
  }
  // Schon angekuendigt und keine ausdrueckliche Neuveroeffentlichung: nichts
  // tun. Ohne diese Bremse postete jeder wiederholte Lauf erneut.
  if (!options.republish && (await wurdeVersandt(eventId, 'ANNOUNCEMENT'))) {
    return null;
  }

  const rolle = erlaubteErwaehnung(event.mentionRoleId, settings);
  let gesendet: SentMessage;
  try {
    gesendet = await gateway.channels.send(kanal, await payload(event, { mentionRoleId: rolle }));
  } catch (error) {
    logger.warn('Ankündigung konnte nicht gesendet werden', { eventId, error });
    return null;
  }

  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      discordMessageId: gesendet.id,
      discordMessageMissing: false,
      announcementChannelId: kanal,
    },
  });
  await vermerke(eventId, 'ANNOUNCEMENT', kanal, gesendet.id, options.actor?.discordId);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_ANNOUNCED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: options.actor?.discordId ?? 'system',
    actorUsername: options.actor?.username ?? 'Zeitsteuerung',
    targetLabel: event.title,
    success: true,
    metadata: { eventId, channelId: kanal, messageId: gesendet.id, republish: Boolean(options.republish) },
  });

  logger.info('Event angekündigt', { eventId, channelId: kanal });
  return gesendet;
}

/**
 * Die bestehende Ankuendigung fortschreiben.
 *
 * Ist die Nachricht nicht mehr auffindbar - jemand hat sie geloescht -, wird
 * das am Termin vermerkt, damit die Verwaltung es anzeigen und eine neue
 * Veroeffentlichung anbieten kann. Neu gesendet wird hier bewusst nichts:
 * eine geloeschte Nachricht wurde vielleicht mit Absicht geloescht.
 */
export async function refreshAnnouncement(
  eventId: string,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  const event = await requireEvent(eventId);
  if (!event.announcementChannelId || !event.discordMessageId) {
    return false;
  }
  try {
    await gateway.channels.edit(
      event.announcementChannelId,
      event.discordMessageId,
      await payload(event),
    );
    if (event.discordMessageMissing) {
      await prisma.calendarEvent.update({
        where: { id: eventId },
        data: { discordMessageMissing: false },
      });
    }
    return true;
  } catch (error) {
    logger.warn('Ankündigung konnte nicht aktualisiert werden', { eventId, error });
    await prisma.calendarEvent.update({
      where: { id: eventId },
      data: { discordMessageMissing: true },
    });
    return false;
  }
}

export interface BenachrichtigungsErgebnis {
  gesendet: boolean;
  empfaenger: number;
}

/**
 * Angemeldete ueber eine Aenderung oder die Absage benachrichtigen.
 *
 * Erwaehnt werden die Angemeldeten namentlich - eine Absage, die niemanden
 * erreicht, ist keine. Wer sich abgemeldet hat, bekommt nichts: die Aenderung
 * geht ihn nichts mehr an.
 *
 * Ohne Angemeldete wird nichts verschickt statt einer Nachricht an
 * niemanden.
 */
export async function notifyParticipants(
  eventId: string,
  kind: Extract<CalendarNoticeKind, 'UPDATE' | 'CANCELLED'>,
  options: { gateway?: DiscordGateway; actor?: CalendarActor; note?: string | null } = {},
): Promise<BenachrichtigungsErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;
  const event = await requireEvent(eventId);
  const settings = await calendarSettings();
  const kanal = event.announcementChannelId ?? settings.defaultAnnouncementChannelId;
  if (!kanal) {
    return { gesendet: false, empfaenger: 0 };
  }

  const angemeldet = await prisma.calendarRegistration.findMany({
    where: { eventId, status: { in: ['CONFIRMED', 'WAITLIST'] } },
    select: { discordId: true },
  });
  if (angemeldet.length === 0) {
    return { gesendet: false, empfaenger: 0 };
  }

  const { datum, zeit } = formatiereZeit(event);
  const kopf =
    kind === 'CANCELLED'
      ? `**Abgesagt: ${event.title}**`
      : `**Änderung: ${event.title}**`;
  const rumpf =
    kind === 'CANCELLED'
      ? (event.cancelReason ?? 'Das Event findet nicht statt.')
      : `Neuer Stand: ${datum}, ${zeit} · ${ortsZeile(event)}`;

  // Discord begrenzt eine Nachricht auf 2000 Zeichen; bei vielen Angemeldeten
  // wird die Erwaehnungsliste in Stuecke geteilt, statt abgeschnitten zu
  // werden. Jemanden stillschweigend wegzulassen waere der schlimmere Fehler.
  const stuecke: string[][] = [[]];
  for (const eintrag of angemeldet) {
    const aktuell = stuecke[stuecke.length - 1]!;
    if (aktuell.length >= 50) {
      stuecke.push([eintrag.discordId]);
    } else {
      aktuell.push(eintrag.discordId);
    }
  }

  let letzte: SentMessage | null = null;
  for (const [index, stueck] of stuecke.entries()) {
    const text = [
      index === 0 ? kopf : null,
      index === 0 ? rumpf : null,
      index === 0 && options.note ? options.note : null,
      index === 0 ? eventUrl(event) : null,
      stueck.map((id) => `<@${id}>`).join(' '),
    ]
      .filter(Boolean)
      .join('\n');

    try {
      letzte = await gateway.channels.send(kanal, {
        content: text.slice(0, 1900),
        allowedMentions: { parse: [] as never[], users: stueck },
      });
    } catch (error) {
      logger.warn('Teilnehmer konnten nicht benachrichtigt werden', { eventId, kind, error });
      return { gesendet: false, empfaenger: 0 };
    }
  }

  await vermerke(eventId, kind, kanal, letzte?.id ?? null, options.actor?.discordId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_PARTICIPANTS_NOTIFIED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: options.actor?.discordId ?? 'system',
    actorUsername: options.actor?.username ?? 'Zeitsteuerung',
    targetLabel: event.title,
    success: true,
    metadata: { eventId, kind, empfaenger: angemeldet.length },
  });

  logger.info('Teilnehmer benachrichtigt', { eventId, kind, empfaenger: angemeldet.length });
  return { gesendet: true, empfaenger: angemeldet.length };
}

/**
 * Sammelt Aktualisierungen der Ankuendigung.
 *
 * Bei jeder Anmeldung sofort zu schreiben hiesse, bei einem Ansturm die
 * Discord-Grenzen zu reissen. Stattdessen wird je Termin hoechstens alle paar
 * Sekunden geschrieben; zwischendurch eingehende Anmeldungen fallen in
 * dieselbe spaetere Aktualisierung.
 */
const wartend = new Map<string, NodeJS.Timeout>();
export const REFRESH_DELAY_MS = 5000;

export async function scheduleRefresh(
  eventId: string,
  options: { gateway?: DiscordGateway; delayMs?: number } = {},
): Promise<void> {
  if (wartend.has(eventId)) {
    return;
  }
  const timer = setTimeout(() => {
    wartend.delete(eventId);
    void refreshAnnouncement(eventId, options.gateway).catch((error: unknown) =>
      logger.warn('Verzögerte Aktualisierung fehlgeschlagen', { eventId, error }),
    );
  }, options.delayMs ?? REFRESH_DELAY_MS);
  // Der Zeitgeber darf das Herunterfahren nicht aufhalten - die Anzeige ist
  // Beiwerk, der Stand steht in der Datenbank.
  timer.unref?.();
  wartend.set(eventId, timer);
}

/** Nur fuer Tests: wartende Aktualisierungen verwerfen. */
export function clearPendingRefreshes(): void {
  for (const timer of wartend.values()) {
    clearTimeout(timer);
  }
  wartend.clear();
}
