import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Austritt und Wiedereintritt während eines Jails.
 *
 * Ohne diese Behandlung wäre jede Strafe trivial umgehbar: Server verlassen,
 * neu beitreten, Rollen sind zurück. Der alte Bot löste das im
 * `on_member_join`-Event; hier entscheidet die Datenbank, das Discord-Ereignis
 * stösst es nur an.
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
const TARGET = '100000000000000004';

const MODERATOR = {
  discordId: '100000000000000002',
  username: 'nina.mod',
  roleIds: [],
  isOwner: true,
  moderationLevel: 100,
};

let state: State;
let gateway: ReturnType<typeof createMockGateway>;

function resetState(): void {
  state = fake.state as State;
  state.jails.length = 0;
  state.jailRoleSnapshots.length = 0;
  state.audits.length = 0;
  state.idempotency.clear();
  state.managedRoles.length = 0;
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 7 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: false,
    notifyInJailChannel: false,
    announcePublicly: false,
    pingOnJail: false,
    reapplyOnRejoin: true,
  };
}

beforeEach(() => {
  resetState();
  gateway = createMockGateway();
  setDiscordGateway(gateway);
});

async function jailTarget(durationSeconds: number | null = 3600): Promise<string> {
  const result = await jail.createJail(
    {
      targetDiscordId: TARGET,
      type: durationSeconds === null ? 'PERMANENT' : 'TEMPORARY',
      durationSeconds,
      reason: 'Spam',
      idempotencyKey: crypto.randomUUID(),
    },
    MODERATOR,
    { gateway },
  );
  return result.jail.id;
}

describe('Austritt während eines Jails', () => {
  it('hält den Eintrag offen und vermerkt den Austritt', async () => {
    const id = await jailTarget();

    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(true);

    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.lifecycle).toBe('PENDING_REJOIN');
    expect(entry?.leftGuildAt).not.toBeNull();
    expect(entry?.releasedAt).toBeNull();
    // Der Platz bleibt belegt - es kann kein zweiter Jail entstehen.
    expect(entry?.activeKey).toBe(TARGET);
    expect(state.audits.map((row) => row.action)).toContain('JAIL_PENDING_REJOIN');
  });

  it('meldet `false`, wenn gar kein Jail läuft', async () => {
    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(false);
  });

  it('lässt einen offenen Jail vom Sweep in Ruhe', async () => {
    const id = await jailTarget(60);
    await jail.markMemberLeftDuringJail(TARGET);
    state.jails.find((row) => row.id === id)!.endsAt = new Date(Date.now() - 1000);

    // Ohne diese Ausnahme würde der Sweep den Eintrag bei jedem Durchgang
    // erneut anfassen, ohne je etwas ausrichten zu können.
    const result = await jail.releaseExpiredJails(10, gateway);
    expect(result.processed).toBe(0);
    expect(state.jails.find((row) => row.id === id)?.releasedAt).toBeNull();
  });
});

describe('Wiedereintritt', () => {
  it('setzt die Jail-Rolle erneut und zählt den Wiedereintritt', async () => {
    const id = await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);

    // Discord kennt das Mitglied wieder - mit frischen Rollen.
    await gateway.members.setRoles(TARGET, ['900000000000000001']);

    const outcome = await jail.reapplyJailOnRejoin(TARGET, { gateway });

    expect(outcome).toBe('reapplied');
    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.lifecycle).toBe('ACTIVE');
    expect(entry?.reappliedCount).toBe(1);
    expect(entry?.leftGuildAt).toBeNull();

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toContain(JAIL_ROLE);
    expect(state.audits.map((row) => row.action)).toContain('JAIL_REAPPLIED');
  });

  it('beendet eine während der Abwesenheit abgelaufene Strafe sauber', async () => {
    const id = await jailTarget(60);
    await jail.markMemberLeftDuringJail(TARGET);
    state.jails.find((row) => row.id === id)!.endsAt = new Date(Date.now() - 1000);

    const outcome = await jail.reapplyJailOnRejoin(TARGET, { gateway });

    expect(outcome).toBe('released');
    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.releasedAt).not.toBeNull();
    expect(entry?.activeKey).toBeNull();

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).not.toContain(JAIL_ROLE);
  });

  it('wendet einen permanenten Jail auch nach Monaten wieder an', async () => {
    const id = await jailTarget(null);
    await jail.markMemberLeftDuringJail(TARGET);
    state.jails.find((row) => row.id === id)!.startedAt = new Date('2025-01-01T00:00:00Z');

    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('reapplied');
    expect((await gateway.members.get(TARGET))?.roleIds).toContain(JAIL_ROLE);
  });

  it('tut nichts, wenn kein Jail offen ist', async () => {
    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('none');
  });

  it('tut nichts, wenn die Einstellung deaktiviert ist', async () => {
    await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);
    (state.moduleSettings.jail as Record<string, unknown>).reapplyOnRejoin = false;

    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('none');
  });

  it('rührt einen bereits freigelassenen Jail nicht an', async () => {
    const id = await jailTarget();
    await jail.releaseJail(id, { releaseType: 'MANUAL', actor: MODERATOR, gateway });

    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('none');
  });
});
