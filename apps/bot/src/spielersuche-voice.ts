import { ChannelType, Events, type Client, type VoiceState } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { spielersuche } from '@swisshub/modules';

const log = createLogger('bot:spielersuche-voice');

/**
 * Voice-Tracking der Spielersuche.
 *
 * Zwei Aufgaben, beide aus demselben Discord-Ereignis:
 *   1. Zeit messen, solange jemand in einem Spielersuche-Kanal ist.
 *   2. Den Kanal löschen, sobald der letzte ihn verlässt.
 *
 * Gelöscht wird ausschliesslich, was diesem Modul gehört - erkennbar daran,
 * dass eine Suche in der Datenbank auf den Kanal zeigt. Fremde Sprachkanäle
 * bleiben unberührt, auch wenn sie leer sind.
 */
export function registerSpielersucheVoice(client: Client): void {
  client.on(Events.VoiceStateUpdate, (before, after) => {
    void handleVoiceStateUpdate(before, after).catch((error: unknown) => {
      log.error('Voice-Ereignis konnte nicht verarbeitet werden', { error });
    });
  });
}

async function handleVoiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
  if (before.channelId === after.channelId) {
    // Stummschalten, Video, Bildschirmfreigabe - für die Zeitmessung egal.
    return;
  }

  const discordId = after.member?.id ?? before.member?.id;
  if (!discordId) {
    return;
  }

  // --- Verlassen -----------------------------------------------------------
  if (before.channelId) {
    const match = await spielersuche.findMatchByVoiceChannel(before.channelId);
    if (match) {
      await spielersuche.endVoiceSession({ discordId, voiceChannelId: before.channelId });
      await cleanupIfEmpty(before);
    }
  }

  // --- Betreten ------------------------------------------------------------
  if (after.channelId) {
    const match = await spielersuche.findMatchByVoiceChannel(after.channelId);
    if (match) {
      await spielersuche.startVoiceSession({
        discordId,
        matchId: match.id,
        voiceChannelId: after.channelId,
      });
    }
  }
}

/**
 * Löscht einen leeren Spielersuche-Kanal.
 *
 * Die Mitgliederzahl kommt aus dem Discord-Cache des Bots - der weiss als
 * Einziger sicher, ob noch jemand drin sitzt.
 */
async function cleanupIfEmpty(state: VoiceState): Promise<void> {
  const channel = state.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice || channel.members.size > 0) {
    return;
  }

  const match = await spielersuche.findMatchByVoiceChannel(channel.id);
  if (!match) {
    return;
  }

  const context = await spielersuche.loadSpielersucheContext();
  if (!context.settings.voiceAutoCleanup) {
    return;
  }

  const deleted = await spielersuche.deleteVoiceChannel(match.id, context, 'Leerer Spielersuche-Kanal');
  if (!deleted) {
    return;
  }

  // Eine vollständige Gruppe, deren Kanal leer ist, gilt als erledigt.
  if (match.status === 'COMPLETE') {
    await spielersuche
      .closeSearch(match.id, { context, reason: 'VOICE_EMPTY' })
      .catch((error: unknown) =>
        log.warn('Suche konnte nach leerem Kanal nicht beendet werden', { error, matchId: match.id }),
      );
  }
}

/**
 * Schliesst nach einem Neustart alle Sessions, deren Mitglied nicht mehr im
 * Kanal sitzt.
 *
 * Ohne das würde eine Session aus der Zeit vor dem Neustart weiterlaufen und
 * beim nächsten Verlassen eine absurd lange Dauer erzeugen.
 */
export async function recoverVoiceSessions(client: Client, guildId: string | null): Promise<void> {
  const active = new Set<string>();

  const guild = guildId ? client.guilds.cache.get(guildId) : null;
  if (guild) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice) {
        continue;
      }
      for (const member of channel.members.values()) {
        active.add(`${channel.id}:${member.id}`);
      }
    }
  }

  const closed = await spielersuche.recoverStaleVoiceSessions(active);
  if (closed > 0) {
    log.info('Offene Voice-Sessions nach Neustart bereinigt', { closed });
  }
}
