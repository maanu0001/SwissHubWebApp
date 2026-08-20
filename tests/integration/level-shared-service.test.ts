import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, TEST_DATABASE_URL, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
// Muss vor dem Import des Prisma Clients passieren.
useTestSchema('test_level_shared');

/**
 * Eine XP-Engine für Discord und Dashboard.
 *
 * Der Nachweis läuft über Wirkungen, die es nur einmal geben kann:
 *
 *   - dasselbe Journal: was der Slash Command bucht, sieht das Dashboard,
 *   - dieselbe Klemmung auf nicht-negative Stände,
 *   - dieselben Einstellungen: was `/set_xp_boost` ändert, gilt sofort für
 *     die Berechnung im Dashboard,
 *   - dieselben Berechtigungen: ohne Zuordnung im Dashboard lehnt auch der
 *     Slash Command ab.
 *
 * Gäbe es zwei Implementierungen, müsste mindestens eine dieser Zusicherungen
 * scheitern.
 */
const { prisma } = await import('@swisshub/database');
const { level, setModuleSettings, setModuleEnabled } = await import('@swisshub/modules');
const { handleLevelCommand } = await import('../../apps/bot/src/commands/level-commands');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

const MOD_ROLE = '900000000000000003';
const ALICE = { discordId: '100000000000000001', username: 'alice' };
const BOB = { discordId: '100000000000000002', username: 'bob' };

interface FakeReply {
  content?: string;
  embeds?: unknown[];
}

/** Minimale Nachbildung einer Discord-Interaktion. */
function interaction(
  commandName: string,
  options: Record<string, string | number | { id: string; username: string; bot?: boolean }> = {},
): { interaction: Record<string, unknown>; replies: FakeReply[] } {
  const replies: FakeReply[] = [];
  return {
    replies,
    interaction: {
      commandName,
      user: { id: ALICE.discordId, username: ALICE.username, avatar: null },
      member: { roles: { cache: new Map([[MOD_ROLE, {}]]) } },
      guild: null,
      guildId: null,
      channelId: '700000000000000001',
      inGuild: () => true,
      isChatInputCommand: () => true,
      deferred: false,
      replied: false,
      deferReply: async () => {
        (replies as unknown as { deferred?: boolean }).deferred = true;
        return undefined;
      },
      reply: async (payload: FakeReply) => {
        replies.push(payload);
      },
      editReply: async (payload: FakeReply) => {
        replies.push(payload);
        return payload;
      },
      options: {
        getSubcommand: () => null,
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
        getNumber: (name: string) => {
          const value = options[name];
          return typeof value === 'number' ? value : null;
        },
        getChannel: (name: string) => {
          const value = options[name];
          return typeof value === 'object' ? value : null;
        },
      },
    },
  };
}

async function runCommand(
  commandName: string,
  options: Record<string, string | number | { id: string; username: string }> = {},
): Promise<string> {
  const { interaction: fake, replies } = interaction(commandName, options);
  await handleLevelCommand(fake as never);
  const last = replies.at(-1);
  return String(last?.content ?? JSON.stringify(last?.embeds ?? ''));
}

async function grantPermissions(keys: string[]): Promise<void> {
  await prisma.managedRole.upsert({
    where: { discordRoleId: MOD_ROLE },
    create: { discordRoleId: MOD_ROLE, label: 'Level-Team', moderationLevel: 50 },
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
      "XpTransaction", "LevelGameStats", "LevelGameMatch", "LevelMilestoneRole",
      "LevelProfile", "RolePermission", "ManagedRole", "AuditLog",
      "IdempotencyRecord", "ModuleState"
    RESTART IDENTITY CASCADE
  `);
  // Die Einstellungen prüfen gewählte Channels gegen den Discord-Abgleich.
  // Ohne diesen Eintrag wäre der Test nicht aussagekräftig, sondern würde
  // an einer fehlenden Voraussetzung scheitern.
  await prisma.discordChannelCache.upsert({
    where: { channelId: '700000000000000001' },
    create: { channelId: '700000000000000001', name: 'allgemein', type: 0 },
    update: { deletedAt: null },
  });
  await setModuleEnabled(level.LEVEL_MODULE_ID, true, 'test');
  await setModuleSettings(level.LEVEL_MODULE_ID, { decayEnabled: false }, 'test');
  invalidateRoleConfiguration();
}

beforeAll(() => {
  if (TEST_DATABASE_URL) {
    pushSchema();
  }
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describeWithDatabase('Slash Command und Dashboard teilen sich dieselbe XP-Engine', () => {
  beforeEach(async () => {
    await reset();
    await grantPermissions([
      level.LEVEL_PERMISSIONS.membersManage,
      level.LEVEL_PERMISSIONS.rulesManage,
      level.LEVEL_PERMISSIONS.settingsView,
    ]);
  });

  it('schreibt XP aus dem Slash Command in dasselbe Journal', async () => {
    await runCommand('give_xp', { user: { id: BOB.discordId, username: BOB.username }, azahl: 1000 });

    // Was das Dashboard liest, stammt aus derselben Tabelle.
    const stats = await level.getMemberStats(BOB.discordId);
    expect(stats?.xp).toBe(1000);
    expect(stats?.level).toBe(3);

    const booked = await prisma.xpTransaction.findMany({ where: { discordId: BOB.discordId } });
    expect(booked).toHaveLength(1);
    expect(booked[0]!.source).toBe('ADMIN');
    expect(booked[0]!.actorDiscordId).toBe(ALICE.discordId);
  });

  it('rechnet Dashboard-Buchung und Slash Command auf demselben Stand weiter', async () => {
    await level.adjustXp(
      { discordId: ALICE.discordId, username: ALICE.username },
      { target: { discordId: BOB.discordId }, amount: 500 },
    );
    await runCommand('give_xp', { user: { id: BOB.discordId, username: BOB.username }, azahl: 500 });

    const profile = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: BOB.discordId } });
    expect(profile.xp).toBe(1000);
    expect(await prisma.xpTransaction.count({ where: { discordId: BOB.discordId } })).toBe(2);
  });

  it('klemmt auch über den Slash Command auf null', async () => {
    await level.adjustXp(
      { discordId: ALICE.discordId, username: ALICE.username },
      { target: { discordId: BOB.discordId }, amount: 100 },
    );
    const message = await runCommand('rem_xp', {
      user: { id: BOB.discordId, username: BOB.username },
      azahl: 5000,
    });

    expect(message).toContain('0 XP');
    const profile = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: BOB.discordId } });
    expect(profile.xp).toBe(0);
  });

  it('lässt eine Einstellung aus dem Slash Command sofort im Dashboard gelten', async () => {
    await runCommand('set_xp_boost', { wert: 3 });

    const settings = await level.loadLevelContext();
    expect(settings.settings.xpBoost).toBe(3);

    // Und die Engine rechnet damit: 10 XP pro Nachricht mal Faktor 3.
    const decision = level.decideMessageXp(
      { channelId: '700000000000000001', roleIds: [], secondsSinceLastXp: null },
      settings.settings,
    );
    expect(decision.amount).toBe(30);
  });

  it('lässt eine Einstellung aus dem Dashboard sofort für den Slash Command gelten', async () => {
    await level.updateLevelSettings(
      { discordId: ALICE.discordId, username: ALICE.username },
      { noXpChannelIds: ['700000000000000001'] },
    );

    const message = await runCommand('list_noxp_channel');
    expect(message).toContain('700000000000000001');
  });

  it('verweigert den Slash Command ohne die Dashboard-Berechtigung', async () => {
    await grantPermissions([]);

    const message = await runCommand('give_xp', {
      user: { id: BOB.discordId, username: BOB.username },
      azahl: 100,
    });

    expect(message).toContain('kei Berächtigung');
    expect(await prisma.levelProfile.count({ where: { discordId: BOB.discordId } })).toBe(0);
  });

  it('protokolliert eine Handbuchung im gemeinsamen Audit-Log', async () => {
    await runCommand('give_xp', { user: { id: BOB.discordId, username: BOB.username }, azahl: 250 });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'LEVEL_XP_GRANTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.targetDiscordId).toBe(BOB.discordId);
    expect(audit!.actorDiscordId).toBe(ALICE.discordId);
  });

  it('antwortet gar nicht, solange das Modul ausgeschaltet ist', async () => {
    await setModuleEnabled(level.LEVEL_MODULE_ID, false, 'test');

    const message = await runCommand('give_xp', {
      user: { id: BOB.discordId, username: BOB.username },
      azahl: 100,
    });

    expect(message).toContain('usgschalte');
    expect(await prisma.levelProfile.count()).toBe(0);
  });
});
