import {
  ApplicationCommandOptionType,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { isModuleEnabled, level } from '@swisshub/modules';
import { renderLevelCard } from '../level-card';
import { startGame } from '../level-games';
import { NO_PERMISSION, buildCommandActor, type CommandActor } from './context';

const log = createLogger('bot:commands:level');

/**
 * Slash Commands des Level-Systems.
 *
 * Reine Adapter: Interaktion entgegennehmen, Berechtigung prüfen, Service
 * aufrufen, antworten. Gerechnet wird ausschliesslich in `@swisshub/modules` -
 * denselben Funktionen, die auch das Dashboard verwendet.
 *
 * Die Befehlsnamen entsprechen dem alten Bot, damit sich für die Community
 * nichts ändert.
 */

const MODULE = level.LEVEL_MODULE_ID;
const P = level.LEVEL_PERMISSIONS;

const userOption = (description: string, required = false) =>
  ({
    name: 'user',
    description,
    type: ApplicationCommandOptionType.User,
    required,
  }) as const;

const betOption = {
  name: 'einsatz',
  description: 'Wie viel XP setzsch du?',
  type: ApplicationCommandOptionType.Integer,
  required: true,
  min_value: 1,
} as const;

const gegnerOption = {
  name: 'gegner',
  description: 'Gege wen wotsch spiele?',
  type: ApplicationCommandOptionType.User,
  required: true,
} as const;

export const LEVEL_COMMAND_DEFINITIONS = [
  {
    name: 'level',
    description: 'Zeigt dis Level und dini XP.',
    dmPermission: false,
    options: [userOption('Ohni Agab dis eigets Level.')],
  },
  {
    name: 'leaderboard',
    description: 'Zeigt d Rangliste vom Server.',
    dmPermission: false,
    options: [
      {
        name: 'azahl',
        description: 'Wie viel Plätz agezeigt werde (Standard 10).',
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 25,
      },
    ],
  },
  {
    name: 'level_stats',
    description: 'Zeigt detaillierti XP-Statistike.',
    dmPermission: false,
    options: [userOption('Ohni Agab dini eigeni Statistik.')],
  },
  {
    name: 'global_stats',
    description: 'Zeigt d XP-Kennzahle vom ganze Server.',
    dmPermission: false,
    options: [],
  },
  {
    name: 'check_user',
    description: 'Zeigt de XP-Stand und d Aktivität vo eme Mitglied.',
    dmPermission: false,
    options: [userOption('Wele Mitglied?', true)],
  },
  {
    name: 'game_leaderboard',
    description: 'Zeigt d Top-Spieler je XP-Spiel.',
    dmPermission: false,
    options: [],
  },

  // --- Spiele ---------------------------------------------------------------
  {
    name: 'xp_battle',
    description: '50/50 XP-Battle gege en User (95% Uszahlig).',
    dmPermission: false,
    options: [gegnerOption, betOption],
  },
  {
    name: 'xp_ssp',
    description: 'XP Schere-Stei-Papier (first to 2, 95% Uszahlig).',
    dmPermission: false,
    options: [gegnerOption, betOption],
  },
  {
    name: 'xp_ttt',
    description: 'XP TicTacToe (3x3, 95% Uszahlig).',
    dmPermission: false,
    options: [gegnerOption, betOption],
  },
  {
    name: 'xp_4gewinnt',
    description: 'XP 4-Gwünnt gege en User (95% Uszahlig).',
    dmPermission: false,
    options: [gegnerOption, betOption],
  },

  // --- Verwaltung -----------------------------------------------------------
  {
    name: 'give_xp',
    description: 'Git eme User XP.',
    dmPermission: false,
    options: [
      userOption('Wem?', true),
      {
        name: 'azahl',
        description: 'Wie viel XP?',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
      },
      {
        name: 'grund',
        description: 'Optionale Grund fürs Protokoll.',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 200,
      },
    ],
  },
  {
    name: 'rem_xp',
    description: 'Nimmt eme User XP wäg.',
    dmPermission: false,
    options: [
      userOption('Wem?', true),
      {
        name: 'azahl',
        description: 'Wie viel XP?',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
      },
      {
        name: 'grund',
        description: 'Optionale Grund fürs Protokoll.',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 200,
      },
    ],
  },
  {
    name: 'set_xp_boost',
    description: 'Setzt de globali XP-Boost.',
    dmPermission: false,
    options: [
      {
        name: 'wert',
        description: 'Faktor, z.B. 1 für normal oder 2 für doppelt.',
        type: ApplicationCommandOptionType.Number,
        required: true,
        min_value: 0,
        max_value: 100,
      },
    ],
  },
  {
    name: 'add_noxp_channel',
    description: 'Sperrt XP in eme Channel.',
    dmPermission: false,
    options: [
      {
        name: 'channel',
        description: 'Text- oder Voice-Channel ohni XP.',
        type: ApplicationCommandOptionType.Channel,
        required: true,
        channel_types: [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice],
      },
    ],
  },
  {
    name: 'rem_noxp_channel',
    description: 'Git XP in eme Channel wieder frei.',
    dmPermission: false,
    options: [
      {
        name: 'channel',
        description: 'Channel, wo wieder XP gäh söll.',
        type: ApplicationCommandOptionType.Channel,
        required: true,
        channel_types: [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice],
      },
    ],
  },
  {
    name: 'list_noxp_channel',
    description: 'Zeigt alli Channels ohni XP.',
    dmPermission: false,
    options: [],
  },
  {
    name: 'set_announce_levels',
    description: 'Legt fescht, welchi Level agkündet werde.',
    dmPermission: false,
    options: [
      {
        name: 'level',
        description: 'Level mit Komma trennt, z.B. "5,10,31". Leer = alli.',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 200,
      },
    ],
  },
  {
    name: 'xp_voicemute',
    description: 'Schaltet XP bi Stummschaltig i oder us.',
    dmPermission: false,
    options: [
      {
        name: 'status',
        description: 'Kei XP bi Stummschaltig?',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'a (kei XP wenn stumm)', value: 'on' },
          { name: 'us (XP au wenn stumm)', value: 'off' },
        ],
      },
    ],
  },
  {
    name: 'xp_voicemute_cooldown',
    description: 'Nachlauf, bevor Stummschaltig XP sperrt.',
    dmPermission: false,
    options: [
      {
        name: 'sekunde',
        description: '0 = sofort kei XP, 60 = no eini Minute XP.',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 0,
        max_value: 86_400,
      },
    ],
  },
  {
    name: 'xp_mutelevels',
    description: 'Welchi Art Stummschaltig zellt.',
    dmPermission: false,
    options: [
      {
        name: 'modus',
        description: 'sound = selber stumm, voice = vom Server stumm, beide = beides.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'sound', value: 'sound' },
          { name: 'voice', value: 'voice' },
          { name: 'beide', value: 'beide' },
        ],
      },
    ],
  },
  {
    name: 'xp_getxpwhilealone',
    description: 'XP au, wenn me elei im Voice isch?',
    dmPermission: false,
    options: [
      {
        name: 'status',
        description: 'a = XP au elei, us = nur mit andere im Channel.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'a (XP au elei)', value: 'on' },
          { name: 'us (nur mit andere)', value: 'off' },
        ],
      },
    ],
  },
  {
    name: 'xp_voicemute_status',
    description: 'Zeigt d Iistellige zu XP bi Stummschaltig.',
    dmPermission: false,
    options: [],
  },
] as const;

export const LEVEL_COMMAND_NAMES = new Set<string>(
  LEVEL_COMMAND_DEFINITIONS.map((definition) => definition.name),
);

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

async function replyError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
  const message =
    error instanceof AppError ? error.userMessage : 'Das het nid klappet. Bitte spöter nomal probiere.';
  if (!(error instanceof AppError)) {
    log.error('Level-Befehl fehlgeschlagen', { error, command: interaction.commandName });
  }
  const payload = { content: message, ...ephemeral };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message }).catch(() => undefined);
  } else {
    await interaction.reply(payload).catch(() => undefined);
  }
}

/**
 * Mitglied auflösen.
 *
 * Der Cache ist nach einem Neustart leer; ohne Nachladen fehlten Anzeigename
 * und Rollen genau dann, wenn sie gebraucht werden.
 */
async function resolveMember(
  interaction: ChatInputCommandInteraction,
  discordId: string,
): Promise<GuildMember | null> {
  const guild = interaction.guild;
  if (!guild) {
    return null;
  }
  return guild.members.cache.get(discordId) ?? (await guild.members.fetch(discordId).catch(() => null));
}

/** Verwaltender Aufrufer für Service-Aufrufe. */
const toLevelActor = (actor: CommandActor): level.LevelActor => ({
  discordId: actor.discordId,
  username: actor.username,
});

export async function handleLevelCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isModuleEnabled(MODULE))) {
    await interaction.reply({ content: 'S Level-System isch grad usgschalte.', ...ephemeral });
    return;
  }

  const actor = await buildCommandActor(interaction);
  const context = await level.loadLevelContext();

  try {
    switch (interaction.commandName) {
      case 'level':
        await handleLevel(interaction, context);
        return;
      case 'leaderboard':
        await handleLeaderboard(interaction, context);
        return;
      case 'level_stats':
        await handleLevelStats(interaction, context);
        return;
      case 'global_stats':
        await handleGlobalStats(interaction, context);
        return;
      case 'check_user':
        await handleCheckUser(interaction, actor, context);
        return;
      case 'game_leaderboard':
        await handleGameLeaderboard(interaction, context);
        return;
      case 'xp_battle':
      case 'xp_ssp':
      case 'xp_ttt':
      case 'xp_4gewinnt':
        await handleGameStart(interaction, actor, context);
        return;
      case 'give_xp':
      case 'rem_xp':
        await handleAdjust(interaction, actor);
        return;
      case 'set_xp_boost':
        await handleSetting(
          interaction,
          actor,
          P.rulesManage,
          {
            xpBoost: interaction.options.getNumber('wert', true),
          },
          (value) => `XP-Boost stoht jetzt uf **${value.xpBoost}**.`,
        );
        return;
      case 'add_noxp_channel':
        await handleNoXpChannel(interaction, actor, 'add');
        return;
      case 'rem_noxp_channel':
        await handleNoXpChannel(interaction, actor, 'remove');
        return;
      case 'list_noxp_channel':
        await handleListNoXp(interaction, actor, context);
        return;
      case 'set_announce_levels':
        await handleSetting(
          interaction,
          actor,
          P.rulesManage,
          {
            announceLevels: interaction.options.getString('level') ?? '',
          },
          (value) =>
            value.announceLevels
              ? `Es werde nur no die Level agkündet: **${value.announceLevels}**.`
              : 'Es wird jetzt **jede** Levelufstig agkündet.',
        );
        return;
      case 'xp_voicemute':
        await handleSetting(
          interaction,
          actor,
          P.rulesManage,
          {
            voiceMuteBlocksXp: interaction.options.getString('status', true) === 'on',
          },
          (value) =>
            value.voiceMuteBlocksXp
              ? 'Bi Stummschaltig gits **kei** XP meh.'
              : 'Bi Stummschaltig gits **wiiter** XP.',
        );
        return;
      case 'xp_voicemute_cooldown':
        await handleSetting(
          interaction,
          actor,
          P.rulesManage,
          {
            voiceMuteCooldownSeconds: interaction.options.getInteger('sekunde', true),
          },
          (value) => `Nachlauf bi Stummschaltig: **${value.voiceMuteCooldownSeconds} Sekunde**.`,
        );
        return;
      case 'xp_mutelevels':
        await handleSetting(
          interaction,
          actor,
          P.rulesManage,
          {
            voiceMuteMode: interaction.options.getString('modus', true) as 'sound' | 'voice' | 'beide',
          },
          (value) => `Es zellt jetzt: **${value.voiceMuteMode}**.`,
        );
        return;
      case 'xp_getxpwhilealone':
        await handleSetting(
          interaction,
          actor,
          P.rulesManage,
          {
            xpWhileAlone: interaction.options.getString('status', true) === 'on',
          },
          (value) =>
            value.xpWhileAlone
              ? 'Es git au XP, wenn me elei im Voice isch.'
              : 'Elei im Voice gits **kei** XP meh.',
        );
        return;
      case 'xp_voicemute_status':
        await handleVoiceMuteStatus(interaction, actor, context);
        return;
      default:
        await interaction.reply({ content: 'Unbekannte Befehl.', ...ephemeral });
    }
  } catch (error) {
    await replyError(interaction, error);
  }
}

type Ctx = Awaited<ReturnType<typeof level.loadLevelContext>>;

async function handleLevel(interaction: ChatInputCommandInteraction, context: Ctx): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply();

  // Den fälligen Abzug vorher nachholen - sonst zeigt die Karte einen Stand,
  // der beim nächsten Hintergrundlauf sinkt.
  await level
    .settleDecayFor(target.id, {
      decayRules: context.decayRules,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
    })
    .catch(() => undefined);

  const profile = await level.getProfile(target.id);
  const xp = profile?.xp ?? 0;
  const rank = (await level.getRank(target.id)) ?? 0;
  const member = await resolveMember(interaction, target.id);

  try {
    const png = await renderLevelCard({
      displayName: member?.displayName ?? target.displayName ?? target.username,
      avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
      xp,
      rank: rank || 1,
      accentColor: context.settings.accentColor,
      bannerUrl: context.settings.cardBannerUrl,
      prestigeBannerUrl: context.settings.cardPrestigeBannerUrl,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
    });
    await interaction.editReply({ files: [{ attachment: png, name: 'level.png' }] });
  } catch (error) {
    // Ohne Bild lieber die Zahlen als gar nichts.
    log.warn('Levelkarte konnte nicht gezeichnet werden', { error });
    await interaction.editReply({
      embeds: [
        level.buildLevelEmbed(
          {
            discordId: target.id,
            displayName: member?.displayName ?? target.username,
            xp,
            rank: rank || 1,
            level: level.levelFromXp(xp, context.settings.maxLevelTotalXp),
            messages: profile?.messages ?? 0,
            voiceMinutes: profile?.voiceMinutes ?? 0,
            maxLevelTotalXp: context.settings.maxLevelTotalXp,
          },
          context.accentColor,
        ),
      ],
    });
  }
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction, context: Ctx): Promise<void> {
  const limit = interaction.options.getInteger('azahl') ?? 10;
  const board = await level.getLeaderboard({
    limit,
    maxLevelTotalXp: context.settings.maxLevelTotalXp,
  });
  await interaction.reply({
    embeds: [level.buildLeaderboardEmbed(board.entries, context.accentColor)],
    allowedMentions: { parse: [] },
  });
}

async function handleLevelStats(interaction: ChatInputCommandInteraction, context: Ctx): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const stats = await level.getMemberStats(target.id, {
    maxLevelTotalXp: context.settings.maxLevelTotalXp,
  });

  if (!stats) {
    await interaction.reply({ content: `${target.username} het no kei XP gsammlet.`, ...ephemeral });
    return;
  }

  const sourceLabels: Record<string, string> = {
    MESSAGE: 'Nachrichte',
    VOICE: 'Voice',
    GAME_WIN: 'Spiel gwunne',
    GAME_LOSS: 'Spiel verlore',
    GAME_STAKE: 'Isätz',
    GAME_REFUND: 'Isätz zrugg',
    ADMIN: 'Vo Hand',
    DECAY: 'Inaktivität',
    BOOST: 'Boost',
    MIGRATION: 'Altdate',
    SYSTEM: 'System',
  };

  await interaction.reply({
    embeds: [
      {
        title: `Statistik vo ${stats.displayName ?? stats.username ?? target.username}`,
        color: context.accentColor,
        fields: [
          { name: 'Level', value: `${stats.level}`, inline: true },
          { name: 'XP', value: level.formatXp(stats.xp), inline: true },
          { name: 'Rang', value: `#${stats.rank}`, inline: true },
          { name: 'Nachrichte', value: level.formatXp(stats.messages), inline: true },
          { name: 'Voice', value: `${level.formatXp(stats.voiceMinutes)} Min`, inline: true },
          {
            name: 'Woher d XP chunnt',
            value:
              stats.bySource.length > 0
                ? stats.bySource
                    .map(
                      (entry) =>
                        `${sourceLabels[entry.source] ?? entry.source}: ${entry.total >= 0 ? '+' : ''}${level.formatXp(entry.total)}`,
                    )
                    .join('\n')
                : 'No kei Buechige.',
          },
        ],
      },
    ],
    allowedMentions: { parse: [] },
  });
}

async function handleGlobalStats(interaction: ChatInputCommandInteraction, context: Ctx): Promise<void> {
  const stats = await level.getGlobalStats({ maxLevelTotalXp: context.settings.maxLevelTotalXp });
  await interaction.reply({
    embeds: [
      {
        title: 'XP uf em ganze Server',
        color: context.accentColor,
        fields: [
          { name: 'Mitglieder mit XP', value: level.formatXp(stats.active), inline: true },
          { name: 'XP total', value: level.formatXp(stats.totalXp), inline: true },
          { name: 'XP im Schnitt', value: level.formatXp(stats.averageXp), inline: true },
          { name: 'Nachrichte', value: level.formatXp(stats.totalMessages), inline: true },
          { name: 'Voice', value: `${level.formatXp(stats.totalVoiceMinutes)} Min`, inline: true },
          { name: 'Höchschts Level', value: `${stats.highestLevel}`, inline: true },
        ],
      },
    ],
  });
}

async function handleCheckUser(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  context: Ctx,
): Promise<void> {
  if (!actor.can(P.membersView)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const stats = await level.getMemberStats(target.id, {
    maxLevelTotalXp: context.settings.maxLevelTotalXp,
  });

  if (!stats) {
    await interaction.reply({ content: `${target.username} het no kei XP gsammlet.`, ...ephemeral });
    return;
  }

  const relative = (date: Date | null): string => (date ? `<t:${Math.floor(date.getTime() / 1000)}:R>` : '—');

  const inDecay = level.isInDecayPhase(stats.lastActivityAt, new Date(), context.decayRules);

  await interaction.reply({
    embeds: [
      {
        title: `Aktivität vo ${stats.displayName ?? target.username}`,
        color: context.accentColor,
        fields: [
          { name: 'Level', value: `${stats.level}`, inline: true },
          { name: 'XP', value: level.formatXp(stats.xp), inline: true },
          { name: 'Rang', value: `#${stats.rank}`, inline: true },
          { name: 'Letschti Aktivität', value: relative(stats.lastActivityAt), inline: true },
          { name: 'Letschti Nachricht', value: relative(stats.lastMessageAt), inline: true },
          { name: 'Letschts Mal im Voice', value: relative(stats.lastVoiceAt), inline: true },
          {
            name: 'Inaktivitäts-Abzug',
            value: inDecay ? '⚠️ Lauft grad' : '✅ Nid im Abzug',
          },
        ],
      },
    ],
    ...ephemeral,
  });
}

async function handleGameLeaderboard(interaction: ChatInputCommandInteraction, context: Ctx): Promise<void> {
  const boards = await level.getGameLeaderboards(5);
  await interaction.reply({
    embeds: [level.buildGameLeaderboardEmbed(boards, context.accentColor)],
    allowedMentions: { parse: [] },
  });
}

const GAME_BY_COMMAND: Record<string, { kind: level.GameKind; permission: string }> = {
  xp_battle: { kind: 'XP_BATTLE', permission: P.gamesPlayBasic },
  xp_ssp: { kind: 'XP_SSP', permission: P.gamesPlayBasic },
  xp_ttt: { kind: 'XP_TTT', permission: P.gamesPlayAdvanced },
  xp_4gewinnt: { kind: 'XP_4GEWINNT', permission: P.gamesPlayAdvanced },
};

async function handleGameStart(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  context: Ctx,
): Promise<void> {
  const entry = GAME_BY_COMMAND[interaction.commandName];
  if (!entry) {
    return;
  }
  if (!context.settings.gamesEnabled) {
    await interaction.reply({ content: 'D XP-Spiel sind grad usgschalte.', ...ephemeral });
    return;
  }
  if (!actor.can(entry.permission)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }

  const opponent = interaction.options.getUser('gegner', true);
  if (opponent.bot) {
    await interaction.reply({ content: 'Gege en Bot chasch nid spiele.', ...ephemeral });
    return;
  }

  await startGame(interaction, {
    kind: entry.kind,
    opponent,
    bet: interaction.options.getInteger('einsatz', true),
    context,
  });
}

async function handleAdjust(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(P.membersManage)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('azahl', true);
  const reason = interaction.options.getString('grund');
  const signed = interaction.commandName === 'rem_xp' ? -amount : amount;

  await interaction.deferReply(ephemeral);

  const member = await resolveMember(interaction, target.id);
  const result = await level.adjustXp(toLevelActor(actor), {
    target: {
      discordId: target.id,
      username: target.username,
      displayName: member?.displayName ?? null,
    },
    amount: signed,
    reason,
  });

  const parts = [
    `${target} het jetzt **${level.formatXp(result.xpAfter)} XP** (Level ${result.levelAfter}).`,
  ];
  if (result.delta !== signed) {
    parts.push(`Verbuecht wurde **${level.formatXp(Math.abs(result.delta))} XP** - meh isch nid da gsi.`);
  }
  if (result.decayed > 0) {
    parts.push(`Vorher sind **${level.formatXp(result.decayed)} XP** Inaktivitäts-Abzug verrechnet worde.`);
  }
  if (result.rolesAdded.length > 0) {
    parts.push(`Neui Rolle: ${result.rolesAdded.map((id) => `<@&${id}>`).join(', ')}`);
  }
  if (result.rolesRemoved.length > 0) {
    parts.push(`Entfernti Rolle: ${result.rolesRemoved.map((id) => `<@&${id}>`).join(', ')}`);
  }

  await interaction.editReply({ content: parts.join('\n'), allowedMentions: { parse: [] } });
}

async function handleSetting(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  permission: string,
  patch: Partial<level.LevelSettings>,
  message: (settings: level.LevelSettings) => string,
): Promise<void> {
  if (!actor.can(permission)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }
  const settings = await level.updateLevelSettings(toLevelActor(actor), patch);
  await interaction.reply({ content: message(settings), ...ephemeral });
}

async function handleNoXpChannel(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  mode: 'add' | 'remove',
): Promise<void> {
  if (!actor.can(P.rulesManage)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const changed =
    mode === 'add'
      ? await level.addNoXpChannel(toLevelActor(actor), channel.id)
      : await level.removeNoXpChannel(toLevelActor(actor), channel.id);

  const content = changed
    ? mode === 'add'
      ? `In <#${channel.id}> git's ab jetzt kei XP meh.`
      : `In <#${channel.id}> git's wieder XP.`
    : mode === 'add'
      ? `<#${channel.id}> isch scho i de Lischte.`
      : `<#${channel.id}> isch gar nid i de Lischte.`;

  await interaction.reply({ content, allowedMentions: { parse: [] }, ...ephemeral });
}

async function handleListNoXp(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  context: Ctx,
): Promise<void> {
  if (!actor.can(P.settingsView)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }
  const ids = context.settings.noXpChannelIds;
  await interaction.reply({
    content:
      ids.length > 0
        ? `Channels ohni XP:\n${ids.map((id) => `<#${id}>`).join('\n')}`
        : 'Es git kei Channel ohni XP.',
    allowedMentions: { parse: [] },
    ...ephemeral,
  });
}

async function handleVoiceMuteStatus(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  context: Ctx,
): Promise<void> {
  if (!actor.can(P.settingsView)) {
    await interaction.reply({ content: NO_PERMISSION, ...ephemeral });
    return;
  }
  const { settings } = context;
  await interaction.reply({
    embeds: [
      {
        title: 'XP bi Stummschaltig',
        color: context.accentColor,
        fields: [
          {
            name: 'Kei XP bi Stummschaltig',
            value: settings.voiceMuteBlocksXp ? 'a' : 'us',
            inline: true,
          },
          { name: 'Nachlauf', value: `${settings.voiceMuteCooldownSeconds} s`, inline: true },
          { name: 'Was zellt', value: settings.voiceMuteMode, inline: true },
          { name: 'XP elei im Channel', value: settings.xpWhileAlone ? 'a' : 'us', inline: true },
        ],
      },
    ],
    ...ephemeral,
  });
}
