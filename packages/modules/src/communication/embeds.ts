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

export interface CommunicationPayloadBase {
  title: string;
  content: string;
  bannerUrl?: string | null;
  footerText: string;
  /** Bereits geprüfte Erwähnung - `null` bedeutet: kein Ping. */
  mention?: { kind: 'everyone' | 'here' } | { kind: 'role'; roleId: string } | null;
}

export interface EventPayloadInput extends CommunicationPayloadBase {
  startsAt: Date;
  responsibleDiscordId?: string | null;
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
      allowedMentions: { parse: [], roles: [mention.roleId] },
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

export function buildEventPayload(input: EventPayloadInput): DiscordMessagePayload {
  // Discord-Timestamps zeigen jedem Mitglied seine eigene lokale Zeit an.
  const unix = Math.floor(input.startsAt.getTime() / 1000);
  const fields = [{ name: '📅 Datum', value: `<t:${unix}:F>\n<t:${unix}:R>`, inline: true }];
  if (input.responsibleDiscordId) {
    fields.push({ name: '👤 Verantwortlich', value: `<@${input.responsibleDiscordId}>`, inline: true });
  }

  return {
    ...mentionParts(input.mention),
    embeds: [
      withBanner(
        {
          title: `🎉 ${safeText(input.title, 240)}`,
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
