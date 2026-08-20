import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Übernahme der alten Jail-Datenbank.
 *
 * Der Aufbau der Testdatei entspricht exakt dem, was der frühere Bot erzeugt
 * hat - inklusive der per `ALTER TABLE` nachgerüsteten Spalten und der
 * Eigenheiten der echten Daten (kein Grund, kein `guild_id`, `jail_end IS
 * NULL` für unbefristet, Status `expired_pending_restore`).
 *
 * Geprüft wird vor allem, was schiefgehen könnte: dass nichts doppelt
 * angelegt wird, dass bestehende Jails nicht überschrieben werden, dass
 * unlesbare Zeilen den Durchgang nicht kippen und dass die hochgeladene Datei
 * unverändert bleibt.
 */
const fake: { state?: unknown; module?: unknown } = {};

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const { jail } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');

type State = ReturnType<typeof createFakeState>;

const JAIL_ROLE = '900000000000000006';
const MEMBER_ROLE = '900000000000000001';
const TARGET = '100000000000000004';
const OTHER = '100000000000000006';
const MODERATOR_ID = '100000000000000002';

const ACTOR = { discordId: MODERATOR_ID, username: 'nina.mod' };

let state: State;
let gateway: ReturnType<typeof createMockGateway>;
const directories: string[] = [];

/** Legt eine Datei mit dem Schema des alten Bots an und gibt ihre Bytes zurück. */
async function legacyDatabase(
  rows: Array<{
    user_id: string;
    roles?: string | null;
    jailed_by?: string | null;
    jail_start?: string | null;
    jail_end?: string | null;
    reason?: string | null;
    guild_id?: string | null;
    gender?: string | null;
    status?: string | null;
  }>,
  cooldowns: Array<{ user_id: string; cooldown_until: string }> = [],
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'swisshub-legacy-fixture-'));
  directories.push(directory);
  const file = join(directory, 'jail_data.db');

  const db = new DatabaseSync(file);
  // Wortgleich das Schema des alten Bots, inklusive der nachgerüsteten Spalten.
  db.exec(`CREATE TABLE jail_data (
        user_id TEXT PRIMARY KEY,
        roles TEXT,
        jailed_by TEXT,
        jail_start TEXT,
        jail_end TEXT
    , reason TEXT, guild_id TEXT, gender TEXT DEFAULT 'neutral', status TEXT DEFAULT 'active')`);
  db.exec(`CREATE TABLE vote_cooldowns (user_id TEXT PRIMARY KEY, cooldown_until TEXT NOT NULL)`);
  db.exec(`CREATE TABLE active_votes (
                    initiator_id TEXT PRIMARY KEY,
                    target_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    message_id TEXT,
                    started_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )`);

  const insert = db.prepare(
    `INSERT INTO jail_data (user_id, roles, jailed_by, jail_start, jail_end, reason, guild_id, gender, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      row.user_id,
      row.roles ?? '',
      row.jailed_by ?? MODERATOR_ID,
      row.jail_start ?? '2025-02-14T18:25:12.522517+01:00',
      row.jail_end ?? null,
      row.reason ?? null,
      row.guild_id ?? null,
      row.gender ?? 'neutral',
      row.status ?? 'active',
    );
  }

  const cooldown = db.prepare('INSERT INTO vote_cooldowns (user_id, cooldown_until) VALUES (?, ?)');
  for (const entry of cooldowns) {
    cooldown.run(entry.user_id, entry.cooldown_until);
  }
  db.close();

  return new Uint8Array(await readFile(file));
}

function resetState(): void {
  state = fake.state as State;
  state.jails.length = 0;
  state.jailRoleSnapshots.length = 0;
  state.jailImports.length = 0;
  state.jailImportRows.length = 0;
  state.voteJailCooldowns.length = 0;
  state.audits.length = 0;
  state.reconciliationRuns.length = 0;
  state.idempotency.clear();
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 7 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: false,
    notifyInJailChannel: false,
    announcePublicly: false,
    pingOnJail: false,
  };
}

beforeEach(() => {
  resetState();
  gateway = createMockGateway();
  setDiscordGateway(gateway);
});

afterAll(async () => {
  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Legacy-Datei lesen', () => {
  it('erkennt Tabellen, Spalten und Zeilen', async () => {
    const bytes = await legacyDatabase([{ user_id: TARGET, roles: `${MEMBER_ROLE},invalid` }]);
    const contents = await jail.readLegacyDatabase(bytes);

    expect(contents.schema.map((entry) => entry.table)).toEqual([
      'jail_data',
      'vote_cooldowns',
      'active_votes',
    ]);
    expect(contents.schema[0]?.columns).toContain('gender');
    expect(contents.jails).toHaveLength(1);
  });

  it('lässt die hochgeladene Datei unverändert', async () => {
    const bytes = await legacyDatabase([{ user_id: TARGET }]);
    const before = Buffer.from(bytes).toString('base64');

    await jail.readLegacyDatabase(bytes);

    expect(Buffer.from(bytes).toString('base64')).toBe(before);
  });

  it('weist alles zurück, was keine SQLite-Datei ist', async () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
    await expect(jail.readLegacyDatabase(html)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(jail.readLegacyDatabase(new Uint8Array(0))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('weist eine SQLite-Datei ohne `jail_data` zurück', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swisshub-legacy-empty-'));
    directories.push(directory);
    const file = join(directory, 'other.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE something_else (id TEXT)');
    db.close();

    await expect(jail.readLegacyDatabase(new Uint8Array(await readFile(file)))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('Analyse', () => {
  it('bewertet jede Zeile und legt dabei nichts an', async () => {
    const bytes = await legacyDatabase([
      { user_id: TARGET, roles: MEMBER_ROLE, reason: 'Spam' },
      { user_id: 'kein-snowflake', roles: MEMBER_ROLE },
      { user_id: OTHER, jail_start: 'völlig kaputt' },
    ]);

    const result = await jail.analyseLegacyImport(bytes, 'jail_data.db', ACTOR);

    expect(result.importRecord.totalRows).toBe(3);
    expect(result.importRecord.importableRows).toBe(1);
    expect(result.importRecord.invalidRows).toBe(2);
    // Entscheidend: die Analyse allein erzeugt keinen einzigen Jail.
    expect(state.jails).toHaveLength(0);
  });

  it('erkennt einen laufenden Jail als Konflikt', async () => {
    await jail.createJail(
      { targetDiscordId: TARGET, durationSeconds: 600, reason: 'Spam', idempotencyKey: crypto.randomUUID() },
      { discordId: MODERATOR_ID, username: 'nina.mod', roleIds: [], isOwner: true, moderationLevel: 100 },
      { gateway },
    );

    const bytes = await legacyDatabase([{ user_id: TARGET, roles: MEMBER_ROLE }]);
    const result = await jail.analyseLegacyImport(bytes, 'jail_data.db', ACTOR);

    expect(result.importRecord.conflictRows).toBe(1);
    expect(result.importRecord.importableRows).toBe(0);
  });
});

describe('Übernahme', () => {
  const bytes = (): Promise<Uint8Array> =>
    legacyDatabase([
      // Unbefristet - im alten Bot bedeutete `jail_end IS NULL` genau das.
      { user_id: TARGET, roles: `${MEMBER_ROLE},999`, reason: 'sus-link' },
      // Auf Zeit, mit Grund und gesetztem Geschlecht.
      {
        user_id: OTHER,
        roles: MEMBER_ROLE,
        jail_start: '2026-08-01T10:00:00+02:00',
        jail_end: '2027-08-01T10:00:00+02:00',
        reason: 'Werbung',
        gender: 'female',
      },
    ]);

  it('verlangt die Bestätigung, dass der alte Bot gestoppt ist', async () => {
    const analysis = await jail.analyseLegacyImport(await bytes(), 'jail_data.db', ACTOR);

    await expect(
      jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
        legacyBotStopped: false,
        gateway,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.jails).toHaveLength(0);
  });

  it('legt permanente und befristete Jails korrekt an', async () => {
    const analysis = await jail.analyseLegacyImport(await bytes(), 'jail_data.db', ACTOR);
    const result = await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    expect(result.imported).toBe(2);

    const permanent = state.jails.find((entry) => entry.targetDiscordId === TARGET);
    expect(permanent?.type).toBe('PERMANENT');
    // Kein erfundenes Enddatum wie 31.12.9999.
    expect(permanent?.endsAt).toBeNull();
    expect(permanent?.durationSeconds).toBeNull();
    expect(permanent?.source).toBe('IMPORT');
    expect(permanent?.lifecycle).toBe('ACTIVE');
    expect(permanent?.activeKey).toBe(TARGET);
    // Nur echte Rollen-IDs werden übernommen.
    expect(permanent?.roleSnapshot).toEqual([MEMBER_ROLE]);

    const temporary = state.jails.find((entry) => entry.targetDiscordId === OTHER);
    expect(temporary?.type).toBe('TEMPORARY');
    expect(temporary?.endsAt).not.toBeNull();
    expect(temporary?.durationSeconds).toBe(365 * 24 * 60 * 60);
  });

  it('schreibt den Rollen-Snapshot als eigene Zeilen', async () => {
    const analysis = await jail.analyseLegacyImport(await bytes(), 'jail_data.db', ACTOR);
    await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    const permanent = state.jails.find((entry) => entry.targetDiscordId === TARGET)!;
    const snapshot = state.jailRoleSnapshots.filter((row) => row.jailId === permanent.id);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.roleId).toBe(MEMBER_ROLE);
    // Der Name kommt aus der aktuellen Guild, weil es die Rolle noch gibt.
    expect(snapshot[0]?.roleNameAtTime).not.toBeNull();
  });

  it('setzt einen fehlenden Grund auf einen sprechenden Text', async () => {
    const analysis = await jail.analyseLegacyImport(
      await legacyDatabase([{ user_id: TARGET, roles: MEMBER_ROLE, reason: null }]),
      'jail_data.db',
      ACTOR,
    );
    await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    expect(state.jails[0]?.reason).toContain('Kein Grund angegeben');
  });

  it('übernimmt `expired_pending_restore` als offenen Jail', async () => {
    // Der alte Bot liess solche Einträge bewusst stehen: die Zeit war um, das
    // Mitglied aber nicht erreichbar. Die Rollen fehlen also noch.
    const analysis = await jail.analyseLegacyImport(
      await legacyDatabase([
        {
          user_id: TARGET,
          roles: MEMBER_ROLE,
          jail_start: '2025-02-14T18:25:12+01:00',
          jail_end: '2025-02-15T18:25:12+01:00',
          status: 'expired_pending_restore',
        },
      ]),
      'jail_data.db',
      ACTOR,
    );
    await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    expect(state.jails[0]?.lifecycle).toBe('PENDING_REJOIN');
    expect(state.jails[0]?.releasedAt).toBeNull();
  });

  it('ist wiederholbar und legt beim zweiten Durchgang nichts doppelt an', async () => {
    const data = await bytes();

    const first = await jail.analyseLegacyImport(data, 'jail_data.db', ACTOR);
    await jail.executeLegacyImport(first.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });
    expect(state.jails).toHaveLength(2);

    // Zweiter Durchgang mit derselben Datei.
    const second = await jail.analyseLegacyImport(data, 'jail_data.db', ACTOR);
    expect(second.importRecord.duplicateRows).toBe(2);
    expect(second.importRecord.importableRows).toBe(0);

    const result = await jail.executeLegacyImport(second.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });
    expect(result.imported).toBe(0);
    expect(state.jails).toHaveLength(2);
  });

  it('überschreibt einen bestehenden Jail nicht', async () => {
    await jail.createJail(
      {
        targetDiscordId: TARGET,
        durationSeconds: 600,
        reason: 'Bereits im Dashboard',
        idempotencyKey: crypto.randomUUID(),
      },
      { discordId: MODERATOR_ID, username: 'nina.mod', roleIds: [], isOwner: true, moderationLevel: 100 },
      { gateway },
    );

    const analysis = await jail.analyseLegacyImport(await bytes(), 'jail_data.db', ACTOR);
    await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    const existing = state.jails.filter((entry) => entry.targetDiscordId === TARGET);
    expect(existing).toHaveLength(1);
    expect(existing[0]?.reason).toBe('Bereits im Dashboard');
  });

  it('übernimmt laufende Vote-Sperrfristen und lässt abgelaufene weg', async () => {
    const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const analysis = await jail.analyseLegacyImport(
      await legacyDatabase(
        [{ user_id: TARGET, roles: MEMBER_ROLE }],
        [
          { user_id: OTHER, cooldown_until: future },
          { user_id: MODERATOR_ID, cooldown_until: past },
        ],
      ),
      'jail_data.db',
      ACTOR,
    );

    const result = await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    expect(result.cooldowns).toBe(1);
    expect(state.voteJailCooldowns.map((entry) => entry.discordId)).toEqual([OTHER]);
  });

  it('protokolliert Analyse und Übernahme im Audit Log', async () => {
    const analysis = await jail.analyseLegacyImport(await bytes(), 'jail_data.db', ACTOR);
    await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    const actions = state.audits.map((entry) => entry.action);
    expect(actions).toContain('JAIL_IMPORT_UPLOADED');
    expect(actions).toContain('JAIL_IMPORT_CONFIRMED');
    expect(actions).toContain('JAIL_IMPORT_COMPLETED');
    // Der Dateiinhalt taucht im Audit Log nicht auf.
    expect(JSON.stringify(state.audits)).not.toContain('SQLite format');
  });

  it('lehnt einen zweiten Durchlauf desselben Imports ab', async () => {
    const analysis = await jail.analyseLegacyImport(await bytes(), 'jail_data.db', ACTOR);
    await jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
      reconcile: false,
    });

    await expect(
      jail.executeLegacyImport(analysis.importRecord.id, ACTOR, {
        legacyBotStopped: true,
        gateway,
        reconcile: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('Abbildung einzelner Werte', () => {
  it('liest Python-Zeitstempel mit Mikrosekunden und Offset', () => {
    const parsed = jail.parseLegacyTimestamp('2025-02-14T18:25:12.522517+01:00');
    expect(parsed?.toISOString()).toBe('2025-02-14T17:25:12.522Z');
    expect(jail.parseLegacyTimestamp(null)).toBeNull();
    expect(jail.parseLegacyTimestamp('nonsense')).toBeNull();
  });

  it('filtert unbrauchbare Einträge aus der Rollenliste', () => {
    expect(jail.parseLegacyRoles('123,abc,,900000000000000001')).toEqual(['900000000000000001']);
    expect(jail.parseLegacyRoles(null)).toEqual([]);
    // Doppelte Einträge nur einmal.
    expect(jail.parseLegacyRoles('900000000000000001,900000000000000001')).toEqual(['900000000000000001']);
  });

  it('bildet die Statuswerte des alten Bots ab', () => {
    expect(jail.mapLegacyStatus('active')).toBe('ACTIVE');
    expect(jail.mapLegacyStatus('pending')).toBe('ACTIVE');
    expect(jail.mapLegacyStatus(null)).toBe('ACTIVE');
    expect(jail.mapLegacyStatus('expired_pending_restore')).toBe('PENDING_REJOIN');
    expect(jail.mapLegacyStatus('restore_failed')).toBe('RESTORE_FAILED');
  });
});
