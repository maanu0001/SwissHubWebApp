import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, TEST_DATABASE_URL, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
useTestSchema('test_spielersuche_import');

/**
 * Übernahme der alten Spielersuche-Datenbank.
 *
 * Die Testdatei bildet das Schema des früheren Bots exakt nach - inklusive
 * der Eigenheiten der echten Daten: Discord-IDs als INTEGER (und damit
 * jenseits des sicheren JavaScript-Zahlenbereichs), mehrere Server in einer
 * Datei und zwei unterschiedliche Schreibweisen desselben Befehlsnamens.
 */
const { prisma } = await import('@swisshub/database');
const { spielersuche, setModuleSettings } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');

const GUILD = '630124124756246548';
const OTHER_GUILD = '1452684017391374348';
const ROLE_CS2 = '900000000000000001';
const ACTOR = { discordId: '100000000000000001', username: 'admin' };

let gateway: ReturnType<typeof createMockGateway>;
const directories: string[] = [];

interface LegacyRows {
  settings?: Array<[string, string, string, number, number]>;
  games?: Array<[number, string, string, string, string | null, number | null]>;
  matches?: Array<Record<string, unknown>>;
  participants?: Array<[number, string, string]>;
  usages?: Array<[number, string, string, string, string]>;
  voice?: Array<[number, string, string, number, string, string, string | null, number]>;
  pings?: Array<[string, number, string, string]>;
}

/** Legt eine Datei mit dem Schema des alten Bots an. */
async function legacyDatabase(rows: LegacyRows): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'swisshub-matchmaking-'));
  directories.push(directory);
  const file = join(directory, 'matchmaking.db');
  const db = new DatabaseSync(file);

  // Wortgleich das Schema des alten Bots - Discord-IDs als INTEGER.
  db.exec(`CREATE TABLE guild_settings (
      guild_id INTEGER PRIMARY KEY, search_channel_id INTEGER NOT NULL,
      voice_category_id INTEGER NOT NULL, expiry_hours INTEGER NOT NULL DEFAULT 12,
      accent_color INTEGER NOT NULL DEFAULT 11525109)`);
  db.exec(`CREATE TABLE games (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, name TEXT NOT NULL,
      role_id INTEGER NOT NULL, image_url TEXT, created_at TEXT NOT NULL, user_limit INTEGER,
      UNIQUE(guild_id, name COLLATE NOCASE))`);
  db.exec(`CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, creator_id INTEGER NOT NULL,
      game_id INTEGER, game TEXT NOT NULL, ping_role_id INTEGER, image_url TEXT,
      requested_players INTEGER NOT NULL, when_text TEXT NOT NULL, mode TEXT, details TEXT,
      status TEXT NOT NULL DEFAULT 'open', channel_id INTEGER, message_id INTEGER UNIQUE,
      voice_channel_id INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, closed_at TEXT)`);
  db.exec(`CREATE TABLE participants (
      match_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT NOT NULL,
      PRIMARY KEY (match_id, user_id))`);
  db.exec(`CREATE TABLE role_ping_log (
      guild_id INTEGER NOT NULL, game_id INTEGER NOT NULL, role_id INTEGER NOT NULL,
      pinged_at TEXT NOT NULL, PRIMARY KEY (guild_id, game_id))`);
  db.exec(`CREATE TABLE command_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      command_name TEXT NOT NULL, used_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE voice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL, voice_channel_id INTEGER NOT NULL, joined_at TEXT NOT NULL,
      left_at TEXT, duration_seconds INTEGER NOT NULL DEFAULT 0)`);

  for (const row of rows.settings ?? []) {
    db.prepare('INSERT INTO guild_settings VALUES (?, ?, ?, ?, ?)').run(...row);
  }
  for (const row of rows.games ?? []) {
    db.prepare(
      'INSERT INTO games (id, guild_id, name, role_id, image_url, user_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(row[0], row[1], row[2], row[3], row[4], row[5], '2026-07-23T18:28:34.502369+00:00');
  }
  for (const match of rows.matches ?? []) {
    db.prepare(
      `INSERT INTO matches (id, guild_id, creator_id, game_id, game, ping_role_id, image_url,
        requested_players, when_text, details, status, channel_id, message_id, voice_channel_id,
        created_at, expires_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Nöd ahgeh', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      match.id as number,
      match.guild_id as string,
      match.creator_id as string,
      (match.game_id as number | null) ?? null,
      match.game as string,
      (match.ping_role_id as string | null) ?? null,
      (match.image_url as string | null) ?? null,
      match.requested_players as number,
      (match.details as string | null) ?? null,
      (match.status as string) ?? 'closed',
      (match.channel_id as string | null) ?? null,
      (match.message_id as string | null) ?? null,
      (match.voice_channel_id as string | null) ?? null,
      match.created_at as string,
      match.expires_at as string,
      (match.closed_at as string | null) ?? null,
    );
  }
  for (const row of rows.participants ?? []) {
    db.prepare('INSERT INTO participants VALUES (?, ?, ?)').run(...row);
  }
  for (const row of rows.usages ?? []) {
    db.prepare('INSERT INTO command_usage VALUES (?, ?, ?, ?, ?)').run(...row);
  }
  for (const row of rows.voice ?? []) {
    db.prepare('INSERT INTO voice_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...row);
  }
  for (const row of rows.pings ?? []) {
    db.prepare('INSERT INTO role_ping_log VALUES (?, ?, ?, ?)').run(...row);
  }
  db.close();

  return new Uint8Array(await readFile(file));
}

/** Eine Datei mit denselben Merkmalen wie die echte Produktivdatei. */
async function realisticDatabase(): Promise<Uint8Array> {
  return legacyDatabase({
    settings: [
      [GUILD, '669648378313048094', '663195298381824001', 12, 11525109],
      [OTHER_GUILD, '1452684020776439991', '1452684021451456616', 12, 11525109],
    ],
    games: [
      [18, GUILD, 'CS2', '1452684017676582967', 'https://i.imgur.com/oaQ5e2N.png', 5],
      [21, GUILD, 'Minecraft', '1452684017676582968', 'https://i.imgur.com/9TZBpDV.png', null],
      // Gleicher Name auf dem Testserver - darf hier nicht mitkommen.
      [5, OTHER_GUILD, 'CS2', '1452684017676582967', 'https://i.imgur.com/oaQ5e2N.png', null],
    ],
    matches: [
      {
        id: 9,
        guild_id: GUILD,
        creator_id: '326689031444365312',
        game_id: 18,
        game: 'CS2',
        ping_role_id: '1452684017676582967',
        image_url: 'https://i.imgur.com/oaQ5e2N.png',
        requested_players: 4,
        details: 'Premier',
        status: 'closed',
        channel_id: '669648378313048094',
        message_id: '1534576954609631399',
        created_at: '2026-08-05T15:00:00+00:00',
        expires_at: '2026-08-06T03:00:00+00:00',
        closed_at: '2026-08-05T16:00:00+00:00',
      },
      {
        // Beim Export noch offen - kommt als Historie herein.
        id: 10,
        guild_id: GUILD,
        creator_id: '326689031444365312',
        game_id: 21,
        game: 'Minecraft',
        requested_players: 2,
        status: 'open',
        created_at: '2026-08-19T15:00:00+00:00',
        expires_at: '2026-08-20T03:00:00+00:00',
      },
      // Anderer Server.
      {
        id: 1,
        guild_id: OTHER_GUILD,
        creator_id: '322828317126426625',
        game_id: 5,
        game: 'CS2',
        requested_players: 4,
        status: 'closed',
        created_at: '2026-07-22T20:43:48+00:00',
        expires_at: '2026-07-23T08:43:48+00:00',
      },
    ],
    participants: [
      [9, '326689031444365312', '2026-08-05T15:00:00+00:00'],
      [9, '683787767859511515', '2026-08-05T15:05:00+00:00'],
      [1, '322828317126426625', '2026-07-22T20:43:48+00:00'],
    ],
    usages: [
      // Beide Schreibweisen - der alte Bot schrieb je nach Version anders.
      [1, GUILD, '326689031444365312', 'spielersuche', '2026-08-05T15:00:00+00:00'],
      [2, GUILD, '326689031444365312', 'spielersuechi', '2026-08-19T15:00:00+00:00'],
      [3, OTHER_GUILD, '322828317126426625', 'spielersuche', '2026-07-22T20:43:48+00:00'],
    ],
    voice: [
      [
        3,
        GUILD,
        '326689031444365312',
        9,
        '1534576954609631322',
        '2026-08-05T15:01:13+00:00',
        '2026-08-05T15:21:53+00:00',
        1240,
      ],
      // Ohne Endzeitpunkt - beim alten Bot hängengeblieben.
      [4, GUILD, '683787767859511515', 9, '1534576954609631322', '2026-08-05T15:02:00+00:00', null, 900],
    ],
    pings: [[GUILD, 18, '1452684017676582967', '2026-07-22T20:43:48+00:00']],
  });
}

beforeAll(() => {
  if (TEST_DATABASE_URL) {
    pushSchema();
  }
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function reset(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SpielersucheImportItem", "SpielersucheImport", "SpielersucheVoiceSession",
      "SpielersucheParticipant", "SpielersucheRolePing", "SpielersucheUsage",
      "SpielersucheMatch", "SpielersucheGame", "AuditLog", "ModuleState"
    RESTART IDENTITY CASCADE
  `);
  await setModuleSettings(
    spielersuche.SPIELERSUCHE_MODULE_ID,
    { searchChannelId: '700000000000000003', voiceCategoryId: '700000000000000010' },
    'test',
  );
}

describeWithDatabase('Legacy-Datei lesen', () => {
  beforeEach(async () => {
    await reset();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
  });

  it('liest Discord-IDs, die den sicheren Zahlenbereich überschreiten', async () => {
    const contents = await spielersuche.readLegacyDatabase(await realisticDatabase());

    // 1452684017676582967 ist grösser als Number.MAX_SAFE_INTEGER - als Zahl
    // gelesen käme hier ein falscher Wert heraus.
    const cs2 = contents.games.find((game) => game.name === 'CS2' && game.guildId === GUILD);
    expect(cs2?.roleId).toBe('1452684017676582967');
    // Als Zahl gelesen ginge die Genauigkeit verloren - die ID wäre falsch.
    expect(String(Number('1452684017676582967'))).not.toBe('1452684017676582967');
  });

  it('erkennt alle Server in der Datei', async () => {
    const contents = await spielersuche.readLegacyDatabase(await realisticDatabase());

    expect(contents.guilds).toHaveLength(2);
    // Der Server mit den meisten Daten steht vorne und wird vorgeschlagen.
    expect(contents.guilds[0]?.guildId).toBe(GUILD);
  });

  it('lässt die hochgeladene Datei unverändert', async () => {
    const bytes = await realisticDatabase();
    const before = Buffer.from(bytes).toString('base64');

    await spielersuche.readLegacyDatabase(bytes);

    expect(Buffer.from(bytes).toString('base64')).toBe(before);
  });

  it('weist alles zurück, was keine passende SQLite-Datei ist', async () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
    await expect(spielersuche.readLegacyDatabase(html)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(spielersuche.readLegacyDatabase(new Uint8Array(0))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    const empty = await legacyDatabase({});
    // Leere, aber strukturell passende Datei ist in Ordnung.
    await expect(spielersuche.readLegacyDatabase(empty)).resolves.toBeTruthy();
  });
});

describeWithDatabase('Analyse', () => {
  beforeEach(async () => {
    await reset();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
  });

  it('bewertet jede Zeile und legt dabei nichts an', async () => {
    const result = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: GUILD },
    );

    expect(result.importRecord.sourceGuildId).toBe(GUILD);
    expect(result.importRecord.importableRows).toBeGreaterThan(0);
    // Daten des Testservers werden sichtbar übersprungen, nicht vermischt.
    expect(result.importRecord.otherGuildRows).toBeGreaterThan(0);

    expect(await prisma.spielersucheGame.count()).toBe(0);
    expect(await prisma.spielersucheMatch.count()).toBe(0);
  });

  it('übernimmt nur den gewählten Server', async () => {
    const result = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: OTHER_GUILD },
    );

    expect(result.importRecord.sourceGuildId).toBe(OTHER_GUILD);
    const games = result.items.filter((item) => item.kind === 'GAME' && item.action === 'IMPORT');
    expect(games).toHaveLength(1);
    expect(games[0]?.label).toBe('CS2');
  });

  it('erkennt ein gleichnamiges bestehendes Spiel als Konflikt', async () => {
    await spielersuche.createGame(
      { name: 'CS2', roleId: ROLE_CS2, bannerUrl: null, maxSquadSize: 5, enabled: true },
      ACTOR,
    );

    const result = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: GUILD },
    );

    const conflicts = result.items.filter((item) => item.action === 'CONFLICT');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.label).toBe('CS2');
  });

  it('lässt einen veralteten Rollen-Ping aus', async () => {
    // Ein Ping von 2026-07 darf nach der Umstellung niemanden blockieren.
    const result = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: GUILD },
    );

    const ping = result.items.find((item) => item.kind === 'ROLE_PING');
    expect(ping?.action).toBe('SKIP_INVALID');
  });
});

describeWithDatabase('Übernahme', () => {
  beforeEach(async () => {
    await reset();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
  });

  async function analyseAndImport(applySettings = false): Promise<void> {
    const analysis = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: GUILD },
    );
    await spielersuche.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      applySettings,
      gateway,
    });
  }

  it('verlangt die Bestätigung, dass der alte Bot gestoppt ist', async () => {
    const analysis = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: GUILD },
    );

    await expect(
      spielersuche.executeLegacyImport(analysis.importRecord.id, ACTOR, {
        legacyBotStopped: false,
        gateway,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.spielersucheGame.count()).toBe(0);
  });

  it('übernimmt Spiele mit Banner und Squad-Grösse', async () => {
    await analyseAndImport();

    const games = await prisma.spielersucheGame.findMany({ orderBy: { name: 'asc' } });
    expect(games).toHaveLength(2);

    const cs2 = games.find((game) => game.name === 'CS2');
    expect(cs2?.roleId).toBe('1452684017676582967');
    expect(cs2?.maxSquadSize).toBe(5);
    expect(cs2?.bannerUrl).toBe('https://i.imgur.com/oaQ5e2N.png');
    expect(cs2?.legacyId).toBe(18);

    const minecraft = games.find((game) => game.name === 'Minecraft');
    // Kein Limit = unbegrenzt, kein erfundener Wert.
    expect(minecraft?.maxSquadSize).toBeNull();
  });

  it('übernimmt Suchen als abgeschlossene Historie', async () => {
    await analyseAndImport();

    const matches = await prisma.spielersucheMatch.findMany({ orderBy: { legacyId: 'asc' } });
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(match.source).toBe('LEGACY_IMPORT');
      // Auch die beim Export noch offene Suche kommt geschlossen herein: ihre
      // Discord-Nachricht gehört dem alten Bot.
      expect(['CLOSED', 'EXPIRED']).toContain(match.status);
      expect(match.activeCreatorKey).toBeNull();
    }

    const cs2 = matches.find((match) => match.legacyId === 9);
    expect(cs2?.gameName).toBe('CS2');
    expect(cs2?.comment).toBe('Premier');
    expect(cs2?.requestedPlayers).toBe(4);
    expect(cs2?.gameId).not.toBeNull();
  });

  it('übernimmt Teilnahmen und erkennt den Ersteller', async () => {
    await analyseAndImport();

    const match = await prisma.spielersucheMatch.findFirstOrThrow({ where: { legacyId: 9 } });
    const participants = await prisma.spielersucheParticipant.findMany({
      where: { matchId: match.id },
    });

    expect(participants).toHaveLength(2);
    expect(participants.filter((entry) => entry.isCreator)).toHaveLength(1);
    // Historisch: die Teilnahme ist beendet, sie taucht nicht als aktiv auf.
    expect(participants.every((entry) => entry.leftAt !== null)).toBe(true);
  });

  it('vereinheitlicht beide Schreibweisen des Befehlsnamens', async () => {
    await analyseAndImport();

    const usages = await prisma.spielersucheUsage.findMany();
    // Der alte Bot schrieb `spielersuechi`, seine Statistik suchte aber nach
    // `spielersuche` - ein Teil der Nutzung fehlte dadurch in der Auswertung.
    expect(usages).toHaveLength(2);
    expect(usages.every((entry) => entry.command === 'spielersuche')).toBe(true);

    const stats = await spielersuche.getUserStats('326689031444365312');
    expect(stats.usageCount).toBe(2);
  });

  it('übernimmt Voice-Zeit und erfindet keine unendlichen Sessions', async () => {
    await analyseAndImport();

    const sessions = await prisma.spielersucheVoiceSession.findMany({ orderBy: { legacyId: 'asc' } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.durationSeconds).toBe(1240);

    // Die Session ohne Endzeitpunkt bekommt die gespeicherte Dauer und ein
    // Ende - sonst würde sie ewig weiterzählen.
    expect(sessions[1]?.durationSeconds).toBe(900);
    expect(sessions[1]?.leftAt).not.toBeNull();
    expect(await prisma.spielersucheVoiceSession.count({ where: { leftAt: null } })).toBe(0);
  });

  it('ist wiederholbar und legt beim zweiten Durchgang nichts doppelt an', async () => {
    const data = await realisticDatabase();

    const first = await spielersuche.analyseLegacyImport(data, 'matchmaking.db', ACTOR, {
      sourceGuildId: GUILD,
    });
    await spielersuche.executeLegacyImport(first.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
    });

    const gamesAfterFirst = await prisma.spielersucheGame.count();
    const matchesAfterFirst = await prisma.spielersucheMatch.count();

    const second = await spielersuche.analyseLegacyImport(data, 'matchmaking.db', ACTOR, {
      sourceGuildId: GUILD,
    });
    expect(second.importRecord.duplicateRows).toBeGreaterThan(0);
    await spielersuche.executeLegacyImport(second.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
    });

    expect(await prisma.spielersucheGame.count()).toBe(gamesAfterFirst);
    expect(await prisma.spielersucheMatch.count()).toBe(matchesAfterFirst);
  });

  it('übernimmt die Konfiguration nur auf Wunsch und nur für vorhandene Channels', async () => {
    await analyseAndImport(true);

    const { getModuleSettings } = await import('@swisshub/modules');
    const settings = await getModuleSettings<Record<string, unknown>>(spielersuche.SPIELERSUCHE_MODULE_ID);

    // Die Channel-IDs der Altdatenbank gibt es im Mock nicht - sie werden
    // deshalb nicht übernommen. Die Ablaufzeit dagegen schon.
    expect(settings.searchChannelId).toBe('700000000000000003');
    expect(settings.expiryHours).toBe(12);
    expect(settings.accentColor).toBe('#AFDBF5');
  });

  it('lehnt einen zweiten Durchlauf desselben Imports ab', async () => {
    const analysis = await spielersuche.analyseLegacyImport(
      await realisticDatabase(),
      'matchmaking.db',
      ACTOR,
      { sourceGuildId: GUILD },
    );
    await spielersuche.executeLegacyImport(analysis.importRecord.id, ACTOR, {
      legacyBotStopped: true,
      gateway,
    });

    await expect(
      spielersuche.executeLegacyImport(analysis.importRecord.id, ACTOR, {
        legacyBotStopped: true,
        gateway,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('protokolliert Analyse und Übernahme im Audit Log', async () => {
    await analyseAndImport();

    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('SPIELERSUCHE_IMPORT_STARTED');
    expect(actions).toContain('SPIELERSUCHE_IMPORT_CONFIRMED');
    expect(actions).toContain('SPIELERSUCHE_IMPORT_COMPLETED');
  });
});

describeWithDatabase('Banner-Adressen', () => {
  it('kürzt Discord-Anhänge auf die dauerhafte CDN-Adresse', () => {
    // `media.discordapp.net`-Links tragen Ablaufzeitpunkt und Signatur - nach
    // ein paar Stunden wären sie tot.
    expect(
      spielersuche.normalizeBannerUrl(
        'https://media.discordapp.net/attachments/1/2/banner.png?ex=6a627803&is=6a612683&hm=abc&format=webp',
      ),
    ).toBe('https://cdn.discordapp.com/attachments/1/2/banner.png');
  });

  it('lässt gewöhnliche https-Adressen unverändert', () => {
    expect(spielersuche.normalizeBannerUrl('https://i.imgur.com/oaQ5e2N.png')).toBe(
      'https://i.imgur.com/oaQ5e2N.png',
    );
  });

  it('weist alles ausser https zurück', () => {
    expect(spielersuche.normalizeBannerUrl('http://example.com/a.png')).toBeNull();
    expect(spielersuche.normalizeBannerUrl('javascript:alert(1)')).toBeNull();
    expect(spielersuche.normalizeBannerUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(spielersuche.normalizeBannerUrl('file:///etc/passwd')).toBeNull();
    expect(spielersuche.normalizeBannerUrl('kein-link')).toBeNull();
    expect(spielersuche.normalizeBannerUrl(null)).toBeNull();
  });
});
