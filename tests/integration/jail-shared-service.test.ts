import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Ein Jail-System für Dashboard und Discord.
 *
 * Die Kernaussage dieser Datei: Slash Command und Dashboard führen dieselbe
 * Geschäftslogik aus. Beweisen lässt sich das nicht über Zusicherungen im
 * Code, sondern über beobachtbare Wirkungen, die es nur einmal gibt:
 *
 *   - derselbe Unique-Constraint (`activeKey`) - ein Weg blockiert den anderen,
 *   - derselbe Rollen-Snapshot in derselben Tabelle,
 *   - dieselben Audit-Einträge,
 *   - dieselbe Freilassung: was der eine anlegt, beendet der andere.
 *
 * Gäbe es eine zweite, parallele Jail-Logik (wie im alten Bot), würde
 * mindestens eine dieser Zusicherungen fehlschlagen.
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
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');
const { handleJailCommand } = await import('../../apps/bot/src/commands/jail-commands');

type State = ReturnType<typeof createFakeState>;

const JAIL_ROLE = '900000000000000006';
const MOD_ROLE = '900000000000000003';
const TARGET = '100000000000000004';
const MODERATOR_ID = '100000000000000002';

const DASHBOARD_ACTOR = {
  discordId: MODERATOR_ID,
  username: 'nina.mod',
  roleIds: [MOD_ROLE],
  isOwner: false,
  moderationLevel: 50,
};

let state: State;
let gateway: ReturnType<typeof createMockGateway>;

/**
 * Minimale Nachbildung einer Discord-Interaktion.
 *
 * Nur das, was der Adapter tatsächlich anfasst - dadurch bleibt sichtbar, wie
 * wenig Discord-Kontext die Jail-Logik überhaupt braucht.
 */
function interaction(
  commandName: string,
  options: Record<string, string | { id: string }> = {},
): {
  interaction: Record<string, unknown>;
  replies: Array<Record<string, unknown>>;
} {
  const replies: Array<Record<string, unknown>> = [];
  return {
    replies,
    interaction: {
      commandName,
      user: { id: MODERATOR_ID, username: 'nina.mod', avatar: null },
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
        getUser: (name: string) => {
          const value = options[name];
          return typeof value === 'object' ? { ...value, toString: () => `<@${value.id}>` } : null;
        },
        getString: (name: string) => {
          const value = options[name];
          return typeof value === 'string' ? value : null;
        },
      },
    },
  };
}

/** Führt einen Slash Command über den echten Adapter aus. */
async function runCommand(
  commandName: string,
  options: Record<string, string | { id: string }> = {},
): Promise<string> {
  const { interaction: fakeInteraction, replies } = interaction(commandName, options);
  await handleJailCommand(fakeInteraction as never);
  return String(replies.at(-1)?.content ?? '');
}

function resetState(): void {
  state = fake.state as State;
  state.jails.length = 0;
  state.jailRoleSnapshots.length = 0;
  state.audits.length = 0;
  state.securityEvents.length = 0;
  state.moderationActions.length = 0;
  state.voteJails.length = 0;
  state.voteJailVotes.length = 0;
  state.voteJailCooldowns.length = 0;
  state.idempotency.clear();
  state.managedRoles.length = 0;
  state.rolePermissions.length = 0;
  // Der Moderator bekommt seine Rechte über dieselbe Rollen-Zuordnung, die
  // auch das Dashboard verwendet - es gibt keine zweite Adminliste.
  state.rolePermissions.push(
    { discordRoleId: MOD_ROLE, permission: 'jail.create' },
    { discordRoleId: MOD_ROLE, permission: 'jail.release' },
    { discordRoleId: MOD_ROLE, permission: 'jail.view' },
  );
  state.managedRoles.push({
    discordRoleId: MOD_ROLE,
    label: 'Moderation',
    isProtected: false,
    keepOnJail: false,
    moderationLevel: 50,
  });
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 7 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: false,
    notifyInJailChannel: false,
    announcePublicly: false,
    pingOnJail: false,
  };
  state.moduleEnabled.jail = true;
  invalidateRoleConfiguration();
}

beforeEach(() => {
  resetState();
  gateway = createMockGateway();
  setDiscordGateway(gateway);
});

describe('Slash Command und Dashboard teilen sich denselben Dienst', () => {
  it('erzeugt über `/jail` einen ganz gewöhnlichen Jail-Eintrag', async () => {
    const reply = await runCommand('jail', { user: { id: TARGET }, duration: '2h', reason: 'Spam' });

    expect(reply).toContain('Jail');
    expect(state.jails).toHaveLength(1);

    const entry = state.jails[0]!;
    expect(entry.targetDiscordId).toBe(TARGET);
    expect(entry.durationSeconds).toBe(2 * 60 * 60);
    // Einziger Unterschied zum Dashboard: die vermerkte Herkunft.
    expect(entry.source).toBe('SLASH_COMMAND');
    expect(entry.status).toBe('COMPLETED');

    // Derselbe Rollen-Snapshot in derselben Tabelle.
    expect(state.jailRoleSnapshots.filter((row) => row.jailId === entry.id).length).toBeGreaterThan(0);
    // Dasselbe Audit-Ereignis wie aus dem Dashboard.
    expect(state.audits.map((row) => row.action)).toContain('JAIL_CREATED');

    // Und dieselbe Discord-Wirkung.
    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toContain(JAIL_ROLE);
    expect(member?.roleIds).not.toContain(entry.roleSnapshot[0]);
  });

  it('legt ohne Dauerangabe einen permanenten Jail an', async () => {
    await runCommand('jail', { user: { id: TARGET }, reason: 'Dauerhaft' });

    expect(state.jails[0]?.type).toBe('PERMANENT');
    expect(state.jails[0]?.endsAt).toBeNull();
    expect(state.jails[0]?.durationSeconds).toBeNull();
  });

  it('markiert `/silent_jail` als stillen Jail', async () => {
    await runCommand('silent_jail', { user: { id: TARGET }, duration: '30m', reason: 'Still' });

    expect(state.jails[0]?.silent).toBe(true);
    expect(state.jails[0]?.source).toBe('SLASH_COMMAND');
  });

  it('blockiert den Slash Command, wenn das Dashboard bereits gejailt hat', async () => {
    await jail.createJail(
      {
        targetDiscordId: TARGET,
        durationSeconds: 600,
        reason: 'Aus dem Dashboard',
        idempotencyKey: crypto.randomUUID(),
      },
      DASHBOARD_ACTOR,
      { gateway },
    );

    const reply = await runCommand('jail', { user: { id: TARGET }, duration: '1h', reason: 'Nochmal' });

    // Derselbe Unique-Constraint - es gibt nur eine Wahrheit.
    expect(reply).toContain('bereits gejailt');
    expect(state.jails).toHaveLength(1);
  });

  it('lässt über `/jail_free` frei, was das Dashboard angelegt hat', async () => {
    const created = await jail.createJail(
      {
        targetDiscordId: TARGET,
        durationSeconds: 600,
        reason: 'Aus dem Dashboard',
        idempotencyKey: crypto.randomUUID(),
      },
      DASHBOARD_ACTOR,
      { gateway },
    );

    const reply = await runCommand('jail_free', { user: { id: TARGET } });

    expect(reply).toContain('entlah');
    const entry = state.jails.find((row) => row.id === created.jail.id);
    expect(entry?.releasedAt).not.toBeNull();
    expect(entry?.activeKey).toBeNull();
    expect(entry?.lifecycle).toBe('RELEASED');

    // Die gesicherten Rollen sind zurück, die Jail-Rolle ist weg.
    const member = await gateway.members.get(TARGET);
    for (const roleId of created.jail.roleSnapshot) {
      expect(member?.roleIds).toContain(roleId);
    }
    expect(member?.roleIds).not.toContain(JAIL_ROLE);
  });

  it('zeigt in `/jail_list` dieselbe Übersicht wie das Dashboard', async () => {
    await jail.createJail(
      {
        targetDiscordId: TARGET,
        reason: 'Permanent',
        type: 'PERMANENT',
        idempotencyKey: crypto.randomUUID(),
      },
      DASHBOARD_ACTOR,
      { gateway },
    );

    const { interaction: fakeInteraction, replies } = interaction('jail_list');
    await handleJailCommand(fakeInteraction as never);

    const embeds = replies.at(-1)?.embeds as Array<{ description: string }> | undefined;
    expect(embeds?.[0]?.description).toContain(TARGET);
    expect(embeds?.[0]?.description).toContain('Unbegrenzt');

    const dashboard = await jail.listActiveJails();
    expect(dashboard).toHaveLength(1);
  });

  it('verweigert den Befehl ohne Berechtigung - ohne feste Adminliste', async () => {
    // Rechte entziehen; die Rolle selbst bleibt unverändert.
    state.rolePermissions.length = 0;
    invalidateRoleConfiguration();

    const reply = await runCommand('jail', { user: { id: TARGET }, duration: '1h', reason: 'Spam' });

    expect(reply).toContain('kei Berächtigung');
    expect(state.jails).toHaveLength(0);
  });

  it('lehnt eine unlesbare Dauer ab, bevor irgendetwas passiert', async () => {
    const reply = await runCommand('jail', { user: { id: TARGET }, duration: 'irgendwann', reason: 'Spam' });

    expect(reply).toContain('Ungültigi Duur');
    expect(state.jails).toHaveLength(0);
  });

  it('führt bei deaktiviertem Modul nichts aus', async () => {
    state.moduleEnabled.jail = false;

    const reply = await runCommand('jail', { user: { id: TARGET }, duration: '1h', reason: 'Spam' });

    expect(reply).toContain('deaktiviert');
    expect(state.jails).toHaveLength(0);
  });
});

describe('Dauerangaben der Slash Commands', () => {
  it('versteht das Format des alten Bots', () => {
    expect(jail.parseDurationInput('10m')).toEqual({ type: 'TEMPORARY', seconds: 600 });
    expect(jail.parseDurationInput('2h')).toEqual({ type: 'TEMPORARY', seconds: 7200 });
    expect(jail.parseDurationInput('3d')).toEqual({ type: 'TEMPORARY', seconds: 259200 });
    // Eine blosse Zahl waren im alten Bot Minuten.
    expect(jail.parseDurationInput('90')).toEqual({ type: 'TEMPORARY', seconds: 5400 });
    expect(jail.parseDurationInput('2 Stunden')).toEqual({ type: 'TEMPORARY', seconds: 7200 });
  });

  it('erkennt eine unbefristete Strafe', () => {
    expect(jail.parseDurationInput('permanent')).toEqual({ type: 'PERMANENT' });
    expect(jail.parseDurationInput('unbegrenzt')).toEqual({ type: 'PERMANENT' });
  });

  it('lehnt Unsinn und Grenzwerte ab', () => {
    expect(jail.parseDurationInput('')).toBeNull();
    expect(jail.parseDurationInput('bald')).toBeNull();
    expect(jail.parseDurationInput('0m')).toBeNull();
    expect(jail.parseDurationInput('-5m')).toBeNull();
    // Über der Obergrenze von einem Jahr.
    expect(jail.parseDurationInput('400d')).toBeNull();
  });
});
