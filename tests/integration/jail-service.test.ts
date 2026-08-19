import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Integrationstests des Jail-Moduls.
 *
 * Discord wird durch das Mock-Gateway ersetzt, die Datenbank durch eine
 * In-Memory-Implementierung mit denselben Constraints. Getestet wird der
 * komplette Ablauf inklusive Moderation Policy, Idempotenz, Race Conditions,
 * Rollen-Snapshot und Audit Log.
 */
const fake = vi.hoisted(() => ({ state: null as unknown, module: null as unknown }));

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const { jail } = await import('@swisshub/modules');
const { createMockGateway } = await import('@swisshub/discord');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

type State = ReturnType<typeof createFakeState>;

const JAIL_ROLE = '900000000000000006';
const MEMBER_ROLE = '900000000000000008';
const BOOSTER_ROLE = '900000000000000007';
const SUPPORTER_ROLE = '900000000000000004';
const OWNER_ROLE = '900000000000000001';

const TARGET = '100000000000000004'; // spammer99
const SUPPORTER = '100000000000000003'; // lars.supporter
const BOOSTED_MEMBER = '100000000000000005'; // alpenfuchs (Booster)

const MODERATOR = {
  discordId: '100000000000000002',
  username: 'nina.mod',
  roleIds: ['900000000000000003', MEMBER_ROLE],
  isOwner: false,
  moderationLevel: 50,
};

let state: State;
let gateway: ReturnType<typeof createMockGateway>;

function resetState(): void {
  state = fake.state as State;
  state.jails.length = 0;
  state.audits.length = 0;
  state.securityEvents.length = 0;
  state.moderationActions.length = 0;
  state.idempotency.clear();
  state.managedRoles.length = 0;
  state.rolePermissions.length = 0;
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 7 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: true,
    notifyInJailChannel: false,
  };
  state.systemConfig = {};
  invalidateRoleConfiguration();
}

const input = (
  overrides: Partial<{
    targetDiscordId: string;
    durationSeconds: number;
    reason: string;
    idempotencyKey: string;
  }> = {},
) => ({
  targetDiscordId: TARGET,
  durationSeconds: 3600,
  reason: 'Spam im Chat',
  idempotencyKey: crypto.randomUUID(),
  ...overrides,
});

beforeEach(() => {
  resetState();
  gateway = createMockGateway();
});

describe('Jail erstellen', () => {
  it('entzieht die Rollen, vergibt die Jail-Rolle und protokolliert die Aktion', async () => {
    const result = await jail.createJail(input(), MODERATOR, { gateway });

    expect(result.jail.status).toBe('COMPLETED');
    expect(result.jail.activeKey).toBe(TARGET);
    expect(result.jail.roleSnapshot).toEqual([MEMBER_ROLE]);
    expect(result.duplicate).toBe(false);

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toEqual([JAIL_ROLE]);

    expect(state.audits.some((entry) => entry.action === 'JAIL_CREATED')).toBe(true);
    expect(state.moderationActions).toHaveLength(1);
  });

  it('behaelt konfigurierte Rollen (Booster) waehrend des Jails', async () => {
    state.managedRoles.push({
      discordRoleId: BOOSTER_ROLE,
      label: 'Booster',
      isProtected: false,
      keepOnJail: true,
      moderationLevel: 0,
    });
    invalidateRoleConfiguration();

    const result = await jail.createJail(input({ targetDiscordId: BOOSTED_MEMBER }), MODERATOR, { gateway });

    const member = await gateway.members.get(BOOSTED_MEMBER);
    expect(member?.roleIds).toContain(JAIL_ROLE);
    expect(member?.roleIds).toContain(BOOSTER_ROLE);
    expect(member?.roleIds).not.toContain(MEMBER_ROLE);
    expect(result.jail.keptRoleIds).toEqual([BOOSTER_ROLE]);
  });

  it('fuehrt denselben Idempotency Key nur einmal aus (Doppelklick-Schutz)', async () => {
    const payload = input();

    const first = await jail.createJail(payload, MODERATOR, { gateway });
    const second = await jail.createJail(payload, MODERATOR, { gateway });

    expect(second.duplicate).toBe(true);
    expect(second.jail.id).toBe(first.jail.id);
    expect(state.jails).toHaveLength(1);
  });

  it('verhindert zwei gleichzeitig aktive Jails desselben Mitglieds (Race Condition)', async () => {
    const results = await Promise.allSettled([
      jail.createJail(input(), MODERATOR, { gateway }),
      jail.createJail(
        input(),
        { ...MODERATOR, discordId: '100000000000000009', username: 'zweiter.mod' },
        { gateway },
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
    expect(state.jails.filter((entry) => entry.activeKey !== null)).toHaveLength(1);
  });

  it('lehnt geschuetzte Mitglieder ab und protokolliert den Versuch', async () => {
    state.managedRoles.push({
      discordRoleId: SUPPORTER_ROLE,
      label: 'Supporter',
      isProtected: true,
      keepOnJail: false,
      moderationLevel: 10,
    });
    invalidateRoleConfiguration();

    await expect(
      jail.createJail(input({ targetDiscordId: SUPPORTER }), MODERATOR, { gateway }),
    ).rejects.toMatchObject({
      code: 'POLICY_VIOLATION',
    });

    expect(state.jails).toHaveLength(0);
    expect(state.securityEvents.some((event) => event.type === 'POLICY_VIOLATION')).toBe(true);
    expect(state.audits.some((entry) => entry.action === 'JAIL_FAILED')).toBe(true);

    const member = await gateway.members.get(SUPPORTER);
    expect(member?.roleIds).not.toContain(JAIL_ROLE);
  });

  it('verhindert Selbstmoderation', async () => {
    await expect(
      jail.createJail(input({ targetDiscordId: MODERATOR.discordId }), MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    expect(state.jails).toHaveLength(0);
  });

  it('bricht ohne konfigurierte Jail-Rolle mit klarer Meldung ab', async () => {
    state.moduleSettings.jail = { maxDurationSeconds: 7 * 24 * 60 * 60, keepRoleIds: [] };

    await expect(jail.createJail(input(), MODERATOR, { gateway })).rejects.toMatchObject({
      code: 'CONFIGURATION_MISSING',
    });
  });

  it('lehnt Dauern oberhalb der konfigurierten Obergrenze ab', async () => {
    state.moduleSettings.jail = { jailRoleId: JAIL_ROLE, maxDurationSeconds: 3600, keepRoleIds: [] };

    await expect(jail.createJail(input({ durationSeconds: 7200 }), MODERATOR, { gateway })).rejects.toThrow();
    expect(state.jails).toHaveLength(0);
  });

  it('markiert den Vorgang als FAILED, wenn Discord die Aktion ablehnt', async () => {
    const failing = {
      ...gateway,
      members: {
        ...gateway.members,
        setRoles: vi.fn().mockRejectedValue(new Error('Missing Permissions')),
      },
    };

    await expect(jail.createJail(input(), MODERATOR, { gateway: failing })).rejects.toBeDefined();

    expect(state.jails).toHaveLength(1);
    expect(state.jails[0]?.status).toBe('FAILED');
    // Kein aktiver Jail: der Vorgang darf nicht als wirksam gelten.
    expect(state.jails[0]?.activeKey).toBeNull();
    expect(state.audits.some((entry) => entry.action === 'JAIL_FAILED')).toBe(true);
  });
});

describe('Jail freilassen', () => {
  it('stellt die Rollen wieder her und schliesst den Vorgang ab', async () => {
    const created = await jail.createJail(input(), MODERATOR, { gateway });

    const released = await jail.releaseJail(created.jail.id, {
      releaseType: 'MANUAL',
      actor: MODERATOR,
      gateway,
    });

    expect(released.jail.releasedAt).not.toBeNull();
    expect(released.jail.activeKey).toBeNull();
    expect(released.jail.releaseStatus).toBe('COMPLETED');
    expect(released.restoredRoleIds).toEqual([MEMBER_ROLE]);

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toEqual([MEMBER_ROLE]);
    expect(state.audits.some((entry) => entry.action === 'JAIL_RELEASED')).toBe(true);
  });

  it('laesst sich nicht zweimal freilassen', async () => {
    const created = await jail.createJail(input(), MODERATOR, { gateway });
    await jail.releaseJail(created.jail.id, { releaseType: 'MANUAL', actor: MODERATOR, gateway });

    await expect(
      jail.releaseJail(created.jail.id, { releaseType: 'MANUAL', actor: MODERATOR, gateway }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('ueberspringt zwischenzeitlich geloeschte Rollen, statt den Release scheitern zu lassen', async () => {
    const created = await jail.createJail(input(), MODERATOR, { gateway });
    // Snapshot manipulieren: eine Rolle existiert auf Discord nicht mehr.
    const entry = state.jails.find((item) => item.id === created.jail.id);
    entry!.roleSnapshot = [MEMBER_ROLE, '999999999999999999'];

    const released = await jail.releaseJail(created.jail.id, {
      releaseType: 'AUTOMATIC',
      gateway,
    });

    expect(released.restoredRoleIds).toEqual([MEMBER_ROLE]);
    expect(released.failedRoleIds).toEqual(['999999999999999999']);
    expect(released.jail.releaseStatus).toBe('PARTIAL');
    expect(released.warnings.length).toBeGreaterThan(0);
  });

  it('schliesst den Jail, wenn das Mitglied den Server verlassen hat', async () => {
    const created = await jail.createJail(input(), MODERATOR, { gateway });
    const leftGateway = {
      ...gateway,
      members: { ...gateway.members, get: vi.fn().mockResolvedValue(null) },
    };

    const released = await jail.releaseJail(created.jail.id, {
      releaseType: 'AUTOMATIC',
      gateway: leftGateway,
    });

    expect(released.memberLeftGuild).toBe(true);
    expect(released.jail.releasedAt).not.toBeNull();
    expect(released.jail.activeKey).toBeNull();
  });
});

describe('Automatisches Jail-Ende', () => {
  it('gibt abgelaufene Jails frei (Datenbank als Source of Truth)', async () => {
    const created = await jail.createJail(input({ durationSeconds: 60 }), MODERATOR, { gateway });
    const entry = state.jails.find((item) => item.id === created.jail.id);
    entry!.endsAt = new Date(Date.now() - 1000);

    const result = await jail.releaseExpiredJails(10, gateway);

    expect(result.processed).toBe(1);
    expect(result.released).toBe(1);
    expect(entry?.releasedAt).not.toBeNull();
    expect(entry?.releaseType).toBe('AUTOMATIC');

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toContain(MEMBER_ROLE);
    expect(member?.roleIds).not.toContain(JAIL_ROLE);
  });

  it('laesst noch laufende Jails unberuehrt', async () => {
    await jail.createJail(input({ durationSeconds: 3600 }), MODERATOR, { gateway });

    const result = await jail.releaseExpiredJails(10, gateway);

    expect(result.processed).toBe(0);
    expect(state.jails[0]?.releasedAt).toBeNull();
  });

  it('setzt haengengebliebene Vorgaenge zurueck', async () => {
    await jail.createJail(input(), MODERATOR, { gateway });
    const entry = state.jails[0]!;
    entry.status = 'EXECUTING';
    entry.updatedAt = new Date(Date.now() - 10 * 60 * 1000);

    const recovered = await jail.recoverStuckJails();

    expect(recovered.stuckCreates).toBe(1);
    expect(entry.status).toBe('FAILED');
    expect(entry.activeKey).toBeNull();
  });
});

describe('Reconciliation', () => {
  it('erkennt eine fehlende Jail-Rolle und stellt sie wieder her', async () => {
    await jail.createJail(input(), MODERATOR, { gateway });
    // Discord-Zustand driftet: die Jail-Rolle wurde manuell entfernt.
    await gateway.roles.remove(TARGET, JAIL_ROLE);

    const summary = await jail.reconcileJails({ mode: 'MANUAL', repair: true, gateway });

    expect(summary.checked).toBe(1);
    expect(summary.drift).toHaveLength(1);
    expect(summary.drift[0]?.type).toBe('JAIL_ROLE_MISSING');
    expect(summary.repaired).toBe(1);

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toContain(JAIL_ROLE);
  });

  it('meldet keine Abweichung, wenn alles konsistent ist', async () => {
    await jail.createJail(input(), MODERATOR, { gateway });

    const summary = await jail.reconcileJails({ mode: 'AUTOMATIC', repair: true, gateway });

    expect(summary.drift).toHaveLength(0);
    expect(summary.repaired).toBe(0);
  });
});

describe('Owner-Schutz', () => {
  it('verweigert Aktionen gegen den Discord Guild Owner', async () => {
    await expect(
      jail.createJail(input({ targetDiscordId: '100000000000000001' }), MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  });

  it('verweigert Aktionen gegen den Bot', async () => {
    await expect(
      jail.createJail(input({ targetDiscordId: '800000000000000001' }), MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  });
});

describe('Rollenhierarchie', () => {
  it('verweigert Aktionen gegen hoehere Rollen', async () => {
    const weakModerator = { ...MODERATOR, roleIds: [MEMBER_ROLE], moderationLevel: 0 };
    state.managedRoles.push({
      discordRoleId: OWNER_ROLE,
      label: 'Owner',
      isProtected: false,
      keepOnJail: false,
      moderationLevel: 100,
    });
    invalidateRoleConfiguration();

    await expect(jail.createJail(input(), weakModerator, { gateway })).rejects.toMatchObject({
      code: 'POLICY_VIOLATION',
    });
  });
});
