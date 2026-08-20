import { createLogger } from '@swisshub/logger';
import type { XpSource } from '@swisshub/database';
import { formatXp } from './card';
import type { LevelContext } from './context';

const logger = createLogger('level.notifications');

/**
 * Protokollnachrichten auf Discord.
 *
 * Der Vorgänger schrieb XP-Änderungen und Inaktivitäts-Abzüge in zwei eigene
 * Channels. Das bleibt erhalten: für das Team ist es die schnellste Antwort auf
 * "warum hat die Person plötzlich weniger XP?" - auch ohne Dashboard.
 *
 * Alle Nachrichten sind stumm. Wer im Protokoll auftaucht, soll davon nicht
 * benachrichtigt werden.
 */

const SILENT = { parse: [] as Array<'users' | 'roles' | 'everyone'> };

async function send(
  context: LevelContext,
  channelId: string | undefined,
  embed: { title: string; description: string; color: number },
): Promise<void> {
  if (!channelId) {
    return;
  }
  await context.gateway.channels
    .send(channelId, {
      embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      allowedMentions: SILENT,
    })
    .catch((error: unknown) =>
      logger.warn('Protokollnachricht konnte nicht gesendet werden', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
}

/** Quellen, die im XP-Protokoll auftauchen. Der Vorgänger nannte dieselben. */
const LOGGED_SOURCES = new Set<XpSource>(['ADMIN', 'GAME_WIN', 'GAME_LOSS']);

export interface XpChangeLog {
  discordId: string;
  /** Tatsächlich verbuchte Änderung. */
  delta: number;
  xpAfter: number;
  levelAfter: number;
  source: XpSource;
  reason?: string | null;
  actorDiscordId?: string | null;
}

/** Schreibt eine XP-Änderung ins Protokoll. */
export async function logXpChange(context: LevelContext, entry: XpChangeLog): Promise<void> {
  if (entry.delta === 0 || !LOGGED_SOURCES.has(entry.source)) {
    return;
  }

  const actor = entry.actorDiscordId ? `<@${entry.actorDiscordId}>` : '—';
  const lines = [
    `User: <@${entry.discordId}>`,
    entry.delta < 0
      ? `Verlust: **${formatXp(Math.abs(entry.delta))} XP**`
      : `Änderig: **+${formatXp(entry.delta)} XP**`,
    `Neui XP: **${formatXp(entry.xpAfter)}** (Level ${entry.levelAfter})`,
  ];
  if (entry.reason) {
    lines.push(`Grund: **${entry.reason}**`);
  }
  if (entry.source === 'ADMIN') {
    lines.push(`Usgführt vo: ${actor}`);
  }

  await send(context, context.settings.levelLogChannelId, {
    title: entry.delta < 0 ? '📉 XP Verlust' : '📈 XP Änderig',
    description: lines.join('\n'),
    color: context.accentColor,
  });
}

export interface DecayLog {
  discordId: string;
  lost: number;
  xpAfter: number;
  lastActivityAt: Date | null;
}

/** Meldet einen verrechneten Inaktivitäts-Abzug. */
export async function logDecay(context: LevelContext, entry: DecayLog): Promise<void> {
  if (entry.lost <= 0) {
    return;
  }
  const lines = [
    `User <@${entry.discordId}> het **Decay-Damage** becho.`,
    `Verlust: **${formatXp(entry.lost)} XP**`,
    `Neui XP: **${formatXp(entry.xpAfter)}**`,
  ];
  if (entry.lastActivityAt) {
    lines.push(`Letzti Aktivität: <t:${Math.floor(entry.lastActivityAt.getTime() / 1000)}:R>.`);
  }

  await send(context, context.settings.decayLogChannelId, {
    title: '💥 Inaktivität: XP abgezogen',
    description: lines.join('\n'),
    color: context.accentColor,
  });
}

/**
 * Meldet, dass jemand wieder aktiv ist und der Abzug endet.
 *
 * Der Vorgänger meldete zusätzlich den Beginn der Abzugsphase. Das entfällt:
 * die erste Abzugsmeldung sagt dasselbe, und die Startmeldung erzeugte nach
 * jedem Neustart eine Welle von Nachrichten, weil sie an einem Cache im
 * Arbeitsspeicher hing.
 */
export async function logDecayEnded(context: LevelContext, discordId: string): Promise<void> {
  await send(context, context.settings.decayLogChannelId, {
    title: '✅ Inaktivität: Abzug gestoppt',
    description: `User <@${discordId}> isch **wieder aktiv**. De Abzug wird ab jetzt gstoppt.`,
    color: context.accentColor,
  });
}
