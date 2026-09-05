import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  EnvironmentError,
  assertServerEnv,
  discordMocksEnabled,
  listDeprecatedEnvKeys,
} from '@swisshub/config';
import { discordConfig } from '@swisshub/config';
import { clearGuildIdCache, discord, tryResolveGuildId } from '@swisshub/discord';
import { assertIntegrationsReady, ensureSystemBot } from '@swisshub/secrets';
import { createLogger } from '@swisshub/logger';
import { disconnectDatabase } from '@swisshub/database';
import { invalidateIdentity } from '@swisshub/auth';
import { ensureBootstrapRoles } from '@swisshub/permissions';
import {
  backfillModuleViewPermissions,
  analytics,
  getGuildConfig,
  importGuildFromEnvironment,
  jail,
  invalidateSyncCaches,
  syncDiscord,
  writeHeartbeat,
} from '@swisshub/modules';
import { createJobRunner } from './jobs';
import { startIntegrationWatch } from './integration-reload';
import { registerVoteJailHandler } from './vote-jail';
import { registerCommandHandler, registerCommands } from './commands/register';
import { registerSpielersucheButtons } from './spielersuche-buttons';
import { registerRaffleButtons } from './raffle-buttons';
import { registerCalendarInteractions } from './calendar-interactions';
import { registerRejectConfirmation, registerVerification } from './verification';
import { recoverVoiceSessions, registerSpielersucheVoice } from './spielersuche-voice';
import { registerVoicePresence } from './voice-presence';
import { registerLevelGameButtons } from './level-games';
import { registerTicketInteractions } from './ticket-interactions';
import { registerTicketMessageSync } from './ticket-messages';
import { registerAnalyticsEvents, anwesendeImVoice } from './analytics-events';
import { registerModerationEvents } from './moderation-events';
import { registerAutomationEvents } from './automation-events';
import { registerTournamentInteractions } from './tournament-interactions';
import { recoverVoiceHub, registerVoiceHub } from './voice-hub';
import { registerVoiceInteractions } from './voice-interactions';
import {
  recoverVoiceMembers,
  registerLevelMessageXp,
  registerLevelVoiceTracking,
  runVoiceXpSweep,
} from './level-events';

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

  /**
   * Zuerst die zentralen Zugangsdaten.
   *
   * Der Bot-Token liegt verschluesselt in der Datenbank und nicht mehr
   * zwingend in der Umgebung (§19). Also: Datenbank -> Geheimnis laden ->
   * entschluesseln -> und erst danach alles, was einen Token braucht. `strikt`
   * heisst hier: ohne Token hat dieser Prozess keinen Zweck, dann soll er
   * sich beschweren statt still ohne Verbindung weiterzulaufen.
   */
  if (!discordMocksEnabled()) {
    try {
      await assertIntegrationsReady({ strikt: true });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    // Damit der Systembot in der Uebersicht erscheint, auch wenn sein Token
    // noch aus der Umgebung stammt.
    await ensureSystemBot().catch((error: unknown) => {
      log.warn('Eintrag des Systembots konnte nicht angelegt werden', { error });
      return null;
    });
  }

  // Bestehende Installationen: Guild aus der Umgebung einmalig übernehmen.
  await importGuildFromEnvironment().catch((error: unknown) => {
    log.warn('Guild konnte nicht aus der Umgebung übernommen werden', { error });
    return false;
  });
  await ensureBootstrapRoles();

  // Derselbe Nachtrag wie in der WebApp - je nachdem, was zuerst startet.
  // Er ist wiederholbar; der zweite Lauf findet nichts mehr zu tun.
  await backfillModuleViewPermissions().catch((error: unknown) => {
    log.error('«Modul sehen» konnte nicht nachgetragen werden', { error });
  });

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

  /**
   * Darf der Bot Nachrichteninhalte empfangen?
   *
   * Das Ticket-Modul spiegelt Nachrichten aus den Ticket-Kanälen; dafür
   * braucht es das privilegierte Intent «Message Content». Angefordert wird
   * es nur, wenn es im Developer Portal auch freigeschaltet ist: discord.js
   * verweigert sonst den Login, und der ganze Bot bliebe unten - wegen einer
   * Funktion, die nur ein Modul braucht.
   */
  const messageContent = mockMode ? false : await discord.bot.messageContentAllowed().catch(() => false);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      // Nachrichten-Ereignisse für XP im Chat und für die Ticket-Kanäle.
      GatewayIntentBits.GuildMessages,
      ...(messageContent ? [GatewayIntentBits.MessageContent] : []),
      // Voice-Zustände: XP für Zeit im Sprachkanal und das Aufräumen der
      // Spielersuche-Kanäle. Ohne dieses Intent liefert Discord die
      // Ereignisse nicht - die Handler liefen bisher ins Leere.
      GatewayIntentBits.GuildVoiceStates,
      // Bann und Entbannung als Ereignis - ohne dieses Intent liefert Discord
      // sie nicht, und im Verlauf fehlte genau das, was am schwersten wiegt.
      GatewayIntentBits.GuildModeration,
    ],
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

  const jobs = createJobRunner(
    () => ({ ...status }),
    () => runVoiceXpSweep(client, guildId),
  );

  // Button-Klicks der Vote-Jail-Abstimmungen entgegennehmen.
  registerVoteJailHandler(client);
  // Verifikation: Beitritt, Nachricht und die beiden Knöpfe der Moderation.
  registerVerification(client);
  registerRejectConfirmation(client);
  // Slash Commands (/jail, /jail_free, /vote_jail, ...). Die Befehle sind
  // reine Adapter auf dieselben Services, die auch das Dashboard nutzt.
  registerCommandHandler(client);
  // Knöpfe und Voice-Tracking der Spielersuche.
  registerSpielersucheButtons(client);
  registerRaffleButtons(client);
  registerSpielersucheVoice(client);
  registerVoicePresence(client);
  // XP aus Nachrichten und Voice sowie die Knöpfe der XP-Spiele.
  registerLevelMessageXp(client);
  registerLevelVoiceTracking(client);
  registerLevelGameButtons(client);
  // Ticket-Panels, Formular und die Knöpfe im Ticket-Kanal.
  registerTicketInteractions(client);
  registerTicketMessageSync(client, messageContent);
  // Check-in, Bereitmeldung, Resultat und der Ruf nach der Turnierleitung.
  registerTournamentInteractions(client);
  // An- und Abmeldung direkt unter der Kalender-Ankündigung.
  registerCalendarInteractions(client);
  // Join-to-Create und das Bedienfeld im Talk.
  registerVoiceHub(client);
  registerVoiceInteractions(client);

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

  // Das Ereignisprotokoll. Erst hier, weil es `isActiveGuild` braucht; ob
  // tatsaechlich aufgezeichnet wird, entscheidet das Modul selbst - hier
  // werden nur die Zuhoerer angemeldet.
  registerAnalyticsEvents(client, isActiveGuild, messageContent);
  // Massnahmen, die direkt in Discord ergriffen wurden. Bewusst getrennt von
  // der Statistik: die Akte darf nicht davon abhaengen, ob jemand das
  // Analytics-Modul eingeschaltet hat.
  registerModerationEvents(client, isActiveGuild);

  // Dieselbe Stelle, derselbe Grund: die Zuhoerer der Automation Engine
  // brauchen `isActiveGuild`. Ob ueberhaupt geschrieben wird, entscheidet das
  // Automation-Modul selbst.
  registerAutomationEvents(client, isActiveGuild);

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

      // Slash Commands für den verbundenen Server registrieren.
      await registerCommands(readyClient, guildId);

      // Wer schon im Voice sitzt, soll nach einem Neustart weiter XP bekommen,
      // ohne den Kanal erst verlassen zu müssen.
      const inVoice = recoverVoiceMembers(readyClient, guildId);
      if (inVoice > 0) {
        log.info('Anwesende im Voice übernommen', { members: inVoice });
      }

      // Voice-Sessions, die ein Neustart offen gelassen hat, sauber schliessen.
      await recoverVoiceSessions(readyClient, guildId).catch((error: unknown) =>
        log.warn('Voice-Sessions konnten nicht bereinigt werden', { error }),
      );

      // Dasselbe fuer die Sprachabschnitte der Statistik. Wer noch im Kanal
      // sitzt, behaelt seinen offenen Abschnitt; alle anderen werden bis zum
      // letzten Herzschlag des Bots geschlossen - weiter reicht unser Wissen
      // nicht.
      await analytics
        .schliesseVerwaisteAbschnitte(guildId, anwesendeImVoice(readyClient, guildId))
        .catch((error: unknown) =>
          log.warn('Verwaiste Sprachabschnitte konnten nicht geschlossen werden', { error }),
        );

      // Mitgliederzahl des Tages festhalten - der Mitgliederverlauf entsteht
      // aus diesen Momentaufnahmen und nicht aus Bei- und Austritten allein.
      if (status.memberCount !== null) {
        await analytics.haltMitgliederzahlFest(guildId, status.memberCount).catch(() => undefined);
      }

      // Temporäre Talks: leere aufräumen, verwaiste übergeben, fehlende
      // Bedienfelder ergänzen. Der Bot war weg und hat in der Zeit keine
      // Ereignisse gesehen.
      await recoverVoiceHub(guildId).catch((error: unknown) =>
        log.warn('Voice Hub konnte nach dem Start nicht abgeglichen werden', { error }),
      );

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
    if (!isActiveGuild(member.guild.id)) {
      return;
    }
    await invalidateIdentity(member.id);
    // Ein Jail endet nicht dadurch, dass jemand den Server verlässt. Der
    // Eintrag bleibt offen und wartet auf den Wiedereintritt.
    await jail.markMemberLeftDuringJail(member.id).catch((error: unknown) => {
      log.warn('Austritt konnte nicht am Jail vermerkt werden', { error, member: member.id });
    });
  });

  /**
   * Wiedereintritt während eines laufenden Jails.
   *
   * Ohne diese Behandlung liesse sich ein Jail durch Verlassen und erneutes
   * Beitreten umgehen. Die Entscheidung trifft der Jail-Service anhand der
   * Datenbank - hier wird nur das Ereignis weitergereicht.
   */
  client.on(Events.GuildMemberAdd, async (member) => {
    if (!isActiveGuild(member.guild.id)) {
      return;
    }
    try {
      const outcome = await jail.reapplyJailOnRejoin(member.id);
      if (outcome !== 'none') {
        log.info('Wiedereintritt eines gejailten Mitglieds behandelt', { member: member.id, outcome });
      }
    } catch (error) {
      log.error('Jail konnte beim Wiedereintritt nicht behandelt werden', { error, member: member.id });
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
        // Die Befehle hängen an der Guild - nach einem Wechsel neu setzen.
        await registerCommands(client, guildId).catch(() => undefined);
      }
    })();
  }, 60_000);

  jobs.start();

  // Der Token kommt aus der zentralen Verwaltung; steht dort nichts, gilt
  // weiterhin die Umgebung - `discordConfig` entscheidet das an einer Stelle.
  const botToken = discordConfig.botToken;
  if (!mockMode) {
    await client.login(botToken);
  }

  /**
   * Aenderungen aus dem Dashboard uebernehmen.
   *
   * Laeuft auch im Mock-Modus, damit ein gewechselter AI-Schluessel dort
   * ebenso greift - nur verbunden wird dann nicht.
   */
  const integrationen = startIntegrationWatch(client, {
    anfangsToken: mockMode ? null : botToken,
    verbinden: !mockMode,
  });

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
    integrationen.stop();
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    await jobs.stop();

    // Laufende Sprachabschnitte jetzt schliessen, solange wir das Ende noch
    // kennen. Nach einem sauberen Herunterfahren muss sie niemand spaeter
    // schaetzen.
    if (guildId) {
      await analytics.schliesseVerwaisteAbschnitte(guildId).catch((error: unknown) => {
        log.warn('Sprachabschnitte konnten beim Herunterfahren nicht geschlossen werden', { error });
        return 0;
      });
    }

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
