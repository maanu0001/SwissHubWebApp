import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  EnvironmentError,
  assertServerEnv,
  env,
  discordMocksEnabled,
  listDeprecatedEnvKeys,
} from '@swisshub/config';
import { clearGuildIdCache, tryResolveGuildId } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { disconnectDatabase } from '@swisshub/database';
import { invalidateIdentity } from '@swisshub/auth';
import { ensureBootstrapRoles } from '@swisshub/permissions';
import {
  getGuildConfig,
  importGuildFromEnvironment,
  invalidateSyncCaches,
  syncDiscord,
  writeHeartbeat,
} from '@swisshub/modules';
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

  // Bestehende Installationen: Guild aus der Umgebung einmalig übernehmen.
  await importGuildFromEnvironment().catch((error: unknown) => {
    log.warn('Guild konnte nicht aus der Umgebung übernommen werden', { error });
    return false;
  });
  await ensureBootstrapRoles();

  const deprecated = listDeprecatedEnvKeys();
  if (deprecated.length > 0) {
    log.warn(
      'Abgelöste Umgebungsvariablen gesetzt - sie dienen nur noch als Bootstrap und können nach der Einrichtung entfernt werden.',
      { keys: deprecated.map((entry) => entry.key) },
    );
  }

  const mockMode = discordMocksEnabled();
  if (mockMode) {
    log.warn(
      'DEV_MOCK_DISCORD ist aktiv: der Bot verbindet sich NICHT mit Discord und führt nur Datenbankjobs aus.',
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  const status = {
    // Im Mock-Modus gibt es keine Discord-Verbindung; der Prozess selbst läuft
    // aber und erledigt seine Jobs - das meldet der Heartbeat entsprechend.
    online: mockMode,
    wsPingMs: null as number | null,
    memberCount: null as number | null,
    botUserId: null as string | null,
    botUsername: mockMode ? 'swisshub-bot (Mock)' : (null as string | null),
  };

  const jobs = createJobRunner(() => ({ ...status }));

  /**
   * Aktive Guild-ID. Sie kann sich zur Laufzeit ändern (Einrichtungsassistent),
   * deshalb wird sie nicht eingefroren, sondern regelmässig neu aufgelöst.
   */
  let guildId: string | null = await tryResolveGuildId();

  const refreshGuildId = async (): Promise<string | null> => {
    clearGuildIdCache();
    guildId = await tryResolveGuildId();
    return guildId;
  };

  const isActiveGuild = (candidate: string): boolean => guildId === null || candidate === guildId;

  client.once(Events.ClientReady, async (readyClient) => {
    status.online = true;
    status.botUserId = readyClient.user.id;
    status.botUsername = readyClient.user.username;
    status.wsPingMs = Math.max(0, Math.round(readyClient.ws.ping));

    await refreshGuildId();

    if (!guildId) {
      log.warn(
        'Es ist noch kein Discord-Server verbunden. Bitte den Einrichtungsassistenten im Dashboard abschliessen.',
      );
    } else {
      const guild = readyClient.guilds.cache.get(guildId);
      if (!guild) {
        log.error(
          'Der Bot ist nicht Mitglied des verbundenen Discord-Servers. Bitte den Bot einladen oder den Server im Dashboard neu verbinden.',
          { guildId },
        );
      } else {
        status.memberCount = guild.memberCount;
        log.info('Mit Discord verbunden', { guild: guild.name, members: guild.memberCount });
      }

      // Beim Start einmal synchronisieren, damit Rollen- und Channel-Auswahl
      // im Dashboard sofort aktuell sind.
      const summary = await syncDiscord({ trigger: 'startup' }).catch((error: unknown) => {
        log.warn('Start-Sync fehlgeschlagen', { error });
        return null;
      });
      if (summary?.success) {
        log.info('Start-Sync abgeschlossen', { roles: summary.roles, channels: summary.channels });
      }
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

  // Rollenänderungen sofort im Identity-Cache entwerten, damit
  // Berechtigungen nicht auf veralteten Rollen basieren.
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (!isActiveGuild(newMember.guild.id)) {
      return;
    }
    const before = [...oldMember.roles.cache.keys()].sort().join(',');
    const after = [...newMember.roles.cache.keys()].sort().join(',');
    if (before !== after) {
      await invalidateIdentity(newMember.id);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (isActiveGuild(member.guild.id)) {
      await invalidateIdentity(member.id);
    }
  });

  /**
   * Ereignisgesteuerte Cache-Invalidierung.
   *
   * Ändert sich auf Discord etwas an Rollen oder Channels, wird nicht sofort
   * ein voller Sync ausgelöst (das würde bei Massenänderungen unnötig viele
   * Anfragen erzeugen), sondern kurz gesammelt und dann einmal synchronisiert.
   */
  let syncTimer: NodeJS.Timeout | null = null;
  const scheduleSync = (reason: string): void => {
    invalidateSyncCaches();
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncDiscord({ trigger: 'event' })
        .then((summary) => {
          if (summary.success) {
            log.debug('Sync nach Discord-Ereignis', { reason, roles: summary.roles });
          }
        })
        .catch((error: unknown) => log.warn('Sync nach Discord-Ereignis fehlgeschlagen', { error }));
    }, 5_000);
  };

  for (const event of [Events.GuildRoleCreate, Events.GuildRoleUpdate, Events.GuildRoleDelete] as const) {
    client.on(event, () => scheduleSync(event));
  }
  for (const event of [Events.ChannelCreate, Events.ChannelUpdate, Events.ChannelDelete] as const) {
    client.on(event, () => scheduleSync(event));
  }
  client.on(Events.GuildUpdate, () => scheduleSync(Events.GuildUpdate));

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
      if (guildId) {
        status.memberCount = client.guilds.cache.get(guildId)?.memberCount ?? status.memberCount;
      }
    }
  }, 15_000);

  // Die Guild kann im Dashboard verbunden werden, während der Bot bereits
  // läuft - dann ohne Neustart übernehmen.
  const guildWatchTimer = setInterval(() => {
    void (async () => {
      const previous = guildId;
      const config = await getGuildConfig({ force: true }).catch(() => null);
      if (!config || config.guildId === previous) {
        return;
      }
      await refreshGuildId();
      log.info('Verbundener Discord-Server geändert', { guildId });
      if (guildId) {
        await syncDiscord({ trigger: 'event' }).catch(() => undefined);
      }
    })();
  }, 60_000);

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
    clearInterval(guildWatchTimer);
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
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
