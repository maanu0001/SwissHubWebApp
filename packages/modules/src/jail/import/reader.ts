import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('jail:import:reader');

/**
 * Lesen der alten SQLite-Datenbank des Jail-Bots.
 *
 * Die hochgeladene Datei ist nicht vertrauenswürdig. Deshalb gilt hier:
 *
 *  - Sie wird ausschliesslich **gelesen** (`readOnly`). Kein ALTER, kein
 *    DELETE, kein UPDATE - die Originaldatei bleibt unverändert.
 *  - Es werden nur die drei erwarteten Tabellen gelesen, mit fest im Code
 *    stehendem SQL. Aus der Datei stammt niemals SQL, nur Werte.
 *  - Erweiterungen werden nicht geladen (`DatabaseSync` tut das ohne
 *    ausdrückliche Freigabe nicht).
 *  - Der Dateiname aus dem Browser wird nie als Pfad verwendet. Geschrieben
 *    wird in ein frisches, zufällig benanntes Verzeichnis; danach wird es
 *    wieder entfernt.
 *  - Nichts davon wird jemals gegen PostgreSQL ausgeführt.
 *
 * Verwendet `node:sqlite` aus Node 22 - damit braucht es keine native
 * Abhängigkeit, die auf dem Server gebaut werden müsste.
 */

/** 32 MB - die echte Datei liegt bei rund 90 KB, das ist reichlich Reserve. */
export const MAX_LEGACY_DB_BYTES = 32 * 1024 * 1024;

/** Jede SQLite-Datei beginnt mit dieser Signatur. */
const SQLITE_MAGIC = 'SQLite format 3\0';

/** Ausschliesslich diese Tabellen werden überhaupt angefasst. */
export const EXPECTED_TABLES = ['jail_data', 'vote_cooldowns', 'active_votes'] as const;

export interface LegacyJailRow {
  user_id: string | null;
  roles: string | null;
  jailed_by: string | null;
  jail_start: string | null;
  jail_end: string | null;
  reason: string | null;
  guild_id: string | null;
  gender: string | null;
  status: string | null;
}

export interface LegacyCooldownRow {
  user_id: string | null;
  cooldown_until: string | null;
}

export interface LegacyDatabaseContents {
  /** Gefundene Tabellen mit ihren Spalten - Grundlage für die Anzeige. */
  schema: Array<{ table: string; columns: string[]; rows: number }>;
  jails: LegacyJailRow[];
  cooldowns: LegacyCooldownRow[];
  /** Laufende Abstimmungen des alten Bots (werden nicht übernommen). */
  activeVotes: number;
  sha256: string;
  bytes: number;
}

/** Spalten, die `jail_data` mindestens haben muss, damit ein Import Sinn ergibt. */
const REQUIRED_JAIL_COLUMNS = ['user_id', 'roles', 'jailed_by', 'jail_start', 'jail_end'];

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
      userMessage: 'Das ist keine SQLite-Datenbank. Erwartet wird die Datei `jail_data.db` des alten Bots.',
    });
  }
}

/** Nur Werte, keine Strukturen - alles andere wäre unerwartet. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

/**
 * Liest die Datei ein und gibt ihren Inhalt strukturiert zurück.
 *
 * Die Datei wird dafür kurz auf die Platte gelegt - SQLite braucht einen
 * Pfad. Verzeichnis und Datei werden anschliessend in jedem Fall gelöscht,
 * auch wenn das Lesen scheitert.
 */
export async function readLegacyDatabase(data: Uint8Array): Promise<LegacyDatabaseContents> {
  assertSqliteFile(data);

  const sha256 = createHash('sha256').update(data).digest('hex');
  // `node:sqlite` ist in Node 22 als experimentell markiert und wird deshalb
  // erst hier geladen - so bleibt der Rest der Anwendung davon unberührt.
  const { DatabaseSync } = await import('node:sqlite');

  const directory = await mkdtemp(join(tmpdir(), `swisshub-jail-import-${randomBytes(8).toString('hex')}-`));
  const file = join(directory, 'legacy.db');

  try {
    await writeFile(file, data, { mode: 0o600 });

    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => asText((row as { name: unknown }).name))
        .filter((name): name is string => name !== null);

      const schema: LegacyDatabaseContents['schema'] = [];
      for (const table of EXPECTED_TABLES) {
        if (!tables.includes(table)) {
          continue;
        }
        // `PRAGMA table_info` akzeptiert keinen Parameter; der Name stammt
        // ausschliesslich aus der festen Liste oben, nie aus der Datei.
        const columns = db
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((row) => asText((row as { name: unknown }).name))
          .filter((name): name is string => name !== null);
        const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
        schema.push({ table, columns, rows: Number(count?.n ?? 0) });
      }

      if (!tables.includes('jail_data')) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage:
            'In der Datei fehlt die Tabelle `jail_data`. Das ist keine Datenbank des SwissHub Jail-Bots.',
        });
      }

      const jailColumns = schema.find((entry) => entry.table === 'jail_data')?.columns ?? [];
      const missing = REQUIRED_JAIL_COLUMNS.filter((column) => !jailColumns.includes(column));
      if (missing.length > 0) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: `In \`jail_data\` fehlen die Spalten: ${missing.join(', ')}.`,
        });
      }

      // Optionale Spalten wurden im alten Bot per ALTER TABLE ergänzt - eine
      // ältere Datei kann sie deshalb nicht haben.
      const optional = (column: string): string =>
        jailColumns.includes(column) ? `"${column}"` : `NULL AS "${column}"`;

      const jails = db
        .prepare(
          `SELECT "user_id", "roles", "jailed_by", "jail_start", "jail_end",
                  ${optional('reason')}, ${optional('guild_id')},
                  ${optional('gender')}, ${optional('status')}
           FROM "jail_data"`,
        )
        .all()
        .map((row) => {
          const entry = row as Record<string, unknown>;
          return {
            user_id: asText(entry.user_id),
            roles: asText(entry.roles),
            jailed_by: asText(entry.jailed_by),
            jail_start: asText(entry.jail_start),
            jail_end: asText(entry.jail_end),
            reason: asText(entry.reason),
            guild_id: asText(entry.guild_id),
            gender: asText(entry.gender),
            status: asText(entry.status),
          } satisfies LegacyJailRow;
        });

      const cooldowns = tables.includes('vote_cooldowns')
        ? db
            .prepare('SELECT "user_id", "cooldown_until" FROM "vote_cooldowns"')
            .all()
            .map((row) => {
              const entry = row as Record<string, unknown>;
              return {
                user_id: asText(entry.user_id),
                cooldown_until: asText(entry.cooldown_until),
              } satisfies LegacyCooldownRow;
            })
        : [];

      const activeVotes = tables.includes('active_votes')
        ? Number((db.prepare('SELECT COUNT(*) AS n FROM "active_votes"').get() as { n: number })?.n ?? 0)
        : 0;

      log.info('Legacy-Datenbank gelesen', {
        jails: jails.length,
        cooldowns: cooldowns.length,
        activeVotes,
      });

      return { schema, jails, cooldowns, activeVotes, sha256, bytes: data.byteLength };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    log.error('Legacy-Datenbank konnte nicht gelesen werden', { error });
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Datei konnte nicht gelesen werden. Ist sie vollständig und unbeschädigt?',
      internalMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Die temporäre Kopie verschwindet in jedem Fall - auch bei einem Fehler.
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) =>
      log.warn('Temporäres Import-Verzeichnis konnte nicht entfernt werden', { error }),
    );
  }
}
