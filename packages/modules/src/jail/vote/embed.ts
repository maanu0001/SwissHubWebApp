import { branding } from '@swisshub/config';
import { BUTTON_STYLE, type DiscordActionRow, type DiscordMessagePayload } from '@swisshub/discord';
import { escapeDiscordMarkdown, formatDuration, truncate } from '@swisshub/shared';
import type { VoteJail } from '@swisshub/database';

/**
 * Discord-Darstellung einer Abstimmung.
 *
 * Dieselbe Funktion baut den Start-, den Erfolgs- und den Ablauf-Zustand -
 * dadurch kann das Embed schlicht neu gerendert und überschrieben werden,
 * statt an mehreren Stellen Textbausteine zusammenzusetzen.
 */
const ACCENT_COLOR = 0x83060a;
const SUCCESS_COLOR = 0x22c55e;
const MUTED_COLOR = 0x64748b;

/** Präfix der Button-ID. Der Bot erkennt daran seine eigenen Buttons wieder. */
export const VOTE_BUTTON_PREFIX = 'swisshub:votejail:';

export const voteButtonId = (voteJailId: string): string => `${VOTE_BUTTON_PREFIX}${voteJailId}`;

/** Liest die Abstimmungs-ID aus einer Button-ID; `null` bei fremden Buttons. */
export function parseVoteButtonId(customId: string): string | null {
  return customId.startsWith(VOTE_BUTTON_PREFIX) ? customId.slice(VOTE_BUTTON_PREFIX.length) : null;
}

const safe = (value: string): string => truncate(escapeDiscordMarkdown(value), 256);

export function buildVoteJailMessage(vote: VoteJail): DiscordMessagePayload {
  const target = `<@${vote.targetDiscordId}>`;
  const jailLabel = formatDuration(vote.resultingJailMinutes * 60 * 1000);

  if (vote.status === 'SUCCEEDED') {
    return {
      embeds: [
        {
          title: '✅ Vote Jail erfolgreich',
          description: `${target} wurde für ${jailLabel} in Jail gesteckt.`,
          color: SUCCESS_COLOR,
          fields: [{ name: 'Stimmen', value: `${vote.voteCount} / ${vote.requiredVotes}`, inline: true }],
          timestamp: new Date().toISOString(),
          footer: { text: `${branding.name} ${branding.productName}` },
        },
      ],
      components: [disabledRow(vote, 'Abstimmung beendet')],
    };
  }

  if (vote.status === 'FAILED' || vote.status === 'CANCELLED') {
    return {
      embeds: [
        {
          title: '❌ Vote Jail beendet',
          description:
            vote.status === 'CANCELLED'
              ? 'Die Abstimmung wurde abgebrochen.'
              : 'Es wurde kein Jail ausgesprochen.',
          color: MUTED_COLOR,
          fields: [
            { name: 'Benötigt', value: `${vote.requiredVotes} Stimmen`, inline: true },
            { name: 'Erreicht', value: `${vote.voteCount} Stimmen`, inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: `${branding.name} ${branding.productName}` },
        },
      ],
      components: [disabledRow(vote, 'Abstimmung beendet')],
    };
  }

  // Laufende Abstimmung. Der Countdown nutzt einen Discord-Timestamp: Discord
  // rechnet ihn im Client herunter, ohne dass der Bot das Embed sekündlich
  // aktualisieren muss.
  const relative = `<t:${Math.floor(vote.expiresAt.getTime() / 1000)}:R>`;
  return {
    embeds: [
      {
        title: '🔒 Vote Jail',
        description: `Soll ${target} in Jail?`,
        color: ACCENT_COLOR,
        fields: [
          { name: 'Gestartet von', value: `<@${vote.startedByDiscordId}>`, inline: true },
          { name: 'Grund', value: vote.reason ? safe(vote.reason) : 'Kein Grund angegeben', inline: true },
          { name: 'Benötigte Stimmen', value: String(vote.requiredVotes), inline: true },
          { name: 'Aktuell', value: `${vote.voteCount} / ${vote.requiredVotes}`, inline: true },
          { name: 'Jail bei Erfolg', value: jailLabel, inline: true },
          { name: 'Endet', value: relative, inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: `${branding.name} • Zäme hock, zäme zocke` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: BUTTON_STYLE.DANGER,
            label: 'In Jail ine',
            emoji: { name: '🔒' },
            custom_id: voteButtonId(vote.id),
          },
        ],
      },
    ],
  };
}

function disabledRow(vote: VoteJail, label: string): DiscordActionRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: BUTTON_STYLE.SECONDARY,
        label,
        emoji: { name: '🔒' },
        custom_id: voteButtonId(vote.id),
        disabled: true,
      },
    ],
  };
}
