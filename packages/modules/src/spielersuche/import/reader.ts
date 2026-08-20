import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('spielersuche:import:reader');

/**
 * Lesen der alten Spielersuche-Datenbank (`matchmaking.db`).
 *
 * Dieselben Grundsätze wie beim Jail-Import: die hochgeladene Datei ist
 * nicht vertrauenswürdig und wird ausschliesslich gelesen.
 *
 *  - `readOnly`: kein ALTER, kein UPDATE, kein DELETE. Die Datei bleibt
 *    bitgleich.
 *  - Nur die sieben erwarteten Tabellen, mit fest im Code stehendem SQL. Aus
 *    der Datei kommen Werte, nie Anweisungen - und nichts davon läuft je
 *    gegen PostgreSQL.
 *  - Keine Erweiterungen, kein externer Prozess.
 *  - Kein Pfad aus dem Browser: geschrieben wird in ein frisches, zufällig
 *    benanntes Verzeichnis, das danach wieder verschwindet.
 *
 * Eine Besonderheit gegenüber der Jail-Datenbank: dort standen die Discord-IDs
 * als TEXT, hier als INTEGER. Discord-IDs überschreiten den sicheren
 * Zahlenbereich von JavaScript, deshalb wird durchgehend als BigInt gelesen
 * und sofort in Text umgewandelt.
 */

/** 32 MB - die echte Datei liegt bei rund 80 KB. */
export const MAX_LEGACY_DB_BYTES = 32 * 1024 * 1024;

const SQLITE_MAGIC = 'SQLite format 3\0';

export const EXPECTED_TABLES = [
  'guild_settings',
  'games',
  'matches',
  'participants',
  'role_ping_log',
  'command_usage',
  'voice_sessions',
] as const;

export interface LegacyGuildSettings {
  guildId: string;
  searchChannelId: string | null;
  voiceCategoryId: string | null;
  expiryHours: number | null;
  accentColor: number | null;
}

export interface LegacyGame {
  id: number;
  guildId: string;
  name: string;
  roleId: string | null;
  imageUrl: string | null;
  userLimit: number | null;
  createdAt: string | null;
}

export interface LegacyMatch {
  id: number;
  guildId: string;
  creatorId: string | null;
  gameId: number | null;
  game: string;
  pingRoleId: string | null;
  imageUrl: string | null;
  requestedPlayers: number | null;
  details: string | null;
  status: string | null;
  channelId: string | null;
  messageId: string | null;
  voiceChannelId: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
}

export interface LegacyParticipant {
  matchId: number;
  userId: string | null;
  joinedAt: string | null;
}

export interface LegacyRolePing {
  guildId: string;
  gameId: number;
  roleId: string | null;
  pingedAt: string | null;
}

export interface LegacyUsage {
  id: number;
  guildId: string;
  userId: string | null;
  commandName: string | null;
  usedAt: string | null;
}

export interface LegacyVoiceSession {
  id: number;
  guildId: string;
  userId: string | null;
  matchId: number | null;
  voiceChannelId: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  durationSeconds: number | null;
}

export interface LegacyDatabaseContents {
  schema: Array<{ table: string; columns: string[]; rows: number }>;
  /** Alle Guilds, die in der Datei vorkommen - mit ihrer Datenmenge. */
  guilds: Array<{ guildId: string; games: number; matches: number; usages: number }>;
  settings: LegacyGuildSettings[];
  games: LegacyGame[];
  matches: LegacyMatch[];
  participants: LegacyParticipant[];
  rolePings: LegacyRolePing[];
  usages: LegacyUsage[];
  voiceSessions: LegacyVoiceSession[];
  sha256: string;
  bytes: number;
}

/** Pflichtspalten je Tabelle - fehlt eine, passt die Datei nicht. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  games: ['id', 'guild_id', 'name', 'role_id'],
  matches: ['id', 'guild_id', 'creator_id', 'game', 'requested_players', 'status'],
  participants: ['match_id', 'user_id'],
};

function assertSqliteFile(data: Uint8Array): void {
  if (data.byteLength === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Datei ist leer.' });
  }
  if (data.byteLength > MAX_LEGACY_DB_BYTES) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross (maximal ${MAX_LEGACY_DB_BYTES / 1024 / 1024} MB).`,
    });
  }
  const header = Buffer.from(data.subarray(0, SQLITE_MAGIC.length)).toString('latin1');
  if (header !== SQLITE_MAGIC) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Das ist keine SQLite-Datenbank. Erwartet wird die Datei `matchmaking.db` des alten Spielersuche-Bots.',
    });
  }
}

/**
 * Discord-ID als Text.
 *
 * Werte kommen als BigInt aus SQLite; `null` und offensichtlich unbrauchbare
 * Werte (0, negativ) werden ausgesiebt.
 */
function asId(value: unknown): string | null {
  if (typeof value === 'bigint') {
    return value > 0n ? value.toString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? String(BigInt(Math.trunc(value))) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d{1,20}$/u.test(trimmed) && trimmed !== '0' ? trimmed : null;
  }
  return null;
}

/** Kleine Ganzzahl (Zeilen-ID, Limit, Dauer). */
function asInt(value: unknown): number | null {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^-?\d+$/u.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'number') {
    return String(value);
  }
  return null;
}

export async function readLegacyDatabase(data: Uint8Array): Promise<LegacyDatabaseContents> {
  assertSqliteFile(data);

  const sha256 = createHash('sha256').update(data).digest('hex');
  const { DatabaseSync } = await import('node:sqlite');

  const directory = await mkdtemp(
    join(tmpdir(), `swisshub-spielersuche-import-${randomBytes(8).toString('hex')}-`),
  );
  const file = join(directory, 'legacy.db');

  try {
    await writeFile(file, data, { mode: 0o600 });
    const db = new DatabaseSync(file, { readOnly: true });

    try {
      /** Führt eine feste Abfrage aus und liest Zahlen als BigInt. */
      const query = (sql: string): Array<Record<string, unknown>> => {
        const statement = db.prepare(sql);
        statement.setReadBigInts(true);
        return statement.all() as Array<Record<string, unknown>>;
      };

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => asText((row as { name: unknown }).name))
        .filter((name): name is string => name !== null);

      const schema: LegacyDatabaseContents['schema'] = [];
      const columnsByTable = new Map<string, string[]>();

      for (const table of EXPECTED_TABLES) {
        if (!tables.includes(table)) {
          continue;
        }
        // Der Tabellenname stammt aus der festen Liste oben, nie aus der Datei.
        const columns = db
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((row) => asText((row as { name: unknown }).name))
          .filter((name): name is string => name !== null);
        columnsByTable.set(table, columns);
        const count = query(`SELECT COUNT(*) AS n FROM "${table}"`)[0];
        schema.push({ table, columns, rows: asInt(count?.n) ?? 0 });
      }

      for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
        if (!tables.includes(table)) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: `In der Datei fehlt die Tabelle \`${table}\`. Das ist keine Datenbank des SwissHub Spielersuche-Bots.`,
          });
        }
        const columns = columnsByTable.get(table) ?? [];
        const missing = required.filter((column) => !columns.includes(column));
        if (missing.length > 0) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: `In \`${table}\` fehlen die Spalten: ${missing.join(', ')}.`,
          });
        }
      }

      /** Optionale Spalte - ältere Dateien kennen sie nicht. */
      const optional = (table: string, column: string): string =>
        (columnsByTable.get(table) ?? []).includes(column) ? `"${column}"` : `NULL AS "${column}"`;

      const settings: LegacyGuildSettings[] = tables.includes('guild_settings')
        ? query('SELECT * FROM "guild_settings"').map((row) => ({
            guildId: asId(row.guild_id) ?? '',
            searchChannelId: asId(row.search_channel_id),
            voiceCategoryId: asId(row.voice_category_id),
            expiryHours: asInt(row.expiry_hours),
            accentColor: asInt(row.accent_color),
          }))
        : [];

      const games: LegacyGame[] = query(
        `SELECT "id", "guild_id", "name", "role_id", ${optional('games', 'image_url')},
                ${optional('games', 'user_limit')}, ${optional('games', 'created_at')}
         FROM "games"`,
      ).map((row) => ({
        id: asInt(row.id) ?? 0,
        guildId: asId(row.guild_id) ?? '',
        name: asText(row.name) ?? '',
        roleId: asId(row.role_id),
        imageUrl: asText(row.image_url),
        userLimit: asInt(row.user_limit),
        createdAt: asText(row.created_at),
      }));

      const matches: LegacyMatch[] = query(
        `SELECT "id", "guild_id", "creator_id", ${optional('matches', 'game_id')}, "game",
                ${optional('matches', 'ping_role_id')}, ${optional('matches', 'image_url')},
                "requested_players", ${optional('matches', 'details')}, "status",
                ${optional('matches', 'channel_id')}, ${optional('matches', 'message_id')},
                ${optional('matches', 'voice_channel_id')}, ${optional('matches', 'created_at')},
                ${optional('matches', 'expires_at')}, ${optional('matches', 'closed_at')}
         FROM "matches"`,
      ).map((row) => ({
        id: asInt(row.id) ?? 0,
        guildId: asId(row.guild_id) ?? '',
        creatorId: asId(row.creator_id),
        gameId: asInt(row.game_id),
        game: asText(row.game) ?? '',
        pingRoleId: asId(row.ping_role_id),
        imageUrl: asText(row.image_url),
        requestedPlayers: asInt(row.requested_players),
        details: asText(row.details),
        status: asText(row.status),
        channelId: asId(row.channel_id),
        messageId: asId(row.message_id),
        voiceChannelId: asId(row.voice_channel_id),
        createdAt: asText(row.created_at),
        expiresAt: asText(row.expires_at),
        closedAt: asText(row.closed_at),
      }));

      const participants: LegacyParticipant[] = query(
        `SELECT "match_id", "user_id", ${optional('participants', 'joined_at')} FROM "participants"`,
      ).map((row) => ({
        matchId: asInt(row.match_id) ?? 0,
        userId: asId(row.user_id),
        joinedAt: asText(row.joined_at),
      }));

      const rolePings: LegacyRolePing[] = tables.includes('role_ping_log')
        ? query('SELECT * FROM "role_ping_log"').map((row) => ({
            guildId: asId(row.guild_id) ?? '',
            gameId: asInt(row.game_id) ?? 0,
            roleId: asId(row.role_id),
            pingedAt: asText(row.pinged_at),
          }))
        : [];

      const usages: LegacyUsage[] = tables.includes('command_usage')
        ? query('SELECT * FROM "command_usage"').map((row) => ({
            id: asInt(row.id) ?? 0,
            guildId: asId(row.guild_id) ?? '',
            userId: asId(row.user_id),
            commandName: asText(row.command_name),
            usedAt: asText(row.used_at),
          }))
        : [];

      const voiceSessions: LegacyVoiceSession[] = tables.includes('voice_sessions')
        ? query('SELECT * FROM "voice_sessions"').map((row) => ({
            id: asInt(row.id) ?? 0,
            guildId: asId(row.guild_id) ?? '',
            userId: asId(row.user_id),
            matchId: asInt(row.match_id),
            voiceChannelId: asId(row.voice_channel_id),
            joinedAt: asText(row.joined_at),
            leftAt: asText(row.left_at),
            durationSeconds: asInt(row.duration_seconds),
          }))
        : [];

      // Die Altdatenbank kann mehrere Server enthalten (Test und Produktion).
      // Diese Anwendung verwaltet genau einen - deshalb wird die Auswahl
      // sichtbar gemacht statt stillschweigend alles zu vermischen.
      const guildIds = new Set<string>([
        ...settings.map((entry) => entry.guildId),
        ...games.map((entry) => entry.guildId),
        ...matches.map((entry) => entry.guildId),
      ]);
      const guilds = [...guildIds]
        .filter((guildId) => guildId.length > 0)
        .map((guildId) => ({
          guildId,
          games: games.filter((entry) => entry.guildId === guildId).length,
          matches: matches.filter((entry) => entry.guildId === guildId).length,
          usages: usages.filter((entry) => entry.guildId === guildId).length,
        }))
        .sort((a, b) => b.matches - a.matches || b.games - a.games);

      log.info('Legacy-Spielersuche gelesen', {
        guilds: guilds.length,
        games: games.length,
        matches: matches.length,
        voiceSessions: voiceSessions.length,
      });

      return {
        schema,
        guilds,
        settings,
        games,
        matches,
        participants,
        rolePings,
        usages,
        voiceSessions,
        sha256,
        bytes: data.byteLength,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    log.error('Legacy-Spielersuche konnte nicht gelesen werden', { error });
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Datei konnte nicht gelesen werden. Ist sie vollständig und unbeschädigt?',
      internalMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) =>
      log.warn('Temporäres Import-Verzeichnis konnte nicht entfernt werden', { error }),
    );
  }
}
