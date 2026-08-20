import { randomUUID } from 'node:crypto';
import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { isModuleEnabled, spielersuche } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION, type CommandActor } from './context';

const log = createLogger('bot:commands:spielersuche');

/**
 * Slash Commands der Spielersuche.
 *
 * Wie beim Jail-Modul enthält diese Datei keine Fachlogik. Jeder Befehl ist
 * ein Adapter: Interaktion entgegennehmen, Berechtigung prüfen, Eingabe
 * validieren, Service aufrufen, antworten. Gesucht, beigetreten und beendet
 * wird ausschliesslich über `@swisshub/modules` - dieselben Funktionen, die
 * auch das Dashboard verwendet.
 */

const MODULE = spielersuche.SPIELERSUCHE_MODULE_ID;

export const SPIELERSUCHE_COMMAND_DEFINITIONS = [
  {
    name: 'spielersuche',
    description: 'Find passendi Mitspieler für dini nächsti Gaming-Session.',
    dmPermission: false,
    options: [
      {
        name: 'spiel',
        description: 'Wähl es konfigurierts Spiel us.',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
      {
        // Der Bindestrich stammt aus dem alten Bot (`rename`) und bleibt, damit
        // sich der Befehl für das Team unverändert anfühlt.
        name: 'gsuechti-spieler',
        description: 'Wie viel zuesätzlichi Spieler suechsch du?',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
        max_value: spielersuche.MAX_REQUESTED_PLAYERS,
      },
      {
        name: 'kommentar',
        description: 'Optionale Kommentar zur Spielersuechi.',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 500,
      },
    ],
  },
  {
    name: 'spielersuche-hilf',
    description: 'Zeigt, wie d SwissHub Spielersuechi funktioniert.',
    dmPermission: false,
    options: [],
  },
  {
    name: 'spielersuche-stats',
    description: 'Zeigt d Spielersuechi-Statistik.',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'Ohni Agab dini eigeni Statistik.',
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
  {
    name: 'spielersucheadmin',
    description: 'SwissHub Spielersuechi verwalte.',
    dmPermission: false,
    options: [
      {
        name: 'top',
        description: 'Zeigt d Top 5 vo de letzte 30 Täg.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: 'games',
        description: 'Zeigt alli konfigurierte Spiel.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: 'testmessage',
        description: 'Schickt d täglichi Onboarding-Nachricht sofort.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: 'close',
        description: 'Beendet e aktivi Spielersuechi.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'user',
            description: 'Wem sini Suechi beendet werde söll (ohni Agab dini eigeni).',
            type: ApplicationCommandOptionType.User,
            required: false,
          },
        ],
      },
      {
        name: 'settings',
        description: 'Zeigt d aktuelli Konfiguration.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
    ],
  },
] as const;

export const SPIELERSUCHE_COMMAND_NAMES = SPIELERSUCHE_COMMAND_DEFINITIONS.map(
  (definition) => definition.name,
);

function toUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.userMessage;
  }
  log.error('Spielersuche-Befehl fehlgeschlagen', { error });
  return 'Das het grad nöd funktioniert. Bitte spöter nomol probiere.';
}

/** Der Service erwartet genau diese Form des Aufrufers. */
function toSearchActor(actor: CommandActor): spielersuche.SpielersucheActor {
  return {
    discordId: actor.discordId,
    username: actor.username,
    avatarHash: actor.avatarHash,
  };
}

async function ensureEnabled(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (await isModuleEnabled(MODULE)) {
    return true;
  }
  await interaction.editReply({ content: 'D Spielersuechi isch im Dashboard deaktiviert.' });
  return false;
}

/**
 * Vorschläge für das Feld `spiel`.
 *
 * Die Liste kommt aus dem Dashboard - es gibt keine fest eingebauten Spiele
 * mehr. Discord erwartet die Antwort innerhalb von drei Sekunden, deshalb
 * ohne Umwege direkt aus der Datenbank.
 */
export async function handleSpielersucheAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'spiel') {
      await interaction.respond([]);
      return;
    }
    const games = await spielersuche.searchGamesForAutocomplete(String(focused.value ?? ''));
    await interaction.respond(games.map((game) => ({ name: game.name.slice(0, 100), value: game.id })));
  } catch (error) {
    log.warn('Autocomplete fehlgeschlagen', { error });
    await interaction.respond([]).catch(() => undefined);
  }
}

/** `/spielersuche` - dieselbe Engine wie das Dashboard-Formular. */
async function handleCreate(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.create)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }
  if (!(await ensureEnabled(interaction))) {
    return;
  }

  const parsed = spielersuche.createSearchSchema.safeParse({
    gameId: interaction.options.getString('spiel', true),
    requestedPlayers: interaction.options.getInteger('gsuechti-spieler', true),
    comment: interaction.options.getString('kommentar') ?? undefined,
    idempotencyKey: randomUUID(),
  });
  if (!parsed.success) {
    await interaction.editReply({
      content: parsed.error.issues[0]?.message ?? 'Bitte wähl es Spiel us de Vorschläg us.',
    });
    return;
  }

  try {
    const result = await spielersuche.createSearch(
      { ...parsed.data, source: 'SLASH_COMMAND' },
      toSearchActor(actor),
    );

    const lines = [
      `Dini Suechi isch veröffentlicht worde${
        result.match.channelId ? ` in <#${result.match.channelId}>` : ''
      }.`,
    ];
    if (result.match.voiceChannelId) {
      lines.push(`Voice-Channel: <#${result.match.voiceChannelId}>`);
    }
    if (!result.rolePinged && result.pingCooldownSeconds > 0) {
      const minutes = Math.max(1, Math.ceil(result.pingCooldownSeconds / 60));
      lines.push(`D Spielrolle isch wegem Cooldown nöd erneut pingt worde - no öppe **${minutes} Minute**.`);
    }
    lines.push(...result.warnings);

    await interaction.editReply({ content: lines.join('\n') });
  } catch (error) {
    await interaction.editReply({ content: toUserMessage(error) });
  }
}

/** `/spielersuche-stats` - eigene Statistik oder, mit Berechtigung, fremde. */
async function handleStats(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  const target = interaction.options.getUser('user');
  const isOwn = !target || target.id === actor.discordId;

  if (isOwn && !actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.statsViewOwn)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }
  if (!isOwn && !actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.statsViewAll)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const discordId = target?.id ?? actor.discordId;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [allTime, last30, context] = await Promise.all([
    spielersuche.getUserStats(discordId),
    spielersuche.getUserStats(discordId, since),
    spielersuche.loadSpielersucheContext(),
  ]);

  await interaction.editReply({
    embeds: [
      {
        title: '📊 Spielersuechi-Statistik',
        description: `Uswertig für <@${discordId}>`,
        color: context.accentColor,
        fields: [
          {
            name: 'Gesamt',
            value: [
              `Suechine gstartet: **${allTime.usageCount}×**`,
              `Voice-Ziit: **${spielersuche.formatVoiceDuration(allTime.voiceSeconds)}**`,
              `Voice-Sessions: **${allTime.voiceSessions}**`,
              `Teilnahme bi andere: **${allTime.joinedSearches}**`,
            ].join('\n'),
            inline: true,
          },
          {
            name: 'Letzti 30 Täg',
            value: [
              `Suechine gstartet: **${last30.usageCount}×**`,
              `Voice-Ziit: **${spielersuche.formatVoiceDuration(last30.voiceSeconds)}**`,
              `Voice-Sessions: **${last30.voiceSessions}**`,
            ].join('\n'),
            inline: true,
          },
          {
            name: 'Hiiwiis',
            value: 'Voice-Ziit wird nur i de Channels gmässe, wo d Spielersuechi selber erstellt het.',
          },
        ],
        footer: { text: context.settings.footerText },
      },
    ],
  });
}

/** `/spielersucheadmin top` - Rangliste der letzten 30 Tage. */
async function handleTop(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.statsViewAll)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [entries, context] = await Promise.all([
    spielersuche.getLeaderboard({ since, limit: 5 }),
    spielersuche.loadSpielersucheContext(),
  ]);

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  await interaction.editReply({
    embeds: [
      {
        title: '🏆 Top 5 · letzti 30 Täg',
        description:
          entries.length === 0
            ? 'Ide letzte 30 Täg sind no kei Date gsammlet worde.'
            : 'Rangliste nach Ahzahl Spielersuechine, bi Gliichstand nach Voice-Ziit.',
        color: context.accentColor,
        ...(entries.length > 0
          ? {
              fields: [
                {
                  name: 'Rangliste',
                  value: entries
                    .map(
                      (entry, index) =>
                        `${medals[index] ?? `${index + 1}.`} <@${entry.discordId}> — **${entry.usageCount} Suechine** · **${spielersuche.formatVoiceDuration(entry.voiceSeconds)} Voice**`,
                    )
                    .join('\n'),
                },
              ],
            }
          : {}),
        footer: { text: context.settings.footerText },
      },
    ],
  });
}

/** `/spielersucheadmin games` - dieselbe Liste wie im Dashboard. */
async function handleGames(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.gamesView)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const [games, context] = await Promise.all([
    spielersuche.listGames({ includeDisabled: true }),
    spielersuche.loadSpielersucheContext(),
  ]);

  await interaction.editReply({
    embeds: [
      {
        title: '🎮 Konfigurierti Spiel',
        description:
          games.length === 0
            ? 'Es isch no keis Spiel konfiguriert. Das gaht im Dashboard unter *Spielersuche → Spiele*.'
            : games
                .slice(0, 25)
                .map(
                  (game) =>
                    `${game.enabled ? '✅' : '⛔'} **${game.name}** → <@&${game.roleId}> · ${
                      game.maxSquadSize ? `max. ${game.maxSquadSize}` : 'unbegrenzt'
                    }`,
                )
                .join('\n'),
        color: context.accentColor,
        footer: { text: context.settings.footerText },
      },
    ],
  });
}

/** `/spielersucheadmin testmessage` - Onboarding sofort senden. */
async function handleTestMessage(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
): Promise<void> {
  if (!actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.onboardingManage)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  try {
    const sent = await spielersuche.sendOnboardingMessage({
      actor: { discordId: actor.discordId, username: actor.username },
      test: true,
    });
    await interaction.editReply({
      content: `D Onboarding-Nachricht isch i <#${sent.channelId}> gschickt worde.`,
    });
  } catch (error) {
    await interaction.editReply({ content: toUserMessage(error) });
  }
}

/** `/spielersucheadmin close` - eigene oder fremde Suche beenden. */
async function handleClose(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  const target = interaction.options.getUser('user');
  const isOwn = !target || target.id === actor.discordId;

  if (isOwn && !actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.closeOwn)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }
  if (!isOwn && !actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.closeAny)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const discordId = target?.id ?? actor.discordId;
  const active = await spielersuche.getActiveSearchesForCreator(discordId);
  const match = active[0];
  if (!match) {
    await interaction.editReply({
      content: isOwn ? 'Du hesch grad kei aktivi Suechi.' : `<@${discordId}> het grad kei aktivi Suechi.`,
    });
    return;
  }

  try {
    await spielersuche.closeSearch(match.id, {
      actor: { discordId: actor.discordId, username: actor.username },
      reason: 'SLASH_COMMAND',
    });
    await interaction.editReply({ content: `D Suechi für **${match.gameName}** isch beendet.` });
  } catch (error) {
    await interaction.editReply({ content: toUserMessage(error) });
  }
}

/** `/spielersucheadmin settings` - Konfiguration im Überblick. */
async function handleSettings(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.settingsView)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const [context, overview] = await Promise.all([
    spielersuche.loadSpielersucheContext(),
    spielersuche.getOverview(),
  ]);
  const settings = context.settings;

  await interaction.editReply({
    embeds: [
      {
        title: '⚙️ Spielersuechi-Ihstellige',
        description: 'Verwaltet wird alles im Dashboard unter *Spielersuche → Einstellungen*.',
        color: context.accentColor,
        fields: [
          {
            name: 'Discord',
            value: [
              `Channel: ${settings.searchChannelId ? `<#${settings.searchChannelId}>` : '❌ nöd gsetzt'}`,
              `Voice-Kategorie: ${settings.voiceCategoryId ? `<#${settings.voiceCategoryId}>` : '❌ nöd gsetzt'}`,
            ].join('\n'),
          },
          {
            name: 'Verhalte',
            value: [
              `Ablaufziit: **${settings.expiryHours} Stund**`,
              `Aktivi Suechine pro Person: **${settings.maxActiveSearchesPerUser}**`,
              `Rolle-Ping-Cooldown: **${settings.rolePingCooldownMinutes} Min.**`,
            ].join('\n'),
          },
          {
            name: 'Aktuell',
            value: [
              `Aktivi Suechine: **${overview.activeSearches}**`,
              `Konfigurierti Spiel: **${overview.configuredGames}**`,
              `Suechine letzti 30 Täg: **${overview.searchesLast30Days}**`,
            ].join('\n'),
          },
        ],
        footer: { text: settings.footerText },
      },
    ],
  });
}

/** Verteilt eine Interaktion an den passenden Adapter. */
export async function handleSpielersucheCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'De Befehl funktioniert nur uf eme Server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const actor = await buildCommandActor(interaction);

    if (interaction.commandName === 'spielersuche') {
      await handleCreate(interaction, actor);
      return;
    }
    if (interaction.commandName === 'spielersuche-hilf') {
      const context = await spielersuche.loadSpielersucheContext();
      await interaction.editReply(
        spielersuche.buildHelpMessage({
          footerText: context.settings.footerText,
          accentColor: context.accentColor,
          cooldownMinutes: context.settings.rolePingCooldownMinutes,
          maxActiveSearches: context.settings.maxActiveSearchesPerUser,
        }) as never,
      );
      return;
    }
    if (interaction.commandName === 'spielersuche-stats') {
      await handleStats(interaction, actor);
      return;
    }
    if (interaction.commandName === 'spielersucheadmin') {
      switch (interaction.options.getSubcommand(false)) {
        case 'top':
          await handleTop(interaction, actor);
          return;
        case 'games':
          await handleGames(interaction, actor);
          return;
        case 'testmessage':
          await handleTestMessage(interaction, actor);
          return;
        case 'close':
          await handleClose(interaction, actor);
          return;
        case 'settings':
          await handleSettings(interaction, actor);
          return;
        default:
          return;
      }
    }
  } catch (error) {
    log.error('Spielersuche-Befehl konnte nicht verarbeitet werden', {
      error,
      command: interaction.commandName,
    });
    await interaction.editReply({ content: toUserMessage(error) }).catch(() => undefined);
  }
}
