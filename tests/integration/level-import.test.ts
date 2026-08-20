import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
// Muss vor dem Import des Prisma Clients passieren.
useTestSchema('test_level_import');

/**
 * Übernahme der alten `levels.db`.
 *
 * Die Prüfsteine sind die, an denen eine Migration wirklich scheitert: dass
 * XP exakt gesetzt und nicht neu berechnet werden, dass dieselbe Datei nicht
 * zweimal zählt, dass eine fremde Datei abgewiesen wird und dass aus einer
 * `.env` niemals Zugangsdaten übernommen werden.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const ACTOR = { discordId: '100000000000000009', username: 'importeur' };

/** Baut eine `levels.db`, wie der alte Bot sie angelegt hätte. */
async function buildLegacyDatabase(
  rows: Array<{
    userId: string;
    xp: number;
    messages?: number;
    voiceMinutes?: number;
    lastActivityAt?: number;
  }>,
  extras: {
    noXpChannels?: string[];
    xpBoost?: number;
    announceLevels?: string;
    gameWins?: Array<{ userId: string; battle?: number; ssp?: number; ttt?: number; vier?: number }>;
  } = {},
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'swisshub-level-fixture-'));
  const file = join(directory, 'levels.db');
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE levels (
      user_id INTEGER PRIMARY KEY, xp INTEGER DEFAULT 0, messages INTEGER DEFAULT 0,
      voice_minutes INTEGER DEFAULT 0, last_activity_at INTEGER DEFAULT 0,
      last_decay_at INTEGER DEFAULT 0, last_message_at INTEGER DEFAULT 0,
      last_voice_at INTEGER DEFAULT 0
    );
    CREATE TABLE config (id INTEGER PRIMARY KEY, xp_boost REAL DEFAULT 1.0, announce_levels TEXT DEFAULT '');
    CREATE TABLE no_xp_channels (channel_id INTEGER PRIMARY KEY);
    CREATE TABLE game_wins (
      user_id INTEGER PRIMARY KEY, xpbattle_wins INTEGER NOT NULL DEFAULT 0,
      xp_ssp_wins INTEGER NOT NULL DEFAULT 0, xp_ttt_wins INTEGER NOT NULL DEFAULT 0,
      xp_4gewinnt_wins INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE guild_config (
      guild_id INTEGER PRIMARY KEY, xp_voicemute_enabled INTEGER NOT NULL DEFAULT 1,
      xp_voicemute_cooldown_sec INTEGER NOT NULL DEFAULT 0,
      xp_mutelevels TEXT NOT NULL DEFAULT 'beide',
      xp_get_xp_while_alone INTEGER NOT NULL DEFAULT 1
    );
  `);

  const insert = db.prepare(
    'INSERT INTO levels (user_id, xp, messages, voice_minutes, last_activity_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(BigInt(row.userId), row.xp, row.messages ?? 0, row.voiceMinutes ?? 0, row.lastActivityAt ?? 0);
  }

  db.prepare('INSERT INTO config (id, xp_boost, announce_levels) VALUES (1, ?, ?)').run(
    extras.xpBoost ?? 1,
    extras.announceLevels ?? '',
  );

  for (const channelId of extras.noXpChannels ?? []) {
    db.prepare('INSERT INTO no_xp_channels (channel_id) VALUES (?)').run(BigInt(channelId));
  }

  for (const wins of extras.gameWins ?? []) {
    db.prepare(
      'INSERT INTO game_wins (user_id, xpbattle_wins, xp_ssp_wins, xp_ttt_wins, xp_4gewinnt_wins) VALUES (?, ?, ?, ?, ?)',
    ).run(BigInt(wins.userId), wins.battle ?? 0, wins.ssp ?? 0, wins.ttt ?? 0, wins.vier ?? 0);
  }

  db.close();
  const data = await readFile(file);
  await rm(directory, { recursive: true, force: true });
  return new Uint8Array(data);
}

describeWithDatabase('Übernahme der alten levels.db', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "LevelImportItem", "LevelImport", "XpTransaction", "LevelGameStats",
        "LevelGameMatch", "LevelMilestoneRole", "LevelProfile", "AuditLog", "ModuleState"
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('weist etwas ab, das keine SQLite-Datei ist', async () => {
    await expect(
      level.analyseLevelImport(ACTOR, { name: 'levels.db', data: new TextEncoder().encode('nope') }),
    ).rejects.toThrow(/keine SQLite-Datenbank/u);
  });

  it('weist eine SQLite-Datei ohne Level-Tabellen ab', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swisshub-fremd-'));
    const file = join(directory, 'fremd.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE irgendwas (a INTEGER)');
    db.close();
    const data = new Uint8Array(await readFile(file));
    await rm(directory, { recursive: true, force: true });

    await expect(level.analyseLevelImport(ACTOR, { name: 'fremd.db', data })).rejects.toThrow(
      /fehlt die Tabelle/u,
    );
  });

  it('liest Discord-IDs, die grösser sind als der sichere Zahlenbereich', async () => {
    // 19-stellige IDs überschreiten Number.MAX_SAFE_INTEGER - werden sie als
    // Zahl gelesen, landen sie verfälscht in der Datenbank.
    const bigId = '1234567890123456789';
    const data = await buildLegacyDatabase([{ userId: bigId, xp: 500 }]);
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });

    expect(analysis.rows[0]!.label).toContain(bigId);
  });

  it('übernimmt XP exakt, statt sie neu zu berechnen', async () => {
    const data = await buildLegacyDatabase([
      { userId: '200000000000000001', xp: 5220, messages: 12, voiceMinutes: 3 },
    ]);
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });

    const profile = await prisma.levelProfile.findUniqueOrThrow({
      where: { discordId: '200000000000000001' },
    });
    // 12 Nachrichten und 3 Voice-Minuten ergäben neu berechnet 150 XP.
    expect(profile.xp).toBe(5220);
    expect(profile.messages).toBe(12);
    expect(profile.voiceMinutes).toBe(3);
    expect(level.levelFromXp(profile.xp)).toBe(10);
  });

  it('schreibt die Übernahme als eine Zeile ins Journal', async () => {
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 1000 }]);
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });

    const transactions = await prisma.xpTransaction.findMany({
      where: { discordId: '200000000000000001' },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.source).toBe('MIGRATION');
    expect(transactions[0]!.delta).toBe(1000);
  });

  it('addiert dieselbe Datei beim zweiten Lauf nicht erneut', async () => {
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 1000 }]);

    const first = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.executeLevelImport(ACTOR, first.importId, { legacyBotStopped: true });

    const second = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    expect(second.counts.importable).toBe(0);
    expect(second.counts.duplicate).toBeGreaterThan(0);

    await level.executeLevelImport(ACTOR, second.importId, { legacyBotStopped: true });

    const profile = await prisma.levelProfile.findUniqueOrThrow({
      where: { discordId: '200000000000000001' },
    });
    expect(profile.xp).toBe(1000);
    expect(await prisma.xpTransaction.count({ where: { source: 'MIGRATION' } })).toBe(1);
  });

  it('übernimmt nichts, solange der alte Bot nicht als abgeschaltet gemeldet ist', async () => {
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 1000 }]);
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });

    await expect(
      level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: false }),
    ).rejects.toThrow(/abgeschaltet/u);
    expect(await prisma.levelProfile.count()).toBe(0);
  });

  it('legt für leere Zeilen kein Profil an', async () => {
    const data = await buildLegacyDatabase([
      { userId: '200000000000000001', xp: 0 },
      { userId: '200000000000000002', xp: 420 },
    ]);
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });

    expect(await prisma.levelProfile.count()).toBe(1);
    expect(analysis.counts.empty).toBe(1);
  });

  it('übernimmt die Siegbilanz je Spielart', async () => {
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 1000 }], {
      gameWins: [{ userId: '200000000000000001', battle: 4, ssp: 2, ttt: 1, vier: 7 }],
    });
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });

    const stats = await prisma.levelGameStats.findMany({
      where: { discordId: '200000000000000001' },
      orderBy: { kind: 'asc' },
    });
    expect(Object.fromEntries(stats.map((entry) => [entry.kind, entry.wins]))).toEqual({
      XP_BATTLE: 4,
      XP_SSP: 2,
      XP_TTT: 1,
      XP_4GEWINNT: 7,
    });
  });

  it('übernimmt Channels ohne XP und den XP-Boost in die Einstellungen', async () => {
    // Die Einstellungen prüfen gewählte Channels gegen den Discord-Abgleich.
    await prisma.discordChannelCache.upsert({
      where: { channelId: '700000000000000005' },
      create: { channelId: '700000000000000005', name: 'bots', type: 0 },
      update: { deletedAt: null },
    });
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 100 }], {
      noXpChannels: ['700000000000000005'],
      xpBoost: 2,
      announceLevels: '5,10',
    });
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });

    const settings = await level.readLevelSettings();
    expect(settings.noXpChannelIds).toContain('700000000000000005');
    expect(settings.xpBoost).toBe(2);
    expect(settings.announceLevels).toBe('5,10');
  });

  it('überspringt Channels, die es auf Discord nicht mehr gibt', async () => {
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 100 }], {
      noXpChannels: ['700000000000000099'],
    });
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });

    const channelRow = analysis.rows.find((row) => row.kind === 'NO_XP_CHANNEL');
    expect(channelRow?.action).toBe('SKIP_INVALID');
    expect(channelRow?.note).toContain('nicht mehr');

    const result = await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });
    // Der Rest der Übernahme läuft trotzdem durch.
    expect(result.settingsError).toBeNull();
    expect((await level.readLevelSettings()).noXpChannelIds).toEqual([]);
  });

  it('übernimmt auch mehr Zeilen, als in einen Stapel passen', async () => {
    // Profile werden gebündelt geschrieben. Der Test geht bewusst über die
    // Stapelgrösse hinaus, damit die Grenze zwischen zwei Transaktionen
    // mitgeprüft wird.
    const rows = Array.from({ length: 250 }, (_unused, index) => ({
      userId: `3000000000000${(index + 100).toString().padStart(5, '0')}`,
      xp: (index + 1) * 7,
    }));
    const data = await buildLegacyDatabase(rows);

    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    const result = await level.executeLevelImport(ACTOR, analysis.importId, {
      legacyBotStopped: true,
    });

    const expectedXp = rows.reduce((sum, row) => sum + row.xp, 0);
    expect(result.failed).toBe(0);
    expect(result.totalXp).toBe(expectedXp);
    // Die Zahl liegt über 250, weil die Vorlage zusätzlich eine Zeile mit
    // Einstellungen enthält.
    expect(result.imported).toBeGreaterThanOrEqual(250);

    const stored = await prisma.levelProfile.aggregate({ _sum: { xp: true }, _count: { _all: true } });
    expect(stored._count._all).toBe(250);
    expect(stored._sum.xp).toBe(expectedXp);

    // Und das Journal deckt sich weiterhin mit den Ständen.
    const ledger = await prisma.xpTransaction.aggregate({ _sum: { delta: true } });
    expect(ledger._sum.delta).toBe(expectedXp);
  });

  it('lässt sich verwerfen, ohne etwas zu übernehmen', async () => {
    const data = await buildLegacyDatabase([{ userId: '200000000000000001', xp: 100 }]);
    const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
    await level.discardLevelImport(ACTOR, analysis.importId);

    expect(await prisma.levelImport.count()).toBe(0);
    expect(await prisma.levelProfile.count()).toBe(0);
  });
});

describeWithDatabase('Übernahme aus der alten .env', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "LevelMilestoneRole", "AuditLog", "ModuleState" RESTART IDENTITY CASCADE',
    );
  });

  const envFile = (content: string): Uint8Array => new TextEncoder().encode(content);

  it('liest ausschliesslich Namen von der Positivliste', () => {
    const preview = level.analyseLegacyEnv(
      envFile(
        [
          'BOT_TOKEN=MTIzNDU2Nzg5.geheim.nichtanzeigen',
          'AUTH_SECRET=streng-geheim',
          'DATABASE_URL=postgresql://user:passwort@host/db',
          'REDIS_URL=redis://host:6379',
          'XP_PER_MESSAGE=15',
          'NO_XP_ROLE_ID=800000000000000001',
        ].join('\n'),
      ),
    );

    const keys = preview.settings.map((entry) => entry.key);
    expect(keys).toEqual(['NO_XP_ROLE_ID', 'XP_PER_MESSAGE']);

    // Und nichts davon taucht irgendwo in der Vorschau auf.
    const serialised = JSON.stringify(preview);
    for (const secret of ['geheim', 'passwort', 'BOT_TOKEN', 'AUTH_SECRET', 'DATABASE_URL', 'REDIS_URL']) {
      expect(serialised).not.toContain(secret);
    }
    expect(preview.ignoredKeys).toBe(4);
  });

  it('übernimmt nur ausdrücklich ausgewählte Werte', async () => {
    const data = envFile('XP_PER_MESSAGE=15\nXP_PER_VOICE_MINUTE=25\n');
    const result = await level.applyLegacyEnv(ACTOR, data, ['XP_PER_MESSAGE']);

    expect(result.applied).toEqual(['XP_PER_MESSAGE']);
    const settings = await level.readLevelSettings();
    expect(settings.xpPerMessage).toBe(15);
    expect(settings.xpPerVoiceMinute).toBe(10);
  });

  it('macht aus MILESTONE_ROLES echte Level-Rollen', async () => {
    const data = envFile('MILESTONE_ROLES=5:800000000000000005,10:800000000000000010\n');
    const result = await level.applyLegacyEnv(ACTOR, data, ['MILESTONE_ROLES']);

    expect(result.milestones).toBe(2);
    const roles = await prisma.levelMilestoneRole.findMany({ orderBy: { level: 'asc' } });
    expect(roles.map((entry) => [entry.level, entry.roleId])).toEqual([
      [5, '800000000000000005'],
      [10, '800000000000000010'],
    ]);
  });

  it('meldet unbrauchbare Werte, statt sie zu übernehmen', () => {
    const preview = level.analyseLegacyEnv(envFile('NO_XP_ROLE_ID=keine-id\nXP_PER_MESSAGE=vieles\n'));
    expect(preview.settings.every((entry) => !entry.valid)).toBe(true);
    expect(preview.applicable).toBe(0);
  });

  it('weist eine übergrosse Datei ab', () => {
    const huge = new Uint8Array(level.MAX_ENV_BYTES + 1);
    expect(() => level.analyseLegacyEnv(huge)).toThrow(/zu gross/u);
  });
});
