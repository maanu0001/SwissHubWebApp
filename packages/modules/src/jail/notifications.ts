import { branding } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { escapeDiscordMarkdown, formatDateTime, formatDuration, truncate } from '@swisshub/shared';
import type { DiscordEmbed, DiscordGateway } from '@swisshub/discord';

const log = createLogger('jail:notifications');

/** SwissHub Akzentfarbe als Embed-Farbe. */
const ACCENT_COLOR = 0x83060a;
const SUCCESS_COLOR = 0x22c55e;

export interface JailNotificationData {
  targetDiscordId: string;
  targetLabel: string;
  moderatorDiscordId: string;
  moderatorLabel: string;
  reason: string;
  durationSeconds: number;
  endsAt: Date;
  timezone?: string;
}

export interface ReleaseNotificationData {
  targetDiscordId: string;
  targetLabel: string;
  moderatorLabel: string;
  automatic: boolean;
  restoredRoles: number;
  failedRoles: number;
}

function safe(value: string): string {
  return truncate(escapeDiscordMarkdown(value), 256);
}

export function buildJailEmbed(data: JailNotificationData): DiscordEmbed {
  return {
    title: 'Mitglied gejailt',
    color: ACCENT_COLOR,
    fields: [
      { name: 'Benutzer', value: `<@${data.targetDiscordId}> (${safe(data.targetLabel)})` },
      { name: 'Moderator', value: `<@${data.moderatorDiscordId}> (${safe(data.moderatorLabel)})` },
      { name: 'Dauer', value: formatDuration(data.durationSeconds * 1000), inline: true },
      {
        name: 'Ende',
        value: formatDateTime(data.endsAt, { timezone: data.timezone ?? branding.timezone }),
        inline: true,
      },
      { name: 'Grund', value: truncate(escapeDiscordMarkdown(data.reason), 1000) },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `${branding.name} ${branding.productName}` },
  };
}

export function buildReleaseEmbed(data: ReleaseNotificationData): DiscordEmbed {
  return {
    title: 'Mitglied freigelassen',
    color: SUCCESS_COLOR,
    fields: [
      { name: 'Benutzer', value: `<@${data.targetDiscordId}> (${safe(data.targetLabel)})` },
      {
        name: data.automatic ? 'Freigabe' : 'Moderator',
        value: data.automatic ? 'Automatisch (Ablauf der Strafe)' : safe(data.moderatorLabel),
      },
      {
        name: 'Rollen',
        value:
          data.failedRoles > 0
            ? `${data.restoredRoles} wiederhergestellt, ${data.failedRoles} nicht moeglich`
            : `${data.restoredRoles} wiederhergestellt`,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `${branding.name} ${branding.productName}` },
  };
}

/**
 * Discord-Benachrichtigungen sind bewusst "best effort": ein fehlender Channel
 * oder eine fehlende Berechtigung darf eine bereits ausgefuehrte Moderations-
 * aktion nicht scheitern lassen.
 */
export async function postNotification(
  gateway: DiscordGateway,
  channelId: string | null,
  embed: DiscordEmbed,
  content?: string,
): Promise<boolean> {
  if (!channelId) {
    return false;
  }
  try {
    await gateway.channels.send(channelId, { content, embeds: [embed] });
    return true;
  } catch (error) {
    log.warn('Discord-Benachrichtigung konnte nicht gesendet werden', { error, channelId });
    return false;
  }
}
