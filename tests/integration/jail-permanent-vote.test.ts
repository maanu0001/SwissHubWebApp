import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Permanente Jails und Vote Jail.
 *
 * Discord wird durch das Mock-Gateway ersetzt, die Datenbank durch eine
 * In-Memory-Implementierung mit denselben Constraints. Getestet wird das, was
 * im Betrieb weh tut: dass ein permanenter Jail nicht von selbst endet, dass
 * niemand doppelt abstimmt, dass Berechtigte mehrfach dürfen und dass die
 * fünfte Stimme genau einen Jail auslöst.
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
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

type State = ReturnType<typeof createFakeState>;

const JAIL_ROLE = '900000000000000006';
const VOTE_CHANNEL = '700000000000000002';
const TARGET = '100000000000000004'; // spammer99
const OTHER = '100000000000000006'; // roeschti

const MODERATOR = {
  discordId: '100000000000000002',
  username: 'nina.mod',
  roleIds: ['900000000000000003', '900000000000000008'],
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
  state.voteJails.length = 0;
  state.voteJailVotes.length = 0;
  state.idempotency.clear();
  state.managedRoles.length = 0;
  state.rolePermissions.length = 0;
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 7 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: false,
    notifyInJailChannel: false,
    voteJailEnabled: true,
    voteJailChannelId: VOTE_CHANNEL,
    voteJailRequiredVotes: 5,
    voteJailDurationSeconds: 5 * 60,
    voteJailResultSeconds: 30 * 60,
  };
  invalidateRoleConfiguration();
}

beforeEach(() => {
  resetState();
  gateway = createMockGateway();
  setDiscordGateway(gateway);
});

describe('Permanenter Jail', () => {
  it('speichert weder Dauer noch Enddatum', async () => {
    const result = await jail.createJail(
      {
        targetDiscordId: TARGET,
        type: 'PERMANENT',
        reason: 'Wiederholte Regelverstösse',
        idempotencyKey: crypto.randomUUID(),
      },
      MODERATOR,
      { gateway },
    );

    expect(result.jail.type).toBe('PERMANENT');
    expect(result.jail.endsAt).toBeNull();
    expect(result.jail.durationSeconds).toBeNull();
  });

  it('wird vom automatischen Release-Worker nicht angefasst', async () => {
    await jail.createJail(
      {
        targetDiscordId: TARGET,
        type: 'PERMANENT',
        reason: 'Spam',
        idempotencyKey: crypto.randomUUID(),
      },
      MODERATOR,
      { gateway },
    );

    // Auch weit in der Zukunft bleibt ein permanenter Jail bestehen.
    const sweep = await jail.releaseExpiredJails(25, gateway);
    expect(sweep.released).toBe(0);
    expect(state.jails[0]?.releasedAt).toBeNull();
  });

  it('lässt sich manuell aufheben und stellt die Rollen wieder her', async () => {
    const before = (await gateway.members.get(TARGET))!.roleIds;
    const created = await jail.createJail(
      {
        targetDiscordId: TARGET,
        type: 'PERMANENT',
        reason: 'Spam',
        idempotencyKey: crypto.randomUUID(),
      },
      MODERATOR,
      { gateway },
    );

    const released = await jail.releaseJail(created.jail.id, {
      releaseType: 'MANUAL',
      actor: MODERATOR,
      gateway,
    });

    expect(released.jail.releasedAt).not.toBeNull();
    expect(released.jail.releasedByDiscordId).toBe(MODERATOR.discordId);

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds.sort()).toEqual([...before].sort());
    expect(member?.roleIds).not.toContain(JAIL_ROLE);
  });

  it('ignoriert die maximale Dauer, weil ein permanenter Jail keine hat', async () => {
    state.moduleSettings.jail = { ...(state.moduleSettings.jail as object), maxDurationSeconds: 60 };
    const result = await jail.createJail(
      {
        targetDiscordId: TARGET,
        type: 'PERMANENT',
        reason: 'Spam',
        idempotencyKey: crypto.randomUUID(),
      },
      MODERATOR,
      { gateway },
    );
    expect(result.jail.type).toBe('PERMANENT');
  });
});

describe('Vote Jail', () => {
  const voters = ['1', '2', '3', '4', '5'].map((n) => `20000000000000000${n}`);

  async function startVote(): Promise<string> {
    const vote = await jail.startVoteJail({ targetDiscordId: TARGET }, MODERATOR, { gateway });
    return vote.id;
  }

  it('veröffentlicht eine Abstimmung mit Button und speichert die Nachricht', async () => {
    const vote = await jail.startVoteJail({ targetDiscordId: TARGET, reason: 'Provokation' }, MODERATOR, {
      gateway,
    });

    expect(vote.status).toBe('ACTIVE');
    expect(vote.requiredVotes).toBe(5);
    expect(vote.resultingJailMinutes).toBe(30);
    expect(vote.discordMessageId).toBeTruthy();
    expect(vote.discordChannelId).toBe(VOTE_CHANNEL);
  });

  it('verhindert zwei gleichzeitige Abstimmungen gegen dieselbe Person', async () => {
    await startVote();
    await expect(
      jail.startVoteJail({ targetDiscordId: TARGET }, MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lehnt eine Abstimmung gegen ein bereits gejailtes Mitglied ab', async () => {
    await jail.createJail(
      { targetDiscordId: TARGET, durationSeconds: 600, reason: 'Spam', idempotencyKey: crypto.randomUUID() },
      MODERATOR,
      { gateway },
    );
    await expect(
      jail.startVoteJail({ targetDiscordId: TARGET }, MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lehnt geschützte Ziele ab (Moderation Policy gilt auch hier)', async () => {
    // Der Discord-Guild-Owner ist in der Mock-Guild 100000000000000001.
    await expect(
      jail.startVoteJail({ targetDiscordId: '100000000000000001' }, MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  });

  it('zählt pro normalem Mitglied nur eine Stimme', async () => {
    const id = await startVote();

    const first = await jail.castVote(id, { discordId: voters[0]!, canMultivote: false });
    const second = await jail.castVote(id, { discordId: voters[0]!, canMultivote: false });

    expect(first.result).toBe('counted');
    expect(second.result).toBe('already-voted');
    expect(state.voteJails[0]?.voteCount).toBe(1);
  });

  it('zählt bei Mehrfachstimmberechtigung jeden Klick', async () => {
    const id = await startVote();

    await jail.castVote(id, { discordId: voters[0]!, canMultivote: true });
    await jail.castVote(id, { discordId: voters[0]!, canMultivote: true });
    const third = await jail.castVote(id, { discordId: voters[0]!, canMultivote: true });

    expect(third.result).toBe('counted');
    expect(state.voteJails[0]?.voteCount).toBe(3);
    // Die Stimmen werden einzeln gespeichert und als Admin-Stimme markiert.
    expect(state.voteJailVotes.filter((vote) => vote.isAdminVote)).toHaveLength(3);
    expect(state.voteJailVotes.map((vote) => vote.voteNumber)).toEqual([1, 2, 3]);
  });

  it('lässt das Ziel nicht über sich selbst abstimmen', async () => {
    const id = await startVote();
    const outcome = await jail.castVote(id, { discordId: TARGET, canMultivote: false });
    expect(outcome.result).toBe('self-vote');
    expect(state.voteJails[0]?.voteCount).toBe(0);
  });

  it('jailt das Ziel bei fünf Stimmen für 30 Minuten', async () => {
    const id = await startVote();

    for (const voter of voters) {
      const outcome = await jail.castVote(id, { discordId: voter, canMultivote: false });
      if (outcome.result === 'counted' && outcome.reachedThreshold) {
        await jail.completeSuccessfulVote(id, { gateway });
      }
    }

    const vote = state.voteJails[0]!;
    expect(vote.status).toBe('SUCCEEDED');
    expect(vote.voteCount).toBe(5);
    expect(vote.resultingJailId).not.toBeNull();

    const created = state.jails[0]!;
    expect(created.targetDiscordId).toBe(TARGET);
    expect(created.durationSeconds).toBe(30 * 60);
    expect(created.reason).toContain('Vote Jail');
  });

  it('zählt nach Erreichen der Schwelle keine weitere Stimme (Race Condition)', async () => {
    const id = await startVote();

    for (const voter of voters) {
      await jail.castVote(id, { discordId: voter, canMultivote: false });
    }
    expect(state.voteJails[0]?.status).toBe('SUCCEEDED');

    // Ein sechster Klick trifft eine bereits beendete Abstimmung.
    const late = await jail.castVote(id, { discordId: OTHER, canMultivote: false });
    expect(late.result).toBe('not-active');
    expect(state.voteJails[0]?.voteCount).toBe(5);
  });

  it('erzeugt auch bei doppeltem Abschluss nur einen Jail', async () => {
    const id = await startVote();
    for (const voter of voters) {
      await jail.castVote(id, { discordId: voter, canMultivote: false });
    }

    await jail.completeSuccessfulVote(id, { gateway });
    await jail.completeSuccessfulVote(id, { gateway });

    expect(state.jails).toHaveLength(1);
  });

  it('beendet abgelaufene Abstimmungen ohne Ergebnis', async () => {
    const id = await startVote();
    await jail.castVote(id, { discordId: voters[0]!, canMultivote: false });

    // Abstimmung in die Vergangenheit setzen.
    state.voteJails[0]!.expiresAt = new Date(Date.now() - 1000);

    const result = await jail.expireVoteJails(25, gateway);
    expect(result.expired).toBe(1);

    const vote = state.voteJails[0]!;
    expect(vote.status).toBe('FAILED');
    expect(vote.voteCount).toBe(1);
    expect(vote.activeKey).toBeNull();
    expect(state.jails).toHaveLength(0);
  });

  it('nimmt nach Ablauf keine Stimme mehr an', async () => {
    const id = await startVote();
    state.voteJails[0]!.expiresAt = new Date(Date.now() - 1000);

    const outcome = await jail.castVote(id, { discordId: voters[0]!, canMultivote: false });
    expect(outcome.result).toBe('not-active');
  });

  it('lehnt den Start ab, wenn Vote Jail deaktiviert ist', async () => {
    state.moduleSettings.jail = { ...(state.moduleSettings.jail as object), voteJailEnabled: false };
    await expect(
      jail.startVoteJail({ targetDiscordId: TARGET }, MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lehnt den Start ohne Channel ab', async () => {
    state.moduleSettings.jail = {
      ...(state.moduleSettings.jail as object),
      voteJailChannelId: undefined,
    };
    await expect(
      jail.startVoteJail({ targetDiscordId: TARGET }, MODERATOR, { gateway }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' });
  });

  it('protokolliert Start und Ergebnis im Audit Log', async () => {
    const id = await startVote();
    for (const voter of voters) {
      await jail.castVote(id, { discordId: voter, canMultivote: false });
    }
    await jail.completeSuccessfulVote(id, { gateway });

    const actions = state.audits.map((entry) => entry.action);
    expect(actions).toContain('VOTE_JAIL_STARTED');
    expect(actions).toContain('VOTE_JAIL_SUCCEEDED');
    expect(actions).toContain('JAIL_CREATED');
  });
});
