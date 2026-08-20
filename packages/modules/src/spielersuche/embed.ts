import {
  BUTTON_STYLE,
  type DiscordActionRow,
  type DiscordButton,
  type DiscordMessagePayload,
} from '@swisshub/discord';
import { escapeDiscordMarkdown, truncate } from '@swisshub/shared';
import type { SpielersucheMatch, SpielersucheParticipant } from '@swisshub/database';

/**
 * Discord-Darstellung einer Spielersuche.
 *
 * Dieselbe Funktion erzeugt den offenen, den vollständigen und den beendeten
 * Zustand. Nach jeder Änderung wird die Nachricht schlicht neu gerendert -
 * dadurch kann die Anzeige nicht von der Datenbank abweichen.
 */

const SUCCESS_COLOR = 0x57f287;
const CLOSED_COLOR = 0x747f8d;

/** Präfixe der Buttons. Der Bot erkennt daran seine eigenen Knöpfe wieder. */
export const BUTTON_IDS = {
  join: 'swisshub:spielersuche:join',
  leave: 'swisshub:spielersuche:leave',
  close: 'swisshub:spielersuche:close',
  help: 'swisshub:spielersuche:help',
} as const;

/**
 * Button-IDs des alten Bots.
 *
 * Nachrichten, die er hinterlassen hat, tragen diese IDs weiterhin. Sie
 * werden deshalb weiter erkannt - sonst wären bestehende Suchen nach der
 * Umstellung tote Knöpfe.
 */
export const LEGACY_BUTTON_IDS = {
  join: 'swisshub_spielersuche:join',
  leave: 'swisshub_spielersuche:leave',
  close: 'swisshub_spielersuche:close',
  help: 'swisshub_spielersuche:help',
} as const;

export type SpielersucheButtonAction = keyof typeof BUTTON_IDS;

/** Ordnet eine Button-ID einer Aktion zu; `null` bei fremden Knöpfen. */
export function parseButtonId(customId: string): SpielersucheButtonAction | null {
  for (const action of ['join', 'leave', 'close', 'help'] as const) {
    if (customId === BUTTON_IDS[action] || customId === LEGACY_BUTTON_IDS[action]) {
      return action;
    }
  }
  return null;
}

export interface MatchView {
  match: SpielersucheMatch;
  participants: SpielersucheParticipant[];
  accentColor: number;
  footerText: string;
  guildId: string | null;
}

const safe = (value: string): string => truncate(escapeDiscordMarkdown(value), 200);

/** Wandelt `#AFDBF5` in die Zahl, die Discord erwartet. */
export function parseAccentColor(value: string, fallback = 0xafdbf5): number {
  const match = /^#?([0-9a-f]{6})$/iu.exec(value.trim());
  return match ? Number.parseInt(match[1] as string, 16) : fallback;
}

/** Gesamtzahl der Plätze: Ersteller plus gesuchte Spieler. */
export const totalSlots = (match: SpielersucheMatch): number => match.requestedPlayers + 1;

export function buildMatchMessage(view: MatchView): DiscordMessagePayload {
  const { match, participants } = view;
  const total = totalSlots(match);
  const free = Math.max(total - participants.length, 0);
  const closed = match.status === 'CLOSED' || match.status === 'EXPIRED';

  const title = closed
    ? '🎮 Spielersuechi beendet'
    : match.status === 'COMPLETE'
      ? '🎮 Gruppe komplett'
      : `🎮 ${safe(match.gameName)} · Mitspieler gsuecht`;

  const description = closed
    ? match.status === 'EXPIRED'
      ? '⌛ Die Suechi isch abglaufe.'
      : '🔒 Die Suechi isch nüme aktiv.'
    : match.status === 'COMPLETE'
      ? '✅ Alli Plätz sind bsetzt.'
      : `🔎 No **${free}** ${free === 1 ? 'freie Platz' : 'freii Plätz'}`;

  const color = closed ? CLOSED_COLOR : match.status === 'COMPLETE' ? SUCCESS_COLOR : view.accentColor;

  const lines = participants.map((participant) =>
    participant.isCreator ? `👑 <@${participant.discordId}>` : `• <@${participant.discordId}>`,
  );

  const fields = [
    { name: 'Gstartet vo', value: `<@${match.creatorDiscordId}>`, inline: true },
    { name: 'Plätz', value: `👥 ${participants.length}/${total}`, inline: true },
    {
      name: 'Gsuechti Spieler',
      value: String(match.requestedPlayers),
      inline: true,
    },
    {
      name: 'Aktuelli Gruppe',
      value: lines.length > 0 ? truncate(lines.join('\n'), 1000) : 'No niemert debii',
      inline: false,
    },
  ];

  if (match.voiceChannelId) {
    // Bei vollständiger Gruppe ist der Kanal für alle übrigen geschlossen -
    // das steht hier, damit niemand vergeblich versucht beizutreten.
    const state = closed ? '' : match.status === 'COMPLETE' ? '\n🔒 Gschlosse' : '\n🟢 Offe für alli';
    fields.push({
      name: 'Voice-Channel',
      value: `🔊 <#${match.voiceChannelId}>${state}`,
      inline: true,
    });
  }

  if (match.comment) {
    fields.push({
      name: 'Kommentar',
      value: truncate(escapeDiscordMarkdown(match.comment), 1000),
      inline: false,
    });
  }

  if (!closed) {
    fields.push({
      name: 'Läuft ab',
      value: `<t:${Math.floor(match.expiresAt.getTime() / 1000)}:R>`,
      inline: true,
    });
  }

  return {
    embeds: [
      {
        title,
        description,
        color,
        fields,
        ...(match.bannerUrl ? { image: { url: match.bannerUrl } } : {}),
        timestamp: match.createdAt.toISOString(),
        footer: { text: view.footerText },
      },
    ],
    components: buildComponents(view, closed),
    // Die Erwähnungen im Embed sind reine Anzeige. Gepingt wird - wenn
    // überhaupt - nur die Spielrolle beim ersten Senden.
    allowedMentions: { parse: [] },
  };
}

function buildComponents(view: MatchView, closed: boolean): DiscordActionRow[] {
  if (closed) {
    return [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: BUTTON_STYLE.SECONDARY,
            label: 'Suechi beendet',
            emoji: { name: '🔒' },
            custom_id: BUTTON_IDS.join,
            disabled: true,
          },
        ],
      },
    ];
  }

  const full = view.participants.length >= totalSlots(view.match);
  const components: DiscordButton[] = [
    {
      type: 2,
      style: BUTTON_STYLE.SUCCESS,
      label: 'Mitmache',
      emoji: { name: '🎮' },
      custom_id: BUTTON_IDS.join,
      // Ein voller Knopf wäre eine Einladung zum Frustklick.
      disabled: full,
    },
    {
      type: 2,
      style: BUTTON_STYLE.SECONDARY,
      label: 'Verlah',
      emoji: { name: '↩️' },
      custom_id: BUTTON_IDS.leave,
    },
    {
      type: 2,
      style: BUTTON_STYLE.DANGER,
      label: 'Suechi beende',
      emoji: { name: '❌' },
      custom_id: BUTTON_IDS.close,
    },
    {
      type: 2,
      style: BUTTON_STYLE.SECONDARY,
      label: 'Hilf',
      emoji: { name: '❓' },
      custom_id: BUTTON_IDS.help,
    },
  ];

  // Sprung direkt in den Sprachkanal. Ein Link-Knopf löst keine Interaktion
  // aus - Discord öffnet die Adresse selbst.
  if (view.match.voiceChannelId && view.guildId) {
    components.push({
      type: 2,
      style: BUTTON_STYLE.LINK,
      label: 'Zum Voice',
      emoji: { name: '🔊' },
      url: `https://discord.com/channels/${view.guildId}/${view.match.voiceChannelId}`,
    });
  }

  return [{ type: 1, components }];
}

/** Hilfe-Embed - erreichbar über den Knopf und über `/spielersuche-hilf`. */
export function buildHelpMessage(options: {
  footerText: string;
  accentColor: number;
  cooldownMinutes: number;
  maxActiveSearches: number;
}): DiscordMessagePayload {
  return {
    embeds: [
      {
        title: '❓ SwissHub Spielersuechi – Hilf',
        description:
          'D Spielersuechi bringt Lüt schnell i passendi Gruppe, macht direkt en Voice-Channel und haltet de Ablauf übersichtlich.',
        color: options.accentColor,
        fields: [
          {
            name: '🎮 Suechi erstelle',
            value:
              'Mit `/spielersuche` wählsch es Spiel, d Azahl zuesätzlichi Mitspieler und optional en Kommentar. Das gaht au im Dashboard.',
          },
          {
            name: '🔔 Rolle-Ping',
            value:
              options.cooldownMinutes > 0
                ? `Bim Start wird d Spielrolle eimalig erwähnt. Pro Spiel giltet en Cooldown vo **${options.cooldownMinutes} Minute**.`
                : 'Bim Start wird d Spielrolle erwähnt.',
          },
          {
            name: '👥 Gruppe verwalte',
            value:
              '**Mitmache** füegt dich dr Gruppe hinzue, **Verlah** entfernt dich wieder. De Ersteller cha d Suechi beende.',
          },
          {
            name: '🔊 Voice-Channel',
            value: 'De Voice-Channel wird sofort erstellt und verschwindet automatisch, wenn er leer isch.',
          },
          {
            name: '🛡️ Schutzregle',
            value: `Jede cha maximal **${options.maxActiveSearches} ${options.maxActiveSearches === 1 ? 'aktivi Suechi' : 'aktivi Suechine'}** gliichzitig ha.`,
          },
        ],
        footer: { text: options.footerText },
      },
    ],
    allowedMentions: { parse: [] },
  };
}
