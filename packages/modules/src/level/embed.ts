import { BUTTON_STYLE, type DiscordActionRow, type DiscordEmbed } from '@swisshub/discord';
import type { LevelGameMatch, XpGameKind } from '@swisshub/database';
import { formatXp } from './card';
import { levelProgress } from './curve';
import { C4_COLS, GAME_LABELS, SSP_LABELS, type C4Board, type SspChoice, type TttBoard } from './game-rules';

/**
 * Nachrichten des Level-Systems.
 *
 * Die Bausteine liegen im Modul und nicht im Bot, damit Dashboard-Vorschau
 * und Discord dieselbe Darstellung verwenden.
 */

/** Präfix aller Knöpfe dieses Moduls. */
export const BUTTON_PREFIX = 'swisshub:level';

export const BUTTON_IDS = {
  accept: (matchId: string) => `${BUTTON_PREFIX}:accept:${matchId}`,
  decline: (matchId: string) => `${BUTTON_PREFIX}:decline:${matchId}`,
  ssp: (matchId: string, choice: SspChoice) => `${BUTTON_PREFIX}:ssp:${matchId}:${choice}`,
  ttt: (matchId: string, cell: number) => `${BUTTON_PREFIX}:ttt:${matchId}:${cell}`,
  c4: (matchId: string, column: number) => `${BUTTON_PREFIX}:c4:${matchId}:${column}`,
} as const;

export type ParsedButton =
  | { action: 'accept' | 'decline'; matchId: string }
  | { action: 'ssp'; matchId: string; choice: SspChoice }
  | { action: 'ttt'; matchId: string; cell: number }
  | { action: 'c4'; matchId: string; column: number };

/** Zerlegt eine Knopf-ID. `null`, wenn sie nicht zu diesem Modul gehört. */
export function parseButtonId(customId: string): ParsedButton | null {
  if (!customId.startsWith(`${BUTTON_PREFIX}:`)) {
    return null;
  }
  const parts = customId.split(':');
  const action = parts[2];
  const matchId = parts[3];
  if (!action || !matchId) {
    return null;
  }
  switch (action) {
    case 'accept':
    case 'decline':
      return { action, matchId };
    case 'ssp': {
      const choice = parts[4];
      if (choice === 'rock' || choice === 'paper' || choice === 'scissors') {
        return { action: 'ssp', matchId, choice };
      }
      return null;
    }
    case 'ttt': {
      const cell = Number.parseInt(parts[4] ?? '', 10);
      return Number.isInteger(cell) && cell >= 0 && cell < 9 ? { action: 'ttt', matchId, cell } : null;
    }
    case 'c4': {
      const column = Number.parseInt(parts[4] ?? '', 10);
      return Number.isInteger(column) && column >= 0 && column < C4_COLS
        ? { action: 'c4', matchId, column }
        : null;
    }
    default:
      return null;
  }
}

const mention = (discordId: string): string => `<@${discordId}>`;

/**
 * Mentions bleiben stumm.
 *
 * Ein Spielverlauf nennt beide Beteiligten mehrfach; ohne diese Sperre würde
 * jeder Zug eine Benachrichtigung auslösen.
 */
export const SILENT_MENTIONS = { parse: [] as Array<'users' | 'roles' | 'everyone'> };

export function buildChallengeEmbed(match: LevelGameMatch, options: { accentColor: number }): DiscordEmbed {
  return {
    title: `${GAME_LABELS[match.kind]} – Herusforderig`,
    description:
      `${mention(match.challengerDiscordId)} fordert ${mention(match.opponentDiscordId)} usse.\n\n` +
      `Isatz: **${formatXp(match.bet)} XP**\n` +
      `De Gwünner überchunnt **${formatXp(match.payout)} XP** us em Topf.`,
    color: options.accentColor,
    footer: {
      text: match.expiresAt
        ? `Aanäh bis ${match.expiresAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`
        : 'Wartet uf Antwort',
    },
  };
}

export function buildChallengeButtons(matchId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: BUTTON_STYLE.SUCCESS,
          label: 'Aanäh',
          custom_id: BUTTON_IDS.accept(matchId),
        },
        {
          type: 2,
          style: BUTTON_STYLE.DANGER,
          label: 'Ablehne',
          custom_id: BUTTON_IDS.decline(matchId),
        },
      ],
    },
  ];
}

export function buildSspButtons(matchId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: (['scissors', 'rock', 'paper'] as const).map((choice) => ({
        type: 2 as const,
        style: BUTTON_STYLE.PRIMARY,
        label: SSP_LABELS[choice],
        custom_id: BUTTON_IDS.ssp(matchId, choice),
      })),
    },
  ];
}

/** Spielfeld als drei Reihen mit je drei Knöpfen. */
export function buildTttButtons(matchId: string, board: TttBoard, disabled = false): DiscordActionRow[] {
  const rows: DiscordActionRow[] = [];
  for (let row = 0; row < 3; row += 1) {
    rows.push({
      type: 1,
      components: [0, 1, 2].map((column) => {
        const index = row * 3 + column;
        const mark = board[index];
        return {
          type: 2 as const,
          style:
            mark === 'X' ? BUTTON_STYLE.DANGER : mark === 'O' ? BUTTON_STYLE.PRIMARY : BUTTON_STYLE.SECONDARY,
          label: mark ?? '​',
          custom_id: BUTTON_IDS.ttt(matchId, index),
          disabled: disabled || mark !== null,
        };
      }),
    });
  }
  return rows;
}

/** Sieben Spalten passen nicht in eine Reihe - Discord erlaubt fünf Knöpfe. */
export function buildC4Buttons(matchId: string, board: C4Board, disabled = false): DiscordActionRow[] {
  const columns = Array.from({ length: C4_COLS }, (_unused, column) => column);
  const rows: DiscordActionRow[] = [];
  for (let start = 0; start < columns.length; start += 5) {
    rows.push({
      type: 1,
      components: columns.slice(start, start + 5).map((column) => ({
        type: 2 as const,
        style: BUTTON_STYLE.SECONDARY,
        label: `${column + 1}`,
        custom_id: BUTTON_IDS.c4(matchId, column),
        disabled: disabled || board[0]![column] !== 0,
      })),
    });
  }
  return rows;
}

const C4_PIECES = ['⚪', '🔴', '🟡'] as const;

export function renderC4Board(board: C4Board): string {
  const header = Array.from(
    { length: C4_COLS },
    (_unused, column) => ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'][column],
  ).join('');
  const grid = board.map((row) => row.map((piece) => C4_PIECES[piece]).join('')).join('\n');
  return `${header}\n${grid}`;
}

export function buildGameStateEmbed(
  match: LevelGameMatch,
  options: {
    accentColor: number;
    description: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    title?: string;
  },
): DiscordEmbed {
  return {
    title: options.title ?? GAME_LABELS[match.kind],
    description: options.description,
    color: options.accentColor,
    fields: options.fields,
    footer: { text: `Isatz: ${formatXp(match.bet)} XP · Topf: ${formatXp(match.payout)} XP` },
  };
}

export function buildGameResultEmbed(
  match: LevelGameMatch,
  options: {
    accentColor: number;
    winnerDiscordId: string | null;
    loserDiscordId: string | null;
    detail?: string;
  },
): DiscordEmbed {
  if (!options.winnerDiscordId) {
    return {
      title: `${GAME_LABELS[match.kind]} – Unentschide`,
      description: `${options.detail ? `${options.detail}\n\n` : ''}Beidi Isätz sind zrugg.`,
      color: options.accentColor,
    };
  }
  return {
    title: `${GAME_LABELS[match.kind]} – Resultat`,
    description:
      `${options.detail ? `${options.detail}\n\n` : ''}` +
      `🏆 ${mention(options.winnerDiscordId)} gwünnt **${formatXp(match.payout)} XP**!\n` +
      (options.loserDiscordId
        ? `${mention(options.loserDiscordId)} verliert **${formatXp(match.bet)} XP**.`
        : ''),
    color: options.accentColor,
  };
}

export interface LevelEmbedInput {
  discordId: string;
  displayName: string;
  xp: number;
  rank: number;
  level: number;
  messages: number;
  voiceMinutes: number;
  maxLevelTotalXp?: number;
}

/** Textliche Fassung der Levelkarte - für Fälle ohne Bild. */
export function buildLevelEmbed(input: LevelEmbedInput, accentColor: number): DiscordEmbed {
  const progress = levelProgress(input.xp, input.maxLevelTotalXp);
  const filled = Math.round(progress.progress * 20);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;

  return {
    title: `Level ${progress.level} · Rank #${input.rank}`,
    description:
      `${input.displayName}\n\n` +
      `\`${bar}\` ${Math.round(progress.progress * 100)}%\n` +
      (progress.isMaxLevel
        ? `**${formatXp(progress.xp)} XP** – Höchstlevel erreicht.`
        : `**${formatXp(progress.xp)} XP** · nächschts Level ab **${formatXp(progress.nextLevelXp)} XP**`),
    color: accentColor,
    fields: [
      { name: 'Nachrichte', value: formatXp(input.messages), inline: true },
      { name: 'Voice', value: `${formatXp(input.voiceMinutes)} Min`, inline: true },
    ],
  };
}

export function buildLeaderboardEmbed(
  entries: ReadonlyArray<{
    rank: number;
    discordId: string;
    displayName: string | null;
    username: string | null;
    xp: number;
    level: number;
  }>,
  accentColor: number,
): DiscordEmbed {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.map((entry) => {
    const badge = medals[entry.rank - 1] ?? `**${entry.rank}.**`;
    const name = entry.displayName ?? entry.username ?? mention(entry.discordId);
    return `${badge} ${name} — Level ${entry.level} · ${formatXp(entry.xp)} XP`;
  });

  return {
    title: '🏆 SwissHub Rangliste',
    description: lines.length > 0 ? lines.join('\n') : 'No niemert het XP gsammlet.',
    color: accentColor,
  };
}

export function buildGameLeaderboardEmbed(
  boards: ReadonlyArray<{
    kind: XpGameKind;
    entries: ReadonlyArray<{
      discordId: string;
      displayName: string | null;
      username: string | null;
      wins: number;
    }>;
  }>,
  accentColor: number,
): DiscordEmbed {
  return {
    title: '🎮 Top-Spieler',
    color: accentColor,
    fields: boards.map((board) => ({
      name: GAME_LABELS[board.kind],
      value:
        board.entries.length > 0
          ? board.entries
              .map(
                (entry, index) =>
                  `**${index + 1}.** ${entry.displayName ?? entry.username ?? mention(entry.discordId)} — ${entry.wins} Sieg${entry.wins === 1 ? '' : 'e'}`,
              )
              .join('\n')
          : 'No kei Sieg.',
      inline: true,
    })),
  };
}
