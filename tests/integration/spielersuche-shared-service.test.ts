import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, TEST_DATABASE_URL, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
// Muss vor dem Import des Prisma Clients passieren.
useTestSchema('test_spielersuche_shared');

/**
 * Eine Spielersuche-Engine für Discord und Dashboard.
 *
 * Der Nachweis läuft über beobachtbare Wirkungen, die es nur einmal gibt:
 *
 *   - dasselbe Limit offener Suchen - der eine Weg blockiert den anderen,
 *   - dieselben Teilnehmer- und Statistikzeilen,
 *   - dasselbe Embed und derselbe Sprachkanal,
 *   - dieselbe Beendigung: was der eine startet, beendet der andere.
 *
 * Gäbe es zwei Implementierungen, müsste mindestens eine dieser Zusicherungen
 * scheitern.
 */
const { prisma } = await import('@swisshub/database');
const { spielersuche, setModuleSettings } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');
const { handleSpielersucheCommand } = await import('../../apps/bot/src/commands/spielersuche-commands');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

const SEARCH_CHANNEL = '700000000000000003';
const VOICE_CATEGORY = '700000000000000010';
const ROLE_CS2 = '900000000000000001';
const MOD_ROLE = '900000000000000003';

const ALICE = { discordId: '100000000000000001', username: 'alice' };
const BOB = { discordId: '100000000000000002', username: 'bob' };

let gateway: ReturnType<typeof createMockGateway>;

/** Minimale Nachbildung einer Discord-Interaktion. */
function interaction(
  commandName: string,
  options: Record<string, string | number | { id: string }> = {},
  subcommand?: string,
): { interaction: Record<string, unknown>; replies: Array<Record<string, unknown>> } {
  const replies: Array<Record<string, unknown>> = [];
  return {
    replies,
    interaction: {
      commandName,
      user: { id: ALICE.discordId, username: ALICE.username, avatar: null },
      member: { roles: { cache: new Map([[MOD_ROLE, {}]]) } },
      inGuild: () => true,
      isChatInputCommand: () => true,
      deferred: true,
      replied: false,
      deferReply: async () => undefined,
      reply: async (payload: Record<string, unknown>) => {
        replies.push(payload);
      },
      editReply: async (payload: Record<string, unknown>) => {
        replies.push(payload);
        return payload;
      },
      options: {
        getSubcommand: () => subcommand ?? null,
        getUser: (name: string) => {
          const value = options[name];
          return typeof value === 'object' ? value : null;
        },
        getString: (name: string) => {
          const value = options[name];
          return typeof value === 'string' ? value : null;
        },
        getInteger: (name: string) => {
          const value = options[name];
          return typeof value === 'number' ? value : null;
        },
      },
    },
  };
}

async function runCommand(
  commandName: string,
  options: Record<string, string | number | { id: string }> = {},
  subcommand?: string,
): Promise<string> {
  const { interaction: fake, replies } = interaction(commandName, options, subcommand);
  await handleSpielersucheCommand(fake as never);
  const last = replies.at(-1);
  return String(last?.content ?? JSON.stringify(last?.embeds ?? ''));
}

async function configure(overrides: Record<string, unknown> = {}): Promise<void> {
  await setModuleSettings(
    spielersuche.SPIELERSUCHE_MODULE_ID,
    {
      searchChannelId: SEARCH_CHANNEL,
      voiceCategoryId: VOICE_CATEGORY,
      maxActiveSearchesPerUser: 1,
      rolePingCooldownMinutes: 5,
      ...overrides,
    },
    'test',
  );
}

async function grantPermissions(keys: string[]): Promise<void> {
  await prisma.managedRole.upsert({
    where: { discordRoleId: MOD_ROLE },
    create: { discordRoleId: MOD_ROLE, label: 'Moderation', moderationLevel: 50 },
    update: {},
  });
  await prisma.rolePermission.deleteMany({ where: { discordRoleId: MOD_ROLE } });
  await prisma.rolePermission.createMany({
    data: keys.map((permission) => ({ discordRoleId: MOD_ROLE, permission })),
  });
  invalidateRoleConfiguration();
}

async function reset(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SpielersucheVoiceSession", "SpielersucheParticipant", "SpielersucheRolePing",
      "SpielersucheUsage", "SpielersucheMatch", "SpielersucheGame",
      "RolePermission", "ManagedRole", "AuditLog", "IdempotencyRecord", "ModuleState"
    RESTART IDENTITY CASCADE
  `);
}

beforeAll(() => {
  if (TEST_DATABASE_URL) {
    pushSchema();
  }
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describeWithDatabase('Slash Command und Dashboard teilen sich denselben Dienst', () => {
  let gameId: string;

  beforeEach(async () => {
    await reset();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
    await grantPermissions([
      spielersuche.SPIELERSUCHE_PERMISSIONS.create,
      spielersuche.SPIELERSUCHE_PERMISSIONS.view,
      spielersuche.SPIELERSUCHE_PERMISSIONS.join,
      spielersuche.SPIELERSUCHE_PERMISSIONS.closeOwn,
      spielersuche.SPIELERSUCHE_PERMISSIONS.gamesView,
      spielersuche.SPIELERSUCHE_PERMISSIONS.statsViewOwn,
    ]);
    const game = await spielersuche.createGame(
      { name: 'CS2', roleId: ROLE_CS2, bannerUrl: null, maxSquadSize: 5, enabled: true },
      ALICE,
    );
    gameId = game.id;
  });

  it('erzeugt über /spielersuche einen ganz gewöhnlichen Datensatz', async () => {
    const reply = await runCommand('spielersuche', {
      spiel: gameId,
      'gsuechti-spieler': 3,
      kommentar: 'Premier',
    });

    expect(reply).toContain('veröffentlicht');

    const match = await prisma.spielersucheMatch.findFirstOrThrow();
    expect(match.creatorDiscordId).toBe(ALICE.discordId);
    expect(match.requestedPlayers).toBe(3);
    expect(match.comment).toBe('Premier');
    // Einziger Unterschied zum Dashboard: die vermerkte Herkunft.
    expect(match.source).toBe('SLASH_COMMAND');
    expect(match.messageId).not.toBeNull();
    expect(match.voiceChannelId).not.toBeNull();

    // Derselbe Teilnehmer-Datensatz, dieselbe Statistikzeile.
    expect(await prisma.spielersucheParticipant.count({ where: { matchId: match.id } })).toBe(1);
    expect(await prisma.spielersucheUsage.count({ where: { discordId: ALICE.discordId } })).toBe(1);

    const audits = await prisma.auditLog.findMany({ select: { action: true } });
    expect(audits.map((entry) => entry.action)).toContain('SPIELERSUCHE_CREATED');
  });

  it('blockiert den Slash Command, wenn das Dashboard bereits eine Suche geöffnet hat', async () => {
    await spielersuche.createSearch(
      {
        gameId,
        requestedPlayers: 2,
        comment: null,
        idempotencyKey: crypto.randomUUID(),
        source: 'DASHBOARD',
      },
      ALICE,
      { gateway },
    );

    const reply = await runCommand('spielersuche', { spiel: gameId, 'gsuechti-spieler': 2 });

    // Dasselbe Limit, dieselbe Meldung - es gibt nur eine Wahrheit.
    expect(reply).toContain('bereits e Suechi aktiv');
    expect(await prisma.spielersucheMatch.count()).toBe(1);
  });

  it('beendet über /spielersucheadmin close, was das Dashboard gestartet hat', async () => {
    const created = await spielersuche.createSearch(
      {
        gameId,
        requestedPlayers: 2,
        comment: null,
        idempotencyKey: crypto.randomUUID(),
        source: 'DASHBOARD',
      },
      ALICE,
      { gateway },
    );

    const reply = await runCommand('spielersucheadmin', {}, 'close');

    expect(reply).toContain('beendet');
    const match = await prisma.spielersucheMatch.findUniqueOrThrow({ where: { id: created.match.id } });
    expect(match.status).toBe('CLOSED');
    expect(match.activeCreatorKey).toBeNull();
  });

  it('zeigt im Slash Command dieselben Spiele wie das Dashboard', async () => {
    await spielersuche.createGame(
      { name: 'Valorant', roleId: ROLE_CS2, bannerUrl: null, maxSquadSize: 5, enabled: true },
      ALICE,
    );

    const reply = await runCommand('spielersucheadmin', {}, 'games');
    const dashboard = await spielersuche.listGames({ includeDisabled: true });

    expect(dashboard).toHaveLength(2);
    expect(reply).toContain('CS2');
    expect(reply).toContain('Valorant');
  });

  it('meldet dieselbe Statistik wie das Dashboard', async () => {
    await spielersuche.createSearch(
      {
        gameId,
        requestedPlayers: 2,
        comment: null,
        idempotencyKey: crypto.randomUUID(),
        source: 'DASHBOARD',
      },
      ALICE,
      { gateway },
    );

    const reply = await runCommand('spielersuche-stats');
    const stats = await spielersuche.getUserStats(ALICE.discordId);

    expect(stats.usageCount).toBe(1);
    expect(reply).toContain('Spielersuechi-Statistik');
  });

  it('verweigert den Befehl ohne Berechtigung - ohne feste Rollen-IDs', async () => {
    // Der alte Bot prüfte auf zwei fest eingetragene Rollen. Hier zählt
    // ausschliesslich die Zuordnung im Dashboard.
    await grantPermissions([]);

    const reply = await runCommand('spielersuche', { spiel: gameId, 'gsuechti-spieler': 2 });

    expect(reply).toContain('kei Berächtigung');
    expect(await prisma.spielersucheMatch.count()).toBe(0);
  });

  it('erkennt sowohl die neuen als auch die alten Button-IDs', async () => {
    // Nachrichten des alten Bots tragen die alten Custom IDs. Ohne
    // Rückwärtskompatibilität wären ihre Knöpfe nach der Umstellung tot.
    expect(spielersuche.parseButtonId('swisshub:spielersuche:join')).toBe('join');
    expect(spielersuche.parseButtonId('swisshub_spielersuche:join')).toBe('join');
    expect(spielersuche.parseButtonId('swisshub_spielersuche:leave')).toBe('leave');
    expect(spielersuche.parseButtonId('swisshub_spielersuche:close')).toBe('close');
    expect(spielersuche.parseButtonId('swisshub_spielersuche:help')).toBe('help');
    expect(spielersuche.parseButtonId('etwas:anderes')).toBeNull();
  });

  it('findet die Suche zu einer Discord-Nachricht - Grundlage der Knöpfe', async () => {
    const created = await spielersuche.createSearch(
      {
        gameId,
        requestedPlayers: 2,
        comment: null,
        idempotencyKey: crypto.randomUUID(),
        source: 'DASHBOARD',
      },
      ALICE,
      { gateway },
    );

    const found = await spielersuche.getSearchByMessage(created.match.messageId as string);
    expect(found?.id).toBe(created.match.id);

    // Der Knopf-Weg landet in derselben Funktion wie das Dashboard.
    const outcome = await spielersuche.joinSearch(found!.id, BOB, { gateway });
    expect(outcome.result).toBe('joined');
  });
});
