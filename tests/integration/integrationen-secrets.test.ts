import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_integrationen');

/**
 * Der Speicher der Zugangsdaten.
 *
 * Diese Datei stellt die Zusagen auf die Probe, die man einer solchen
 * Verwaltung abnehmen muss:
 *
 *  - In der Datenbank steht kein Klartext. Nicht in der Spalte für den Wert,
 *    nicht im Hinweis, in keiner Spalte irgendeiner Zeile.
 *  - Was für die Anzeige herausgegeben wird, enthält keinen Wert.
 *  - Die Datenbank gewinnt gegen die Umgebung, sobald dort etwas steht.
 *  - Nach einer Änderung liest der nächste Zugriff den neuen Wert - auch
 *    wenn kurz zuvor der alte im Cache lag.
 *  - Die Übernahme aus der Umgebung überschreibt nichts stillschweigend.
 */
const KEY = Buffer.alloc(32, 7).toString('base64');
process.env.MASTER_ENCRYPTION_KEY = KEY;

const { prisma } = await import('@swisshub/database');
const secrets = await import('@swisshub/secrets');

const BOT_TOKEN = 'kein-echtes-token-nur-ein-testwert-3X7A';
const AI_KEY = 'kein-echter-schluessel-nur-ein-testwert-9F2K';

const UMGEBUNG: string[] = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PAYMENT_API_KEY',
  'PAYMENT_WEBHOOK_SECRET',
  'PAYMENT_PROVIDER',
  'MUSIC_RUNTIME_URL',
  'MUSIC_RUNTIME_KEY',
];

const gesichert = new Map<string, string | undefined>();

/** Alle Zellen aller Tabellen als eine Zeichenkette - für die Klartextsuche. */
async function alleZellen(): Promise<string> {
  const zeilen = await prisma.integrationSecret.findMany();
  const bots = await prisma.integrationBot.findMany();
  const config = await prisma.systemConfig.findMany();
  return JSON.stringify({ zeilen, bots, config });
}

describeWithDatabase('Integrationen: Zugangsdaten', () => {
  beforeAll(() => {
    pushSchema();
    for (const name of UMGEBUNG) {
      gesichert.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterAll(() => {
    for (const [name, wert] of gesichert) {
      if (wert === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = wert;
      }
    }
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "IntegrationSecret","IntegrationBot","IntegrationStatus","SystemConfig","ConfigRevision","AuditLog" RESTART IDENTITY CASCADE',
    );
    secrets.dropSecretCache();
    for (const name of UMGEBUNG) {
      delete process.env[name];
    }
    process.env.MASTER_ENCRYPTION_KEY = KEY;
  });

  // --- Speichern und Lesen ------------------------------------------------

  it('speichert einen Wert und liefert ihn unverändert zurück', async () => {
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    expect(await secrets.getSecret('discord', 'botToken')).toBe(BOT_TOKEN);
  });

  it('legt in der Datenbank keinen Klartext ab', async () => {
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    await secrets.setSecret('ai', 'apiKey', AI_KEY, { actorDiscordId: '1' });

    const inhalt = await alleZellen();
    expect(inhalt).not.toContain(BOT_TOKEN);
    expect(inhalt).not.toContain(AI_KEY);
    // Auch kein Anfangsstück - der Hinweis darf nur das Ende zeigen.
    expect(inhalt).not.toContain(BOT_TOKEN.slice(0, 20));
    expect(inhalt).not.toContain(AI_KEY.slice(0, 20));
  });

  it('gibt für die Anzeige nur die Maske heraus', async () => {
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    const felder = await secrets.describe('discord');
    const token = felder.find((feld) => feld.key === 'botToken');

    expect(token?.configured).toBe(true);
    expect(token?.origin).toBe('database');
    expect(token?.display).not.toContain(BOT_TOKEN);
    expect(token?.display).toContain(BOT_TOKEN.slice(-4));
    // Der Vollständigkeit halber: nirgendwo im ganzen Auskunftsobjekt.
    expect(JSON.stringify(felder)).not.toContain(BOT_TOKEN);
  });

  it('zeigt eine Client ID im Klartext - sie ist kein Geheimnis', async () => {
    await secrets.setSecret('discord', 'clientId', '123456789012345678', { actorDiscordId: '1' });
    const felder = await secrets.describe('discord');
    const clientId = felder.find((feld) => feld.key === 'clientId');
    expect(clientId?.display).toBe('123456789012345678');
    expect(clientId?.secret).toBe(false);
  });

  it('ersetzt einen Wert und zählt die Fassung hoch, ohne den alten zu behalten', async () => {
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    await secrets.setSecret('discord', 'botToken', 'kein-echtes-token-zweiter-testwert-0001', {
      actorDiscordId: '2',
    });

    const zeilen = await prisma.integrationSecret.findMany({ where: { provider: 'discord' } });
    // Genau eine Zeile - kein Verlauf alter Tokens (§52).
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.version).toBe(2);
    expect(zeilen[0]?.updatedBy).toBe('2');
    expect(await alleZellen()).not.toContain(BOT_TOKEN);
    expect(await secrets.getSecret('discord', 'botToken')).toContain('zweiter-testwert');
  });

  it('entfernt einen Wert vollständig', async () => {
    await secrets.setSecret('ai', 'apiKey', AI_KEY, { actorDiscordId: '1' });
    expect(await secrets.hasSecret('ai', 'apiKey')).toBe(true);

    expect(await secrets.deleteSecret('ai', 'apiKey', { actorDiscordId: '1' })).toBe(true);
    expect(await secrets.hasSecret('ai', 'apiKey')).toBe(false);
    expect(await secrets.getSecret('ai', 'apiKey')).toBeNull();
    expect(await prisma.integrationSecret.count({ where: { provider: 'ai' } })).toBe(0);
  });

  // --- Rangfolge Datenbank / Umgebung -------------------------------------

  it('nimmt die Umgebung, solange in der Datenbank nichts steht', async () => {
    process.env.DISCORD_BOT_TOKEN = 'kein-echtes-token-aus-der-umgebung-0002';
    expect(await secrets.getSecret('discord', 'botToken')).toBe('kein-echtes-token-aus-der-umgebung-0002');

    const felder = await secrets.describe('discord');
    expect(felder.find((feld) => feld.key === 'botToken')?.origin).toBe('environment');
  });

  it('lässt die Datenbank gegen die Umgebung gewinnen', async () => {
    process.env.DISCORD_BOT_TOKEN = 'kein-echtes-token-aus-der-umgebung-0002';
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });

    expect(await secrets.getSecret('discord', 'botToken')).toBe(BOT_TOKEN);

    const felder = await secrets.describe('discord');
    const token = felder.find((feld) => feld.key === 'botToken');
    expect(token?.origin).toBe('database');
    // Der Hinweis, dass der Wert auch noch in der Umgebung steht (§43).
    expect(token?.alsoInEnvironment).toBe(true);
  });

  it('sucht den AI-Schlüssel je nach Anbieter in der richtigen Variablen', async () => {
    process.env.OPENAI_API_KEY = 'kein-echter-openai-schluessel-testwert';
    expect(await secrets.getSecret('ai', 'apiKey', { provider: 'openai' })).toBe(
      'kein-echter-openai-schluessel-testwert',
    );
    // Fuer Anthropic gilt diese Variable nicht.
    expect(await secrets.getSecret('ai', 'apiKey', { provider: 'anthropic' })).toBeNull();
  });

  // --- Cache ---------------------------------------------------------------

  it('liefert nach einer Änderung sofort den neuen Wert', async () => {
    await secrets.setSecret('ai', 'apiKey', AI_KEY, { actorDiscordId: '1' });
    // Einmal lesen, damit der Wert im Cache liegt.
    expect(await secrets.getSecret('ai', 'apiKey')).toBe(AI_KEY);

    await secrets.setSecret('ai', 'apiKey', 'kein-echter-schluessel-der-zweite-0000', {
      actorDiscordId: '1',
    });
    // Ohne Invalidierung käme hier der erste Schlüssel zurück, und ein
    // gewechselter Schlüssel wirkte erst nach einem Neustart (§30).
    expect(await secrets.getSecret('ai', 'apiKey')).toBe('kein-echter-schluessel-der-zweite-0000');
  });

  it('bemerkt eine Änderung eines anderen Prozesses über die Revision', async () => {
    await secrets.setSecret('ai', 'apiKey', AI_KEY, { actorDiscordId: '1' });
    await secrets.refreshIntegrationRuntime({ force: true });

    // Ein anderer Prozess schreibt: die Revision steigt.
    await secrets.setSecret('ai', 'apiKey', 'kein-echter-schluessel-von-woanders-1234', { actorDiscordId: '9' });

    expect(await secrets.refreshIntegrationRuntimeIfChanged()).toBe(true);
    // Und beim naechsten Blick hat sich nichts mehr geaendert.
    expect(await secrets.refreshIntegrationRuntimeIfChanged()).toBe(false);
  });

  it('füllt die synchrone Ablage der Konfiguration', async () => {
    const { discordConfig, runtimeConfigValue } = await import('@swisshub/config');
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    await secrets.refreshIntegrationRuntime({ force: true });

    expect(runtimeConfigValue('discord.botToken')).toBe(BOT_TOKEN);
    // Und damit sieht jede bestehende Aufrufstelle den neuen Wert, ohne
    // umgebaut worden zu sein.
    expect(discordConfig.botToken).toBe(BOT_TOKEN);
  });

  // --- Übernahme aus der Umgebung -----------------------------------------

  it('findet Kandidaten in der Umgebung, ohne ihre Werte zu nennen', async () => {
    process.env.DISCORD_BOT_TOKEN = BOT_TOKEN;
    process.env.ANTHROPIC_API_KEY = AI_KEY;

    const kandidaten = await secrets.listEnvCandidates();
    const namen = kandidaten.map((kandidat) => `${kandidat.integrationId}.${kandidat.key}`);
    expect(namen).toContain('discord.botToken');
    expect(namen).toContain('ai.apiKey');

    // Diese Liste geht an den Browser (§41).
    const alsJson = JSON.stringify(kandidaten);
    expect(alsJson).not.toContain(BOT_TOKEN);
    expect(alsJson).not.toContain(AI_KEY);
    expect(alsJson).toContain('DISCORD_BOT_TOKEN');
  });

  it('übernimmt einen Wert aus der Umgebung verschlüsselt', async () => {
    process.env.DISCORD_BOT_TOKEN = BOT_TOKEN;

    const ergebnis = await secrets.importFromEnvironment(
      [{ integrationId: 'discord', key: 'botToken' }],
      { actorDiscordId: '1' },
    );
    expect(ergebnis.uebernommen).toEqual(['discord.botToken']);
    expect(await secrets.getSecret('discord', 'botToken')).toBe(BOT_TOKEN);
    expect(await alleZellen()).not.toContain(BOT_TOKEN);
  });

  it('überschreibt bei der Übernahme nichts ohne ausdrückliche Ansage', async () => {
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    process.env.DISCORD_BOT_TOKEN = 'kein-echtes-token-aus-der-umgebung-0002';

    const ohne = await secrets.importFromEnvironment(
      [{ integrationId: 'discord', key: 'botToken' }],
      { actorDiscordId: '1' },
    );
    expect(ohne.uebersprungen).toEqual(['discord.botToken']);
    expect(await secrets.getSecret('discord', 'botToken')).toBe(BOT_TOKEN);

    const mit = await secrets.importFromEnvironment(
      [{ integrationId: 'discord', key: 'botToken' }],
      { actorDiscordId: '1', ueberschreiben: true },
    );
    expect(mit.uebernommen).toEqual(['discord.botToken']);
    expect(await secrets.getSecret('discord', 'botToken')).toBe('kein-echtes-token-aus-der-umgebung-0002');
  });

  it('bleibt bei mehrfacher Übernahme unverändert', async () => {
    process.env.ANTHROPIC_API_KEY = AI_KEY;
    const felder = [{ integrationId: 'ai', key: 'apiKey' }];

    await secrets.importFromEnvironment(felder, { actorDiscordId: '1' });
    await secrets.importFromEnvironment(felder, { actorDiscordId: '1' });
    await secrets.importFromEnvironment(felder, { actorDiscordId: '1' });

    expect(await prisma.integrationSecret.count({ where: { provider: 'ai' } })).toBe(1);
    // Nicht dreimal überschrieben - die zweite und dritte Übernahme haben
    // erkannt, dass bereits etwas dasteht (§42).
    const zeile = await prisma.integrationSecret.findFirstOrThrow({ where: { provider: 'ai' } });
    expect(zeile.version).toBe(1);
  });

  it('nennt nach der Übernahme, was aus der Umgebung verschwinden kann', async () => {
    process.env.DISCORD_BOT_TOKEN = BOT_TOKEN;
    await secrets.importFromEnvironment([{ integrationId: 'discord', key: 'botToken' }], {
      actorDiscordId: '1',
    });

    const entfernbar = await secrets.removableEnvKeys();
    expect(entfernbar.map((eintrag) => eintrag.envKey)).toContain('DISCORD_BOT_TOKEN');
  });

  // --- Ohne Hauptschlüssel -------------------------------------------------

  it('speichert ohne Hauptschlüssel nichts, statt im Klartext abzulegen', async () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    await expect(secrets.setSecret('ai', 'apiKey', AI_KEY, { actorDiscordId: '1' })).rejects.toThrow();
    expect(await prisma.integrationSecret.count()).toBe(0);
    process.env.MASTER_ENCRYPTION_KEY = KEY;
  });

  // --- Startprüfung --------------------------------------------------------

  it('meldet fehlende Pflichtangaben, ohne die Anwendung anzuhalten', async () => {
    const bericht = await secrets.checkIntegrations();
    const discord = bericht.eintraege.find((eintrag) => eintrag.integrationId === 'discord');
    expect(discord?.vollstaendig).toBe(false);
    expect(discord?.fehlend).toContain('Bot Token');
    expect(bericht.blockiert).toBe(true);

    // Die AI ist optional - ihr Fehlen darf nichts blockieren (§44).
    const aiEintrag = bericht.eintraege.find((eintrag) => eintrag.integrationId === 'ai');
    expect(aiEintrag?.essential).toBe(false);
  });

  it('gilt als vollständig, sobald die Pflichtangaben vorliegen', async () => {
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    await secrets.setSecret('discord', 'clientId', '123456789012345678', { actorDiscordId: '1' });
    await secrets.setSecret('discord', 'clientSecret', 'ein-client-secret', { actorDiscordId: '1' });

    const bericht = await secrets.checkIntegrations();
    expect(bericht.blockiert).toBe(false);
  });
});

describe('Logger-Schwärzung', () => {
  it('entfernt ein zur Laufzeit geladenes Geheimnis aus jeder Logzeile', async () => {
    const { redactString, registerRuntimeSecret, clearRuntimeSecrets } = await import(
      '@swisshub/logger'
    );
    clearRuntimeSecrets();

    // Vor der Anmeldung steht es noch drin - das ist genau die Lücke, die
    // entstand, als die Tokens aus der Umgebung in die Datenbank wanderten.
    expect(redactString(`Fehler: ${BOT_TOKEN}`)).toContain(BOT_TOKEN);

    registerRuntimeSecret(BOT_TOKEN);
    const zeile = redactString(`Discord meldet: Invalid token ${BOT_TOKEN} bei /users/@me`);
    expect(zeile).not.toContain(BOT_TOKEN);
    expect(zeile).toContain('[redacted]');

    clearRuntimeSecrets();
  });
});

describeWithDatabase('Integrationen: Bots', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "IntegrationSecret","IntegrationBot","IntegrationStatus","SystemConfig","ConfigRevision","AuditLog" RESTART IDENTITY CASCADE',
    );
    secrets.dropSecretCache();
    for (const name of UMGEBUNG) {
      delete process.env[name];
    }
    process.env.MASTER_ENCRYPTION_KEY = KEY;
  });

  it('gibt dem Systembot das Token der Anwendung', async () => {
    // Der Kern der Umstellung: der Musik-Controller ist der Systembot, und
    // sein Token ist das der SwissHub-Anwendung. Ein eigenes Feld dafür gäbe
    // es zweimal - und beim nächsten Wechsel wäre eine Fassung veraltet.
    const bot = await secrets.ensureSystemBot();
    expect(bot.kind).toBe('SYSTEM');
    expect(bot.hasToken).toBe(false);

    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });

    expect(await secrets.botToken(bot.id)).toBe(BOT_TOKEN);
    const frisch = await secrets.getBot(bot.id);
    expect(frisch?.hasToken).toBe(true);
  });

  it('legt für den Systembot kein eigenes Geheimnis an', async () => {
    const bot = await secrets.ensureSystemBot();
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });

    // Genau eine Zeile - unter `discord`, nicht unter `bot:<id>`.
    const zeilen = await prisma.integrationSecret.findMany({ select: { provider: true } });
    expect(zeilen.map((zeile) => zeile.provider)).toEqual(['discord']);
    expect(zeilen.map((zeile) => zeile.provider)).not.toContain(`bot:${bot.id}`);
  });

  it('lässt das Token des Systembots hier nicht ersetzen', async () => {
    const bot = await secrets.ensureSystemBot();
    await expect(
      secrets.rotateBotToken(bot.id, 'kein-echtes-token-versuch-0009', '1'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lässt den Systembot nicht entfernen', async () => {
    const bot = await secrets.ensureSystemBot();
    await expect(secrets.deleteBot(bot.id, '1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await prisma.integrationBot.count()).toBe(1);
  });

  it('legt ausschliesslich Worker an', async () => {
    await expect(
      secrets.createBot({ kind: 'MUSIC_CONTROLLER', label: 'Alt', slug: 'ALT' }, '1'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      secrets.createBot({ kind: 'SYSTEM', label: 'Zweiter', slug: 'ZWEI' }, '1'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const worker = await secrets.createBot(
      { kind: 'MUSIC_WORKER', label: 'Music Worker 1', slug: 'WORKER_1' },
      '1',
    );
    expect(worker.kind).toBe('MUSIC_WORKER');
    expect(worker.hasToken).toBe(false);
  });

  it('hält das Token eines Workers getrennt vom Systembot', async () => {
    const system = await secrets.ensureSystemBot();
    await secrets.setSecret('discord', 'botToken', BOT_TOKEN, { actorDiscordId: '1' });
    const worker = await secrets.createBot(
      { kind: 'MUSIC_WORKER', label: 'Music Worker 1', slug: 'WORKER_1' },
      '1',
    );
    await secrets.setSecret(
      `bot:${worker.id}`,
      'token',
      'kein-echtes-token-worker-eins-0004',
      { actorDiscordId: '1' },
    );

    // Jeder bekommt seinen eigenen Wert - ein Austausch beim einen rührt den
    // anderen nicht an.
    expect(await secrets.botToken(system.id)).toBe(BOT_TOKEN);
    expect(await secrets.botToken(worker.id)).toBe('kein-echtes-token-worker-eins-0004');
    expect(await alleZellen()).not.toContain(BOT_TOKEN);
    expect(await alleZellen()).not.toContain('kein-echtes-token-worker-eins-0004');
  });
});
