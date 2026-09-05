import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Der Grund einer Strafe - und wo Notizen landen.
 *
 * Zwei Dinge, die vorher am falschen Ort standen: der Jail-Grund war
 * öffentlich zu lesen, obwohl er nur das Team etwas angeht, und eine Notiz
 * aus dem Moderationsdialog landete in der Moderationshistorie statt in der
 * Akte des Mitglieds - dort, wo man sie sucht.
 */
const fake = vi.hoisted(() => ({ state: null as unknown, module: null as unknown }));

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const { jail, moderation } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

type State = ReturnType<typeof createFakeState>;

const JAIL_ROLE = '900000000000000006';
const ANKUENDIGUNG = '700000000000000001';
const JAIL_KANAL = '700000000000000003';
const MOD_LOG = '700000000000000004';
const TARGET = '100000000000000004';

const MODERATOR = {
  discordId: '100000000000000002',
  username: 'nina.mod',
  roleIds: ['900000000000000003', '900000000000000008'],
  isOwner: false,
  moderationLevel: 50,
  can: () => true,
};

const GRUND = 'Spam im Chat mit Links';

let state: State;
let gateway: ReturnType<typeof createMockGateway>;
let gesendet: Array<{ channelId: string; payload: Record<string, unknown> }>;

beforeEach(() => {
  state = fake.state as State;
  state.jails.length = 0;
  state.audits.length = 0;
  state.moderationActions.length = 0;
  state.memberNotes.length = 0;
  state.jailRoleSnapshots.length = 0;
  state.idempotency.clear();
  state.managedRoles.length = 0;
  state.rolePermissions.length = 0;
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 365 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: true,
    moderationLogChannelId: MOD_LOG,
    notifyInJailChannel: true,
    jailChannelId: JAIL_KANAL,
    announcePublicly: true,
    announcementChannelId: ANKUENDIGUNG,
    silentByDefault: false,
    reasonPresets: 'Spam\nBeleidigung\nRegelverstoss',
  };
  invalidateRoleConfiguration();

  const echt = createMockGateway();
  gesendet = [];
  gateway = {
    ...echt,
    channels: {
      ...echt.channels,
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        gesendet.push({ channelId, payload });
        return echt.channels.send(channelId, payload as never);
      }),
    },
  } as never;
  setDiscordGateway(gateway);
});

/** Alles, was in einen Kanal gegangen ist - Text wie Embed. */
function textIn(channelId: string): string {
  return gesendet
    .filter((eintrag) => eintrag.channelId === channelId)
    .map((eintrag) => JSON.stringify(eintrag.payload))
    .join(' ');
}

async function jaile(durationSeconds: number | null = 3600) {
  return jail.createJail(
    {
      targetDiscordId: TARGET,
      type: durationSeconds === null ? 'PERMANENT' : 'TEMPORARY',
      ...(durationSeconds === null ? {} : { durationSeconds }),
      reason: GRUND,
      idempotencyKey: crypto.randomUUID(),
    },
    MODERATOR,
    { gateway },
  );
}

describe('Der Jail-Grund bleibt intern', () => {
  it('steht nicht in der öffentlichen Ankündigung', async () => {
    await jaile();
    expect(textIn(ANKUENDIGUNG)).not.toContain(GRUND);
    expect(textIn(ANKUENDIGUNG)).not.toContain('Grund');
  });

  it('steht nicht im Jail-Kanal', async () => {
    await jaile();
    expect(textIn(JAIL_KANAL)).not.toContain(GRUND);
  });

  it('steht im Moderationslog, das nur das Team liest', async () => {
    await jaile();
    expect(textIn(MOD_LOG)).toContain(GRUND);
  });

  it('bleibt in der Akte gespeichert', async () => {
    const ergebnis = await jaile();
    expect(ergebnis.jail.reason).toBe(GRUND);
    const gespeichert = state.jails.find((eintrag) => eintrag.id === ergebnis.jail.id);
    expect(gespeichert?.reason).toBe(GRUND);
  });

  it('gilt auch für einen permanenten Jail', async () => {
    await jaile(null);
    expect(textIn(ANKUENDIGUNG)).not.toContain(GRUND);
    expect(textIn(JAIL_KANAL)).not.toContain(GRUND);
    expect(textIn(MOD_LOG)).toContain(GRUND);
  });
});

describe('Dauer', () => {
  it('nimmt eine Dauer in Stunden', async () => {
    const ergebnis = await jaile(5 * 3600);
    expect(ergebnis.jail.durationSeconds).toBe(18_000);
  });

  it('nimmt eine Dauer in Tagen', async () => {
    const ergebnis = await jaile(2 * 86_400);
    expect(ergebnis.jail.durationSeconds).toBe(172_800);
  });

  it('nimmt eine zusammengesetzte Dauer', async () => {
    // 1 Tag 6 Stunden - genau der Fall aus der Aufgabe.
    const ergebnis = await jaile(86_400 + 6 * 3600);
    expect(ergebnis.jail.durationSeconds).toBe(108_000);
  });

  it('weist eine Dauer unter einer Minute ab', () => {
    expect(() =>
      jail.createJailSchema.parse({
        targetDiscordId: TARGET,
        type: 'TEMPORARY',
        durationSeconds: 30,
        reason: GRUND,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('weist eine negative Dauer ab', () => {
    expect(() =>
      jail.createJailSchema.parse({
        targetDiscordId: TARGET,
        type: 'TEMPORARY',
        durationSeconds: -3600,
        reason: GRUND,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('weist eine fehlende Dauer bei befristetem Jail ab', () => {
    expect(() =>
      jail.createJailSchema.parse({
        targetDiscordId: TARGET,
        type: 'TEMPORARY',
        reason: GRUND,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('weist eine unrealistisch grosse Dauer ab', () => {
    expect(() =>
      jail.createJailSchema.parse({
        targetDiscordId: TARGET,
        type: 'TEMPORARY',
        durationSeconds: 10 * 365 * 24 * 3600,
        reason: GRUND,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });
});

describe('Vordefinierte Gründe', () => {
  it('liest sie zeilenweise aus den Einstellungen', () => {
    expect(jail.jailReasonPresets({ reasonPresets: 'Spam\nBeleidigung\nRegelverstoss' })).toEqual([
      'Spam',
      'Beleidigung',
      'Regelverstoss',
    ]);
  });

  it('lässt leere Zeilen, Doppelte und Unbrauchbares weg', () => {
    expect(
      jail.jailReasonPresets({ reasonPresets: ' Spam \n\n Spam\n  \nok\nBeleidigung ' }),
    ).toEqual(['Spam', 'Beleidigung']);
  });

  it('ersetzt die freie Eingabe nicht', async () => {
    // Ein Grund, der in keiner Vorlage steht, geht trotzdem durch.
    const ergebnis = await jaile();
    expect(ergebnis.jail.reason).toBe(GRUND);
  });
});

describe('Moderationsnotizen', () => {
  it('landen in der Akte des Mitglieds', async () => {
    await moderation.addModerationNote(
      { actor: MODERATOR, targetDiscordId: TARGET, reason: 'Mehrfach auffällig geworden.' },
      { gateway },
    );

    expect(state.memberNotes).toHaveLength(1);
    expect(state.memberNotes[0]?.targetDiscordId).toBe(TARGET);
    expect(state.memberNotes[0]?.content).toBe('Mehrfach auffällig geworden.');
    expect(state.memberNotes[0]?.authorDiscordId).toBe(MODERATOR.discordId);
    expect(state.memberNotes[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('erscheinen weiterhin in der Moderationshistorie', async () => {
    await moderation.addModerationNote(
      { actor: MODERATOR, targetDiscordId: TARGET, reason: 'Mehrfach auffällig geworden.' },
      { gateway },
    );

    const eintrag = state.moderationActions.find((zeile) => zeile.type === 'NOTE');
    expect(eintrag).toBeDefined();
    // Der Verweis auf die Notiz: der Text steht nur an einer Stelle.
    expect(eintrag?.referenceId).toBe(state.memberNotes[0]?.id);
  });

  it('brauchen die Berechtigung dafür', async () => {
    await expect(
      moderation.addModerationNote(
        {
          actor: { ...MODERATOR, can: (recht: string) => recht !== 'moderation.notes.create' },
          targetDiscordId: TARGET,
          reason: 'Sollte nicht durchkommen.',
        },
        { gateway },
      ),
    ).rejects.toThrow();
    expect(state.memberNotes).toHaveLength(0);
  });
});
