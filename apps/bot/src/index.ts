import { Client, Events, GatewayIntentBits } from 'discord.js';
import { EnvironmentError, assertServerEnv, discordConfig, env, discordMocksEnabled } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { disconnectDatabase } from '@swisshub/database';
import { invalidateIdentity } from '@swisshub/auth';
import { ensureBootstrapRoles } from '@swisshub/permissions';
import { writeHeartbeat } from '@swisshub/modules';
import { createJobRunner } from './jobs';

const log = createLogger('bot');

/** Startet den SwissHub Discord-Bot. */
async function main(): Promise<void> {
  try {
    assertServerEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      log.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  await ensureBootstrapRoles();

  if (discordMocksEnabled()) {
    log.warn(
      'DEV_MOCK_DISCORD ist aktiv: der Bot verbindet sich NICHT mit Discord und fuehrt nur Datenbankjobs aus.',
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  const status = {
    online: false,
    wsPingMs: null as number | null,
    memberCount: null as number | null,
    botUserId: null as string | null,
    botUsername: null as string | null,
  };

  const jobs = createJobRunner(() => ({ ...status }));

  client.once(Events.ClientReady, async (readyClient) => {
    status.online = true;
    status.botUserId = readyClient.user.id;
    status.botUsername = readyClient.user.username;
    status.wsPingMs = Math.max(0, Math.round(readyClient.ws.ping));

    const guild = readyClient.guilds.cache.get(discordConfig.guildId);
    if (!guild) {
      log.error(
        'Der Bot ist nicht Mitglied der konfigurierten Guild. Bitte DISCORD_GUILD_ID pruefen und den Bot einladen.',
        { guildId: discordConfig.guildId },
      );
    } else {
      status.memberCount = guild.memberCount;
      log.info('Mit Discord verbunden', { guild: guild.name, members: guild.memberCount });
    }

    await writeHeartbeat({
      online: true,
      wsPingMs: status.wsPingMs,
      guildMemberCount: status.memberCount,
      botUserId: status.botUserId,
      botUsername: status.botUsername,
      connected: true,
    });
  });

  // Rollenaenderungen sofort im Identity-Cache entwerten, damit
  // Berechtigungen nicht auf veralteten Rollen basieren.
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (newMember.guild.id !== discordConfig.guildId) {
      return;
    }
    const before = [...oldMember.roles.cache.keys()].sort().join(',');
    const after = [...newMember.roles.cache.keys()].sort().join(',');
    if (before !== after) {
      await invalidateIdentity(newMember.id);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.guild.id === discordConfig.guildId) {
      await invalidateIdentity(member.id);
    }
  });

  client.on(Events.ShardDisconnect, () => {
    status.online = false;
    log.warn('Verbindung zu Discord verloren');
  });

  client.on(Events.ShardResume, () => {
    status.online = true;
    log.info('Verbindung zu Discord wiederhergestellt');
  });

  client.on(Events.Error, (error) => {
    log.error('Discord Client Fehler', { error });
  });

  const pingTimer = setInterval(() => {
    if (client.isReady()) {
      status.wsPingMs = Math.max(0, Math.round(client.ws.ping));
      status.memberCount = client.guilds.cache.get(discordConfig.guildId)?.memberCount ?? status.memberCount;
    }
  }, 15_000);
  pingTimer.unref?.();

  jobs.start();

  if (!discordMocksEnabled()) {
    await client.login(env.DISCORD_BOT_TOKEN);
  }

  // --- Graceful Shutdown ---------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info('Shutdown gestartet', { signal });
    clearInterval(pingTimer);
    await jobs.stop();
    await writeHeartbeat({
      online: false,
      botUserId: status.botUserId,
      botUsername: status.botUsername,
    }).catch(() => undefined);
    await client.destroy().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
    log.info('Shutdown abgeschlossen');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error('Unbehandelte Promise-Ablehnung', { reason }));
  process.on('uncaughtException', (error) => {
    log.error('Unbehandelte Ausnahme', { error });
    void shutdown('uncaughtException');
  });
}

void main().catch((error: unknown) => {
  log.error('Bot konnte nicht gestartet werden', { error });
  process.exit(1);
});
