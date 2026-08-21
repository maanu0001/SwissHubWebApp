import { branding } from '@swisshub/config';
import { escapeDiscordMarkdown, formatDateTime, truncate } from '@swisshub/shared';
import type { DiscordEmbed, DiscordMessagePayload } from '@swisshub/discord';

/**
 * Discord-Payload der Kommunikationsnachrichten.
 *
 * Wird ausschliesslich aus bereits validierten Werten gebaut. Die Vorschau in
 * der WebApp ist eine reine Darstellungshilfe - sie liefert niemals den
 * Payload, der tatsächlich gesendet wird.
 */
const ACCENT_COLOR = 0x83060a;
const EVENT_COLOR = 0xe63a41;
const POLL_COLOR = 0x3b82f6;

export const POLL_REACTIONS = ['👍', '👎'] as const;

/**
 * Eine bereits geprüfte Erwähnung.
 *
 * Der alte Bot nahm hier freien Text entgegen und schrieb ihn unverändert in
 * die Nachricht - damit liess sich jede beliebige Rolle anpingen. Hier steht
 * nur, was die Berechtigungsprüfung durchgelassen hat.
 */
export type ResolvedMention =
  { kind: 'everyone' | 'here' } | { kind: 'role'; roleId: string } | { kind: 'user'; userId: string };

export interface CommunicationPayloadBase {
  title: string;
  content: string;
  bannerUrl?: string | null;
  footerText: string;
  /** Bereits geprüfte Erwähnung - `null` bedeutet: kein Ping. */
  mention?: ResolvedMention | null;
}

/**
 * Wie man sich anmeldet.
 *
 * Der alte Bot hatte hier ein Freitextfeld mit dem Sonderwort `ticket`, das
 * auf eine fest im Code eingetragene Channel-ID zeigte. Der Channel kommt
 * jetzt aus den Einstellungen; das Freitextfeld bleibt für alles andere.
 */
export type RegistrationInfo =
  | { kind: 'none' }
  | { kind: 'text'; value: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'url'; value: string };

export interface EventPayloadInput extends CommunicationPayloadBase {
  /**
   * Zeitpunkt des Events.
   *
   * Aus der WebApp kommt ein echtes Datum; der Slash Command übernimmt aus
   * dem Discord-Modal auch freien Text, der sich nicht zuverlässig deuten
   * lässt. Dann bleibt dieses Feld leer und `startsAtText` trägt die Angabe.
   */
  startsAt?: Date | null;
  startsAtText?: string | null;
  /** Treffpunkt - beim Vorgänger ein Pflichtfeld. */
  location?: string | null;
  responsibleDiscordId?: string | null;
  registration?: RegistrationInfo;
  timezone?: string;
}

const safeText = (value: string, max: number): string => truncate(escapeDiscordMarkdown(value), max);

/**
 * Erwähnungen.
 *
 * Der Ping entsteht über `content` plus eine explizite `allowedMentions`-Liste.
 * Ohne diese Freigabe rendert Discord den Text zwar, benachrichtigt aber
 * niemanden - genau das ist der Standard.
 */
function mentionParts(
  mention: CommunicationPayloadBase['mention'],
): Pick<DiscordMessagePayload, 'content' | 'allowedMentions'> {
  if (!mention) {
    return { allowedMentions: { parse: [] } };
  }
  if (mention.kind === 'role') {
    return {
      content: `<@&${mention.roleId}>`,
      // Nur diese eine Rolle. `parse: []` schliesst alles andere aus, was im
      // Text zufällig wie eine Erwähnung aussieht.
      allowedMentions: { parse: [], roles: [mention.roleId] },
    };
  }
  if (mention.kind === 'user') {
    return {
      content: `<@${mention.userId}>`,
      allowedMentions: { parse: [], users: [mention.userId] },
    };
  }
  return {
    content: mention.kind === 'here' ? '@here' : '@everyone',
    allowedMentions: { parse: ['everyone'] },
  };
}

function withBanner(embed: DiscordEmbed, bannerUrl?: string | null): DiscordEmbed {
  return bannerUrl ? { ...embed, image: { url: bannerUrl } } : embed;
}

export function buildNewsPayload(input: CommunicationPayloadBase): DiscordMessagePayload {
  return {
    ...mentionParts(input.mention),
    embeds: [
      withBanner(
        {
          title: `📰 ${safeText(input.title, 240)}`,
          description: safeText(input.content, 3000),
          color: ACCENT_COLOR,
          timestamp: new Date().toISOString(),
          footer: { text: input.footerText },
        },
        input.bannerUrl,
      ),
    ],
  };
}

/**
 * Das Event-Embed.
 *
 * Das Layout des Vorgängers bleibt erhalten: zwei Felder je Zeile, in der
 * Reihenfolge Treffpunkt / Datum, dann Verantwortliche Person / Anmeldung.
 * Discord setzt bis zu drei Inline-Felder nebeneinander, deshalb erzwingt ein
 * unsichtbares drittes Feld den Umbruch nach zwei - genau wie zuvor.
 */
export function buildEventPayload(input: EventPayloadInput): DiscordMessagePayload {
  const fields: NonNullable<DiscordEmbed['fields']> = [];
  const spacer = { name: '\u200b', value: '\u200b', inline: true };

  fields.push({
    name: 'Treffpunkt',
    value: input.location ? safeText(input.location, 1024) : 'Kei Ahgab',
    inline: true,
  });

  // Ein Discord-Zeitstempel zeigt jedem Mitglied seine eigene lokale Zeit.
  // Nur wenn kein echtes Datum vorliegt, wird der Text unverändert übernommen.
  const dateValue = input.startsAt
    ? (() => {
        const unix = Math.floor(input.startsAt.getTime() / 1000);
        return `<t:${unix}:F>\n<t:${unix}:R>`;
      })()
    : input.startsAtText
      ? safeText(input.startsAtText, 1024)
      : 'Kei Ahgab';
  fields.push({ name: 'Datum/Uhrziit', value: dateValue, inline: true });
  fields.push(spacer);

  fields.push({
    name: 'Verantwortlichi Person',
    value: input.responsibleDiscordId ? `<@${input.responsibleDiscordId}>` : 'Kei Ahgab',
    inline: true,
  });
  fields.push({ name: 'Ahmäldig via', value: registrationValue(input.registration), inline: true });
  fields.push(spacer);

  return {
    ...mentionParts(input.mention),
    embeds: [
      withBanner(
        {
          title: safeText(input.title, 240),
          description: safeText(input.content, 3000),
          color: EVENT_COLOR,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: input.footerText },
        },
        input.bannerUrl,
      ),
    ],
  };
}

/**
 * Der Wert des Feldes "Ahmäldig via".
 *
 * Ein Channel wird als Verweis dargestellt - Discord macht daraus einen
 * anklickbaren `#channel`. Er wird bewusst nicht in `allowedMentions`
 * aufgenommen: ein Channel-Verweis benachrichtigt niemanden.
 */
function registrationValue(registration: RegistrationInfo | undefined): string {
  if (!registration || registration.kind === 'none') {
    return 'Kei Ahgab';
  }
  if (registration.kind === 'channel') {
    return `<#${registration.channelId}>`;
  }
  if (registration.kind === 'url') {
    return safeText(registration.value, 1024);
  }
  return safeText(registration.value, 1024);
}

export function buildPollPayload(input: CommunicationPayloadBase): DiscordMessagePayload {
  return {
    ...mentionParts(input.mention),
    embeds: [
      withBanner(
        {
          title: `📊 ${safeText(input.title, 240)}`,
          description: `${safeText(input.content, 2800)}\n\n**Stimm mit de Reactions ab:**\n${POLL_REACTIONS[0]} Ja\n${POLL_REACTIONS[1]} Nei`,
          color: POLL_COLOR,
          timestamp: new Date().toISOString(),
          footer: { text: input.footerText },
        },
        input.bannerUrl,
      ),
    ],
  };
}

/** Lesbare Zeitangabe für Bestätigungsdialog und Verlauf. */
export function formatEventDate(startsAt: Date, timezone: string = branding.timezone): string {
  return formatDateTime(startsAt, { timezone });
}
