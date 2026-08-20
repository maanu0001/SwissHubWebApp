import {
  Events,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type User,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { isModuleEnabled, level } from '@swisshub/modules';
import type { LevelGameMatch } from '@swisshub/database';
import { buildCommandActor } from './commands/context';

const log = createLogger('bot:level:games');

/**
 * Ablauf der XP-Spiele auf Discord.
 *
 * Die Datei enthält keine Spielregeln und keine XP-Rechnung - beides liegt in
 * `@swisshub/modules`. Hier wird nur zwischen Discord-Interaktionen und den
 * Services vermittelt und die Nachricht neu gezeichnet.
 */

type Ctx = Awaited<ReturnType<typeof level.loadLevelContext>>;

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

const playTimeoutFor = (kind: level.GameKind, settings: level.LevelSettings): number => {
  switch (kind) {
    case 'XP_BATTLE':
      return settings.gameBattleTimeoutSeconds;
    case 'XP_SSP':
      return settings.gameSspTimeoutSeconds;
    case 'XP_TTT':
      return settings.gameTttTimeoutSeconds;
    case 'XP_4GEWINNT':
      return settings.gameConnectFourTimeoutSeconds;
    default:
      return 120;
  }
};

export interface StartGameInput {
  kind: level.GameKind;
  opponent: User;
  bet: number;
  context: Ctx;
}

/** Legt eine Herausforderung an und veröffentlicht sie. */
export async function startGame(
  interaction: ChatInputCommandInteraction,
  input: StartGameInput,
): Promise<void> {
  const { context } = input;
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const opponentMember = interaction.guild?.members.cache.get(input.opponent.id);

  const match = await level.createChallenge({
    kind: input.kind,
    challenger: {
      discordId: interaction.user.id,
      username: interaction.user.username,
      displayName: member?.displayName ?? null,
      avatarHash: interaction.user.avatar ?? null,
    },
    opponent: {
      discordId: input.opponent.id,
      username: input.opponent.username,
      displayName: opponentMember?.displayName ?? null,
      avatarHash: input.opponent.avatar ?? null,
    },
    bet: input.bet,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    payoutFactor: context.settings.gamePayoutFactor,
    minBet: context.settings.gameMinBet,
    maxBet: context.settings.gameMaxBet,
    acceptTimeoutSeconds: context.settings.gameAcceptTimeoutSeconds,
  });

  const reply = await interaction.reply({
    content: `<@${input.opponent.id}>`,
    embeds: [level.buildChallengeEmbed(match, { accentColor: context.accentColor })],
    components: level.buildChallengeButtons(match.id),
    // Nur die herausgeforderte Person wird benachrichtigt.
    allowedMentions: { users: [input.opponent.id], parse: [] },
    withResponse: true,
  });

  const messageId = reply.resource?.message?.id;
  if (messageId) {
    await level.setGameMessage(match.id, messageId).catch(() => undefined);
  }
}

/** Nimmt die Knöpfe der XP-Spiele entgegen. */
export function registerLevelGameButtons(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const parsed = level.parseButtonId(interaction.customId);
    if (!parsed) {
      return;
    }
    void handleButton(interaction, parsed).catch(async (error: unknown) => {
      const message = error instanceof AppError ? error.userMessage : 'Das het nid klappet.';
      if (!(error instanceof AppError)) {
        log.error('Spielknopf fehlgeschlagen', { error, customId: interaction.customId });
      }
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ...ephemeral }).catch(() => undefined);
      } else {
        await interaction.reply({ content: message, ...ephemeral }).catch(() => undefined);
      }
    });
  });
}

async function handleButton(
  interaction: ButtonInteraction,
  parsed: NonNullable<ReturnType<typeof level.parseButtonId>>,
): Promise<void> {
  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    await interaction.reply({ content: 'S Level-System isch grad usgschalte.', ...ephemeral });
    return;
  }

  const context = await level.loadLevelContext();

  switch (parsed.action) {
    case 'accept':
      await handleAccept(interaction, parsed.matchId, context);
      return;
    case 'decline':
      await handleDecline(interaction, parsed.matchId, context);
      return;
    case 'ssp':
      await handleSsp(interaction, parsed.matchId, parsed.choice, context);
      return;
    case 'ttt':
      await handleTtt(interaction, parsed.matchId, parsed.cell, context);
      return;
    case 'c4':
      await handleC4(interaction, parsed.matchId, parsed.column, context);
      return;
    default:
      return;
  }
}

/** Prüft, dass nur die herausgeforderte Person antwortet. */
async function requireOpponent(
  interaction: ButtonInteraction,
  matchId: string,
): Promise<LevelGameMatch | null> {
  const match = await level.getGameMatch(matchId);
  if (!match) {
    await interaction.reply({ content: 'Das Spiel gits nümme.', ...ephemeral });
    return null;
  }
  if (match.opponentDiscordId !== interaction.user.id) {
    await interaction.reply({ content: 'Die Herusforderig isch nid für dich.', ...ephemeral });
    return null;
  }
  return match;
}

async function handleAccept(interaction: ButtonInteraction, matchId: string, context: Ctx): Promise<void> {
  const existing = await requireOpponent(interaction, matchId);
  if (!existing) {
    return;
  }

  await interaction.deferUpdate();

  const actor = await buildCommandActor(interaction);
  const match = await level.acceptChallenge(
    matchId,
    {
      discordId: actor.discordId,
      username: actor.username,
      avatarHash: actor.avatarHash,
    },
    {
      decayRules: context.decayRules,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
      playTimeoutSeconds: playTimeoutFor(match0Kind(existing), context.settings),
    },
  );

  if (match.kind === 'XP_BATTLE') {
    await resolveBattle(interaction, match, context);
    return;
  }

  const started = await level.startState(matchId);
  await renderBoard(interaction, started, context, null);
}

/** Kleiner Helfer, damit die Spielart typsicher bleibt. */
const match0Kind = (match: LevelGameMatch): level.GameKind => match.kind as level.GameKind;

async function handleDecline(interaction: ButtonInteraction, matchId: string, context: Ctx): Promise<void> {
  const match = await requireOpponent(interaction, matchId);
  if (!match) {
    return;
  }

  await interaction.deferUpdate();
  await level.closeGame(matchId, 'DECLINED', 'Herausforderung abgelehnt', {
    decayRules: context.decayRules,
    maxLevelTotalXp: context.settings.maxLevelTotalXp,
  });

  await interaction.editReply({
    content: '',
    embeds: [
      {
        title: `${level.GAME_LABELS[match0Kind(match)]} – Abglehnt`,
        description: `<@${match.opponentDiscordId}> het d Herusforderig abglehnt. Es isch kei XP bewegt worde.`,
        color: context.accentColor,
      },
    ],
    components: [],
    allowedMentions: { parse: [] },
  });
}

/** Das XP-Battle wird in einem Zug entschieden. */
async function resolveBattle(
  interaction: ButtonInteraction,
  match: LevelGameMatch,
  context: Ctx,
): Promise<void> {
  const winnerDiscordId = Math.random() < 0.5 ? match.challengerDiscordId : match.opponentDiscordId;

  const result = await level.finishGame(match.id, winnerDiscordId, {
    decayRules: context.decayRules,
    maxLevelTotalXp: context.settings.maxLevelTotalXp,
  });

  await interaction.editReply({
    content: '',
    embeds: [
      level.buildGameResultEmbed(result.match, {
        accentColor: context.accentColor,
        winnerDiscordId: result.winnerDiscordId,
        loserDiscordId: result.loserDiscordId,
        detail: '🎲 D Münze isch gfalle.',
      }),
    ],
    components: [],
    allowedMentions: { parse: [] },
  });
}

async function handleSsp(
  interaction: ButtonInteraction,
  matchId: string,
  choice: level.SspChoice,
  context: Ctx,
): Promise<void> {
  await interaction.deferUpdate();
  const move = await level.playSsp(matchId, interaction.user.id, choice);

  if (move.waiting) {
    // Die Wahl bleibt bis zur Auswertung verdeckt.
    await interaction.followUp({ content: `Du hesch **${level.SSP_LABELS[choice]}** gwählt.`, ...ephemeral });
    return;
  }

  if (move.finished && move.winnerDiscordId) {
    const result = await level.finishGame(matchId, move.winnerDiscordId, {
      decayRules: context.decayRules,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
    });
    await interaction.editReply({
      content: '',
      embeds: [
        level.buildGameResultEmbed(result.match, {
          accentColor: context.accentColor,
          winnerDiscordId: result.winnerDiscordId,
          loserDiscordId: result.loserDiscordId,
          detail: describeSspHistory(move.state, move.match),
        }),
      ],
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.editReply({
    content: '',
    embeds: [
      level.buildGameStateEmbed(move.match, {
        accentColor: context.accentColor,
        description:
          `${describeSspHistory(move.state, move.match)}\n\n` +
          `Rundi **${move.state.round}** – wer zerscht ${2} Rundene gwünnt, gwünnt s Spiel.`,
      }),
    ],
    components: level.buildSspButtons(matchId),
    allowedMentions: { parse: [] },
  });
}

function describeSspHistory(state: level.SspState, match: LevelGameMatch): string {
  const score = `<@${match.challengerDiscordId}> **${state.scores[match.challengerDiscordId] ?? 0}** : **${state.scores[match.opponentDiscordId] ?? 0}** <@${match.opponentDiscordId}>`;
  const last = state.history.at(-1);
  if (!last) {
    return score;
  }
  const shown = Object.entries(last.choices)
    .map(([discordId, choice]) => `<@${discordId}>: ${level.SSP_LABELS[choice]}`)
    .join(' · ');
  return `${score}\n${shown}`;
}

async function handleTtt(
  interaction: ButtonInteraction,
  matchId: string,
  cell: number,
  context: Ctx,
): Promise<void> {
  await interaction.deferUpdate();
  const move = await level.playTtt(matchId, interaction.user.id, cell);
  await finishOrRender(
    interaction,
    move,
    context,
    level.buildTttButtons(matchId, move.state.board, move.finished),
  );
}

async function handleC4(
  interaction: ButtonInteraction,
  matchId: string,
  column: number,
  context: Ctx,
): Promise<void> {
  await interaction.deferUpdate();
  const move = await level.playC4(matchId, interaction.user.id, column);
  await finishOrRender(
    interaction,
    move,
    context,
    level.buildC4Buttons(matchId, move.state.board, move.finished),
  );
}

/** Zeichnet ein laufendes Spielfeld. */
async function renderBoard(
  interaction: ButtonInteraction,
  match: LevelGameMatch,
  context: Ctx,
  detail: string | null,
): Promise<void> {
  const state = match.state as level.GameState | null;
  if (!state) {
    return;
  }

  if (state.kind === 'SSP') {
    await interaction.editReply({
      content: '',
      embeds: [
        level.buildGameStateEmbed(match, {
          accentColor: context.accentColor,
          description: `Beidi wähled verdeckt. Wer zerscht 2 Rundene gwünnt, gwünnt s Spiel.`,
        }),
      ],
      components: level.buildSspButtons(match.id),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (state.kind === 'TTT') {
    await interaction.editReply({
      content: '',
      embeds: [
        level.buildGameStateEmbed(match, {
          accentColor: context.accentColor,
          description: `${detail ? `${detail}\n\n` : ''}<@${state.turn}> isch am Zug.`,
        }),
      ],
      components: level.buildTttButtons(match.id, state.board),
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.editReply({
    content: '',
    embeds: [
      level.buildGameStateEmbed(match, {
        accentColor: context.accentColor,
        description: `${level.renderC4Board(state.board)}\n\n<@${state.turn}> isch am Zug.`,
      }),
    ],
    components: level.buildC4Buttons(match.id, state.board),
    allowedMentions: { parse: [] },
  });
}

/** Rechnet ab oder zeichnet das Feld neu. */
async function finishOrRender(
  interaction: ButtonInteraction,
  move: level.MoveResult,
  context: Ctx,
  components: ReturnType<typeof level.buildTttButtons>,
): Promise<void> {
  const boardText = move.state.kind === 'C4' ? level.renderC4Board(move.state.board) : undefined;

  if (!move.finished) {
    const turn = move.state.kind === 'TTT' || move.state.kind === 'C4' ? move.state.turn : null;
    await interaction.editReply({
      content: '',
      embeds: [
        level.buildGameStateEmbed(move.match, {
          accentColor: context.accentColor,
          description: `${boardText ? `${boardText}\n\n` : ''}${turn ? `<@${turn}> isch am Zug.` : ''}`,
        }),
      ],
      components,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (move.draw) {
    const closed = await level.closeGame(move.match.id, 'DRAW', 'Unentschieden', {
      decayRules: context.decayRules,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
    });
    await interaction.editReply({
      content: '',
      embeds: [
        level.buildGameResultEmbed(closed, {
          accentColor: context.accentColor,
          winnerDiscordId: null,
          loserDiscordId: null,
          detail: boardText,
        }),
      ],
      components,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const result = await level.finishGame(move.match.id, move.winnerDiscordId!, {
    decayRules: context.decayRules,
    maxLevelTotalXp: context.settings.maxLevelTotalXp,
  });

  await interaction.editReply({
    content: '',
    embeds: [
      level.buildGameResultEmbed(result.match, {
        accentColor: context.accentColor,
        winnerDiscordId: result.winnerDiscordId,
        loserDiscordId: result.loserDiscordId,
        detail: boardText,
      }),
    ],
    components,
    allowedMentions: { parse: [] },
  });
}
