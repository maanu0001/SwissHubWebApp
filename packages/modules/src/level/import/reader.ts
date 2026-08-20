import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('level:import:reader');

/**
 * Lesen der alten Level-Datenbank (`levels.db`).
 *
 * Die hochgeladene Datei ist nicht vertrauenswürdig und wird ausschliesslich
 * gelesen:
 *
 *  - `readOnly`: kein ALTER, kein UPDATE, kein DELETE. Die Datei bleibt
 *    bitgleich.
 *  - Nur die fünf erwarteten Tabellen, mit fest im Code stehendem SQL. Aus
 *    der Datei kommen Werte, nie Anweisungen - und nichts davon läuft je
 *    gegen PostgreSQL.
 *  - Keine Erweiterungen, kein externer Prozess.
 *  - Kein Pfad aus dem Browser: geschrieben wird in ein frisches, zufällig
 *    benanntes Verzeichnis, das danach wieder verschwindet.
 *
 * Die Discord-IDs stehen als INTEGER in der Datei und überschreiten den
 * sicheren Zahlenbereich von JavaScript. Deshalb wird durchgehend als BigInt
 * gelesen und sofort in Text umgewandelt.
 */

/** 64 MB - eine gewachsene `levels.db` bleibt weit darunter. */
export const MAX_LEGACY_DB_BYTES = 64 * 1024 * 1024;

const SQLITE_MAGIC = 'SQLite format 3\0';

export const EXPECTED_TABLES = [
  'levels',
  'config',
  'no_xp_channels',
  'game_wins',
  'guild_config',
] as const;

export interface LegacyLevelRow {
  userId: string;
  xp: number;
  messages: number;
  voiceMinutes: number;
  /** Unix-Sekunden, `null` wenn nie gesetzt. */
  lastActivityAt: number | null;
  lastDecayAt: number | null;
  lastMessageAt: number | null;
  lastVoiceAt: number | null;
}

export interface LegacyGameWins {
  userId: string;
  xpBattle: number;
  xpSsp: number;
  xpTtt: number;
  xp4Gewinnt: number;
}

export interface LegacyConfig {
  xpBoost: number | null;
  announceLevels: string | null;
}

export interface LegacyGuildConfig {
  guildId: string;
  voiceMuteEnabled: boolean;
  voiceMuteCooldownSeconds: number;
  muteLevels: string;
  xpWhileAlone: boolean;
}

export interface LegacyLevelDatabase {
  schema: Array<{ table: string; columns: string[]; rows: number }>;
  levels: LegacyLevelRow[];
  gameWins: LegacyGameWins[];
  noXpChannelIds: string[];
  config: LegacyConfig | null;
  guildConfigs: LegacyGuildConfig[];
  sha256: string;
  bytes: number;
}

/** Pflichtspalten - fehlt eine, passt die Datei nicht. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  levels: ['user_id', 'xp'],
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
        'Das ist keine SQLite-Datenbank. Erwartet wird die Datei `levels.db` des alten Level-Bots.',
    });
  }
}

/** Discord-ID als Text. Werte kommen als BigInt aus SQLite. */
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

function asFloat(value: unknown): number | null {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

/** `0` bedeutet beim Vorgänger "nie" - das wird zu `null`. */
const asTimestamp = (value: unknown): number | null => {
  const seconds = asInt(value);
  return seconds !== null && seconds > 0 ? seconds : null;
};

export async function readLegacyLevelDatabase(data: Uint8Array): Promise<LegacyLevelDatabase> {
  assertSqliteFile(data);

  const sha256 = createHash('sha256').update(data).digest('hex');
  const { DatabaseSync } = await import('node:sqlite');

  const directory = await mkdtemp(
    join(tmpdir(), `swisshub-level-import-${randomBytes(8).toString('hex')}-`),
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

      const schema: LegacyLevelDatabase['schema'] = [];
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
            userMessage: `In der Datei fehlt die Tabelle \`${table}\`. Das ist keine Datenbank des SwissHub Level-Bots.`,
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

      const levels: LegacyLevelRow[] = query(
        `SELECT "user_id", "xp", ${optional('levels', 'messages')}, ${optional('levels', 'voice_minutes')},
                ${optional('levels', 'last_activity_at')}, ${optional('levels', 'last_decay_at')},
                ${optional('levels', 'last_message_at')}, ${optional('levels', 'last_voice_at')}
         FROM "levels"`,
      )
        .map((row) => {
          const userId = asId(row.user_id);
          if (!userId) {
            return null;
          }
          return {
            userId,
            // Negative Stände kann es nicht geben - der alte Bot klemmte auf 0.
            xp: Math.max(0, asInt(row.xp) ?? 0),
            messages: Math.max(0, asInt(row.messages) ?? 0),
            voiceMinutes: Math.max(0, asInt(row.voice_minutes) ?? 0),
            lastActivityAt: asTimestamp(row.last_activity_at),
            lastDecayAt: asTimestamp(row.last_decay_at),
            lastMessageAt: asTimestamp(row.last_message_at),
            lastVoiceAt: asTimestamp(row.last_voice_at),
          } satisfies LegacyLevelRow;
        })
        .filter((row): row is LegacyLevelRow => row !== null);

      const gameWins: LegacyGameWins[] = tables.includes('game_wins')
        ? query(
            `SELECT "user_id", ${optional('game_wins', 'xpbattle_wins')}, ${optional('game_wins', 'xp_ssp_wins')},
                    ${optional('game_wins', 'xp_ttt_wins')}, ${optional('game_wins', 'xp_4gewinnt_wins')}
             FROM "game_wins"`,
          )
            .map((row) => {
              const userId = asId(row.user_id);
              if (!userId) {
                return null;
              }
              return {
                userId,
                xpBattle: Math.max(0, asInt(row.xpbattle_wins) ?? 0),
                xpSsp: Math.max(0, asInt(row.xp_ssp_wins) ?? 0),
                xpTtt: Math.max(0, asInt(row.xp_ttt_wins) ?? 0),
                xp4Gewinnt: Math.max(0, asInt(row.xp_4gewinnt_wins) ?? 0),
              } satisfies LegacyGameWins;
            })
            .filter((row): row is LegacyGameWins => row !== null)
        : [];

      const noXpChannelIds: string[] = tables.includes('no_xp_channels')
        ? query('SELECT "channel_id" FROM "no_xp_channels"')
            .map((row) => asId(row.channel_id))
            .filter((id): id is string => id !== null)
        : [];

      const configRow = tables.includes('config')
        ? query(`SELECT ${optional('config', 'xp_boost')}, ${optional('config', 'announce_levels')} FROM "config" LIMIT 1`)[0]
        : undefined;
      const config: LegacyConfig | null = configRow
        ? {
            xpBoost: asFloat(configRow.xp_boost),
            announceLevels: asText(configRow.announce_levels),
          }
        : null;

      const guildConfigs: LegacyGuildConfig[] = tables.includes('guild_config')
        ? query(
            `SELECT "guild_id", ${optional('guild_config', 'xp_voicemute_enabled')},
                    ${optional('guild_config', 'xp_voicemute_cooldown_sec')},
                    ${optional('guild_config', 'xp_mutelevels')},
                    ${optional('guild_config', 'xp_get_xp_while_alone')}
             FROM "guild_config"`,
          )
            .map((row) => {
              const guildId = asId(row.guild_id);
              if (!guildId) {
                return null;
              }
              const mode = asText(row.xp_mutelevels)?.trim().toLowerCase();
              return {
                guildId,
                voiceMuteEnabled: (asInt(row.xp_voicemute_enabled) ?? 1) !== 0,
                voiceMuteCooldownSeconds: Math.max(0, asInt(row.xp_voicemute_cooldown_sec) ?? 0),
                muteLevels: mode === 'sound' || mode === 'voice' ? mode : 'beide',
                xpWhileAlone: (asInt(row.xp_get_xp_while_alone) ?? 1) !== 0,
              } satisfies LegacyGuildConfig;
            })
            .filter((row): row is LegacyGuildConfig => row !== null)
        : [];

      return {
        schema,
        levels,
        gameWins,
        noXpChannelIds,
        config,
        guildConfigs,
        sha256,
        bytes: data.byteLength,
      };
    } finally {
      db.close();
    }
  } finally {
    // Die Kopie verschwindet in jedem Fall - auch wenn das Lesen scheitert.
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) =>
      log.warn('Temporäres Importverzeichnis konnte nicht entfernt werden', { error }),
    );
  }
}
