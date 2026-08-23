import { ChannelType, Events, type Client, type VoiceState } from 'discord.js';
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const log = createLogger('bot:voice-presence');

/**
 * Voice-Zustaende mitschreiben.
 *
 * Discord liefert sie ausschliesslich ueber das Gateway. Die WebApp ist ein
 * eigener Prozess und sieht davon nichts - ohne diese Tabelle koennte der
 * Musikplayer nicht wissen, in welchem Kanal der Aufrufende sitzt, und
 * muesste ihn eine Session aus einer Liste waehlen lassen. Genau das soll er
 * nicht: der Kanal, in dem jemand steht, ist die Antwort.
 *
 * Geschrieben wird nur der aktuelle Zustand, keine Historie.
 */
export function registerVoicePresence(client: Client): void {
  client.on(Events.VoiceStateUpdate, (before, after) => {
    void aktualisiere(before, after).catch((error: unknown) => {
      log.warn('Voice-Zustand konnte nicht geschrieben werden', {
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    });
  });

  client.once(Events.ClientReady, () => {
    void grundzustand(client).catch((error: unknown) => {
      log.warn('Voice-Zustand konnte beim Start nicht gelesen werden', {
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    });
  });
}

async function aktualisiere(before: VoiceState, after: VoiceState): Promise<void> {
  const discordId = after.id || before.id;
  const kanal = after.channel;

  if (!kanal || kanal.type !== ChannelType.GuildVoice) {
    await prisma.voicePresence.deleteMany({ where: { discordId } });
    return;
  }

  await prisma.voicePresence.upsert({
    where: { discordId },
    create: {
      discordId,
      guildId: kanal.guild.id,
      channelId: kanal.id,
      channelName: kanal.name,
      isBot: after.member?.user.bot ?? false,
    },
    update: {
      guildId: kanal.guild.id,
      channelId: kanal.id,
      channelName: kanal.name,
      isBot: after.member?.user.bot ?? false,
    },
  });
}

/**
 * Nach dem Start einmal aufraeumen.
 *
 * Wer waehrend eines Neustarts den Kanal gewechselt hat, hinterliesse sonst
 * einen falschen Eintrag - und der Player zeigte auf einen Kanal, in dem
 * niemand mehr sitzt.
 */
async function grundzustand(client: Client): Promise<void> {
  const gesehen: string[] = [];

  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      const kanal = state.channel;
      if (!kanal || kanal.type !== ChannelType.GuildVoice) {
        continue;
      }
      gesehen.push(state.id);
      await prisma.voicePresence.upsert({
        where: { discordId: state.id },
        create: {
          discordId: state.id,
          guildId: guild.id,
          channelId: kanal.id,
          channelName: kanal.name,
          isBot: state.member?.user.bot ?? false,
        },
        update: {
          guildId: guild.id,
          channelId: kanal.id,
          channelName: kanal.name,
          isBot: state.member?.user.bot ?? false,
        },
      });
    }
  }

  const entfernt = await prisma.voicePresence.deleteMany({
    where: { discordId: { notIn: gesehen.length > 0 ? gesehen : ['-'] } },
  });
  if (entfernt.count > 0) {
    log.info('Veraltete Voice-Zustände entfernt', { anzahl: entfernt.count });
  }
}
