import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Integrationstests der Dashboard-Konfiguration.
 *
 * Abgedeckt sind die Punkte, an denen ein Fehler den Betrieb lahmlegen würde:
 * Guild-Verbindung, Discord-Sync (inklusive gelöschter Rollen), Validierung
 * der Moduleinstellungen gegen den echten Discord-Zustand und der
 * Aussperrschutz der Berechtigungsverwaltung.
 */
const fake = vi.hoisted(() => ({ state: null as unknown, module: null as unknown }));

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const modules = await import('@swisshub/modules');
type JailSettings = Awaited<ReturnType<typeof modules.readModuleSettings>> & {
  jailRoleId?: string;
};
const { createMockGateway, setDiscordGateway, clearDiscordCache, clearGuildIdCache } =
  await import('@swisshub/discord');

type State = ReturnType<typeof createFakeState>;

const MOCK_GUILD_ID = '000000000000000000';
const JAIL_ROLE = '900000000000000006';
const BOOSTER_ROLE = '900000000000000007';
const BOT_ROLE = '900000000000000005';
const TEXT_CHANNEL = '700000000000000001';
const VOICE_CHANNEL = '700000000000000004';

let state: State;

beforeEach(() => {
  state = fake.state as State;
  state.roleCache.length = 0;
  state.channelCache.length = 0;
  state.syncRuns.length = 0;
  state.rolePermissions.length = 0;
  state.managedRoles.length = 0;
  state.audits.length = 0;
  state.guildConfig = null;
  state.moduleSettings = {};
  state.moduleEnabled = {};

  setDiscordGateway(createMockGateway());
  clearDiscordCache();
  clearGuildIdCache();
});

describe('Guild-Konfiguration', () => {
  it('verbindet nur Server, auf denen der Bot Mitglied ist', async () => {
    await expect(modules.connectGuild({ guildId: '111111111111111111' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(state.guildConfig).toBeNull();
  });

  it('speichert die verbundene Guild inklusive Namen', async () => {
    const guild = await modules.connectGuild({ guildId: MOCK_GUILD_ID, updatedBy: 'tester' });
    expect(guild.guildId).toBe(MOCK_GUILD_ID);
    expect(state.guildConfig?.guildId).toBe(MOCK_GUILD_ID);
    expect(await modules.isSetupComplete()).toBe(false);
  });

  it('markiert die Einrichtung erst nach dem Abschluss als fertig', async () => {
    await modules.connectGuild({ guildId: MOCK_GUILD_ID });
    await modules.completeSetup('100000000000000001');
    expect(await modules.isSetupComplete()).toBe(true);
    expect(state.guildConfig?.setupCompletedBy).toBe('100000000000000001');
  });

  it('übernimmt eine Guild aus der Umgebung nur einmal', async () => {
    // In der Testumgebung ist DISCORD_GUILD_ID gesetzt (siehe tests/setup.ts).
    expect(await modules.importGuildFromEnvironment()).toBe(true);
    expect(await modules.importGuildFromEnvironment()).toBe(false);
  });
});

describe('Discord-Sync', () => {
  beforeEach(async () => {
    await modules.connectGuild({ guildId: MOCK_GUILD_ID });
  });

  it('spiegelt Rollen und Channels in den Cache', async () => {
    const summary = await modules.syncDiscord({ trigger: 'manual' });

    expect(summary.success).toBe(true);
    expect(summary.roles).toBeGreaterThan(0);
    expect(summary.channels).toBeGreaterThan(0);

    const roles = await modules.listCachedRoles();
    expect(roles.some((role) => role.id === JAIL_ROLE)).toBe(true);
    // Absteigend nach Position - wie in Discord.
    expect(roles[0]?.position).toBeGreaterThanOrEqual(roles[roles.length - 1]?.position ?? 0);
  });

  it('markiert verschwundene Rollen als gelöscht statt sie zu entfernen', async () => {
    await modules.syncDiscord({ trigger: 'manual' });

    // Eine Rolle, die Discord nicht mehr kennt.
    state.roleCache.push({
      roleId: '900000000000000099',
      name: 'Alte Rolle',
      color: 0,
      position: 1,
      managed: false,
      hoist: false,
      permissions: '0',
      syncedAt: new Date(),
      deletedAt: null,
    });

    const summary = await modules.syncDiscord({ trigger: 'manual' });
    expect(summary.removedRoles).toBe(1);

    expect((await modules.listCachedRoles()).some((role) => role.id === '900000000000000099')).toBe(false);
    const withDeleted = await modules.listCachedRoles({ includeDeleted: true });
    expect(withDeleted.find((role) => role.id === '900000000000000099')?.deleted).toBe(true);
  });

  it('filtert Channels nach Art', async () => {
    await modules.syncDiscord({ trigger: 'manual' });
    const text = await modules.listCachedChannels({ kinds: ['text'] });
    expect(text.some((channel) => channel.id === TEXT_CHANNEL)).toBe(true);
    expect(text.some((channel) => channel.id === VOICE_CHANNEL)).toBe(false);
  });

  it('protokolliert jeden Lauf', async () => {
    await modules.syncDiscord({ trigger: 'startup' });
    const status = await modules.getSyncStatus();
    expect(status.lastRun?.trigger).toBe('startup');
    expect(status.lastRun?.success).toBe(true);
    expect(status.lastSyncedAt).not.toBeNull();
  });
});

describe('Validierung der Moduleinstellungen', () => {
  beforeEach(async () => {
    await modules.connectGuild({ guildId: MOCK_GUILD_ID });
    await modules.syncDiscord({ trigger: 'manual' });
  });

  const actor = { discordId: '100000000000000001', username: 'manuel' };

  it('speichert eine gültige Jail-Konfiguration und erhöht die Konfigurationsversion', async () => {
    const before = state.configRevision;
    const result = await modules.writeModuleSettings(
      modules.jail.JAIL_MODULE_ID,
      {
        jailRoleId: JAIL_ROLE,
        maxDurationSeconds: 3600,
        keepRoleIds: [],
        postModerationLog: true,
        notifyInJailChannel: false,
      },
      actor,
    );

    expect(result.warnings).toHaveLength(0);
    expect(state.configRevision).toBeGreaterThan(before);

    const saved = await modules.readModuleSettings<JailSettings>(modules.jail.JAIL_MODULE_ID);
    expect(saved.jailRoleId).toBe(JAIL_ROLE);
  });

  it('lehnt eine Rolle ab, die es auf Discord nicht gibt', async () => {
    await expect(
      modules.writeModuleSettings(
        modules.jail.JAIL_MODULE_ID,
        { jailRoleId: '900000000000000099', maxDurationSeconds: 3600 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lehnt eine von Discord verwaltete Rolle als Jail-Rolle ab', async () => {
    await expect(
      modules.writeModuleSettings(
        modules.jail.JAIL_MODULE_ID,
        { jailRoleId: BOOSTER_ROLE, maxDurationSeconds: 3600 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lehnt einen Channel falscher Art ab', async () => {
    await expect(
      modules.writeModuleSettings(
        modules.jail.JAIL_MODULE_ID,
        { jailRoleId: JAIL_ROLE, jailChannelId: VOICE_CHANNEL, maxDurationSeconds: 3600 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('schreibt Vorher/Nachher ins Audit Log', async () => {
    await modules.writeModuleSettings(
      modules.jail.JAIL_MODULE_ID,
      { jailRoleId: JAIL_ROLE, maxDurationSeconds: 3600 },
      actor,
    );
    await modules.writeModuleSettings(
      modules.jail.JAIL_MODULE_ID,
      { jailRoleId: JAIL_ROLE, maxDurationSeconds: 7200 },
      actor,
    );

    const entry = state.audits.at(-1) as { metadata: { changed: string[] } };
    expect(entry.metadata.changed).toContain('maxDurationSeconds');
  });
});

describe('Bot-Berechtigungen und Hierarchie', () => {
  beforeEach(async () => {
    await modules.connectGuild({ guildId: MOCK_GUILD_ID });
    await modules.syncDiscord({ trigger: 'manual' });
  });

  it('meldet die Bot-Rolle und ihre Position', async () => {
    const report = await modules.inspectBotPermissions();
    expect(report.available).toBe(true);
    expect(report.botHighestPosition).toBeGreaterThan(0);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('markiert Rollen über der Bot-Rolle als nicht verwaltbar', async () => {
    const hierarchy = await modules.getRoleHierarchy(
      new Map([[JAIL_ROLE, ['Jail-Rolle']]]),
      new Set([JAIL_ROLE]),
    );
    const jailRole = hierarchy.entries.find((entry) => entry.id === JAIL_ROLE);
    const botRole = hierarchy.entries.find((entry) => entry.id === BOT_ROLE);

    expect(jailRole?.manageableByBot).toBe(true);
    expect(botRole?.manageableByBot).toBe(false);
    expect(hierarchy.problems).toHaveLength(0);
  });

  it('meldet eine zu vergebende Rolle als Problem, wenn sie zu hoch liegt', async () => {
    const hierarchy = await modules.getRoleHierarchy(
      new Map([['900000000000000001', ['Jail-Rolle']]]),
      new Set(['900000000000000001']),
    );
    expect(hierarchy.problems.map((problem) => problem.roleId)).toContain('900000000000000001');
  });

  it('meldet eine Rolle mit Dashboard-Berechtigungen NICHT als Problem', async () => {
    // Eine Administratorrolle darf über der Bot-Rolle liegen - der Bot muss sie
    // nie vergeben, sie steuert nur die Berechtigungen im Dashboard.
    const hierarchy = await modules.getRoleHierarchy(
      new Map([['900000000000000001', ['1 Dashboard-Berechtigung(en)']]]),
    );
    expect(hierarchy.problems).toHaveLength(0);
    expect(hierarchy.entries.find((entry) => entry.id === '900000000000000001')?.usage).toEqual([
      '1 Dashboard-Berechtigung(en)',
    ]);
  });
});

describe('Erstzugang zur Einrichtung', () => {
  beforeEach(async () => {
    await modules.connectGuild({ guildId: MOCK_GUILD_ID });
    await modules.syncDiscord({ trigger: 'manual' });
  });

  // Ohne diese Ausnahme entstünde ein Henne-Ei-Problem: Berechtigungen werden
  // im Dashboard vergeben, für das Dashboard braucht es aber Berechtigungen.
  it('erkennt den Discord-Serverowner als Administrator', async () => {
    // Mock-Guild: 100000000000000001 ist Owner.
    expect(await modules.isDiscordAdministrator('100000000000000001')).toBe(true);
  });

  it('erkennt ein Mitglied ohne Administratorrechte nicht als Administrator', async () => {
    // spammer99 trägt nur die Member-Rolle ohne Berechtigungsbits.
    expect(await modules.isDiscordAdministrator('100000000000000004')).toBe(false);
  });

  it('erkennt Nicht-Mitglieder nicht als Administrator', async () => {
    expect(await modules.isDiscordAdministrator('999999999999999999')).toBe(false);
  });

  it('meldet vor dem Abschluss der Einrichtung, dass noch niemand verwalten darf', async () => {
    const { isRecoveryNeeded } = await import('@swisshub/permissions');
    expect(await modules.isSetupComplete()).toBe(false);
    expect(await isRecoveryNeeded()).toBe(true);
  });
});

describe('Aussperrschutz', () => {
  it('verhindert das Entziehen der letzten verwaltenden Rolle', async () => {
    const { checkLockout } = await import('@swisshub/permissions');
    state.rolePermissions.push({ discordRoleId: '900000000000000002', permission: 'admin.full' });

    const removal = await checkLockout('900000000000000002', []);
    expect(removal.remainingManagerRoles).toBe(0);

    // Ohne Notzugang wäre danach niemand mehr berechtigt.
    if (!removal.ownerFallback) {
      expect(removal.wouldLockOut).toBe(true);
      expect(removal.reason).toBeTruthy();
    }
  });

  it('erlaubt die Änderung, solange eine andere Rolle verwalten darf', async () => {
    const { checkLockout } = await import('@swisshub/permissions');
    state.rolePermissions.push(
      { discordRoleId: '900000000000000001', permission: 'admin.full' },
      { discordRoleId: '900000000000000002', permission: 'permissions.manage' },
    );

    const result = await checkLockout('900000000000000002', []);
    expect(result.wouldLockOut).toBe(false);
    expect(result.remainingManagerRoles).toBe(1);
  });

  it('erkennt, wenn gar keine Rolle mehr verwalten darf', async () => {
    const { isRecoveryNeeded } = await import('@swisshub/permissions');
    state.rolePermissions.length = 0;
    expect(await isRecoveryNeeded()).toBe(true);

    state.rolePermissions.push({ discordRoleId: '900000000000000002', permission: 'admin.full' });
    expect(await isRecoveryNeeded()).toBe(false);
  });
});
