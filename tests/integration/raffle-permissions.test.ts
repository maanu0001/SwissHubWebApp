import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_raffle_permissions');

/**
 * Berechtigungen und Zeitsteuerung der Verlosungen.
 *
 * Die Berechtigungen entscheiden, wer ziehen und wer neu ziehen darf - das
 * ist bewusst getrennt, weil eine Neuziehung in ein bereits verkündetes
 * Ergebnis eingreift. Geprüft wird gegen dieselbe Engine, die auch das
 * Dashboard und die Slash Commands verwenden.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');
const { hasPermission, resolvePermissions } = await import('@swisshub/permissions');
const { getModuleDefinition } = await import('@swisshub/modules');
const { raffle: R } = level;

const P = level.LEVEL_PERMISSIONS;
const ADMIN = { discordId: '100000000000000030', username: 'verwaltung' };

/** Rollen-Zuordnung, wie sie unter Server → Berechtigungen entsteht. */
const mappings = [
  { discordRoleId: 'rolle-mitglied', permission: P.raffleView },
  { discordRoleId: 'rolle-mitglied', permission: P.raffleParticipate },
  { discordRoleId: 'rolle-team', permission: P.raffleCreate },
  { discordRoleId: 'rolle-team', permission: P.raffleDraw },
  { discordRoleId: 'rolle-leitung', permission: P.raffleRedraw },
];

const subject = (roleIds: string[]) =>
  resolvePermissions({ discordId: '910000000000009999', roleIds, isOwner: false }, mappings);

describe('Berechtigungen', () => {
  it('gibt gewöhnlichen Mitgliedern nur Ansicht und Teilnahme', () => {
    const member = subject(['rolle-mitglied']);
    expect(hasPermission(member, P.raffleView)).toBe(true);
    expect(hasPermission(member, P.raffleParticipate)).toBe(true);
    expect(hasPermission(member, P.raffleCreate)).toBe(false);
    expect(hasPermission(member, P.raffleDraw)).toBe(false);
    expect(hasPermission(member, P.raffleCancel)).toBe(false);
  });

  it('trennt Ziehen von Neuziehen', () => {
    const team = subject(['rolle-team']);
    expect(hasPermission(team, P.raffleDraw)).toBe(true);
    // Wer ziehen darf, darf deshalb noch lange nicht neu ziehen.
    expect(hasPermission(team, P.raffleRedraw)).toBe(false);

    const leitung = subject(['rolle-team', 'rolle-leitung']);
    expect(hasPermission(leitung, P.raffleRedraw)).toBe(true);
  });

  it('verweigert ohne jede Rolle alles', () => {
    const fremd = subject([]);
    for (const permission of [P.raffleView, P.raffleParticipate, P.raffleDraw, P.raffleCancel]) {
      expect(hasPermission(fremd, permission)).toBe(false);
    }
  });

  it('verliert die Berechtigung mit der Rolle', () => {
    // Genau der Fall "Rolle auf Discord entzogen": beim nächsten Auflösen
    // fehlt sie, und damit ist auch die Berechtigung weg.
    expect(hasPermission(subject(['rolle-team']), P.raffleDraw)).toBe(true);
    expect(hasPermission(subject([]), P.raffleDraw)).toBe(false);
  });

  it('führt alle Verlosungs-Berechtigungen in der Registry', () => {
    const definition = getModuleDefinition(level.LEVEL_MODULE_ID)!;
    const registered = new Set(definition.permissions.map((entry) => entry.key));
    for (const key of [
      P.raffleView,
      P.raffleParticipate,
      P.raffleManage,
      P.raffleCreate,
      P.raffleEdit,
      P.raffleOpen,
      P.raffleClose,
      P.raffleDraw,
      P.raffleRedraw,
      P.raffleCancel,
      P.raffleHistory,
    ]) {
      expect(registered.has(key)).toBe(true);
    }
  });

  it('kennzeichnet folgenreiche Berechtigungen als kritisch', () => {
    const definition = getModuleDefinition(level.LEVEL_MODULE_ID)!;
    const byKey = new Map(definition.permissions.map((entry) => [entry.key, entry]));
    expect(byKey.get(P.raffleRedraw)?.critical).toBe(true);
    expect(byKey.get(P.raffleCancel)?.critical).toBe(true);
    expect(byKey.get(P.raffleView)?.critical).toBeUndefined();
  });
});

describeWithDatabase('Zeitsteuerung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "XpRaffleRefund","XpRaffleDraw","XpRaffleEntry","XpRaffle","XpTransaction","LevelProfile","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  const draft = (overrides: Record<string, unknown> = {}) =>
    R.raffleSchema.parse({
      title: 'Zeitgesteuerte Verlosung',
      prizeKind: 'TEXT_ONLY',
      prizeDescription: 'Ruhm und Ehre',
      entryModel: 'FIXED',
      fixedEntryXp: 100,
      minimumParticipants: 1,
      ...overrides,
    });

  it('öffnet die Teilnahme, wenn der Startzeitpunkt erreicht ist', async () => {
    const start = new Date(Date.now() + 60_000);
    const created = await R.createRaffle(ADMIN, draft({ entryStartsAt: start.toISOString() }));
    const published = await R.publishRaffle(ADMIN, created.id);
    expect(published.status).toBe('SCHEDULED');

    // Vor dem Zeitpunkt passiert nichts.
    expect((await R.runRaffleTick(new Date(Date.now() - 1000))).opened).toEqual([]);

    const result = await R.runRaffleTick(new Date(start.getTime() + 1000));
    expect(result.opened).toContain(created.id);
    expect((await R.getRaffle(created.id))!.status).toBe('ENTRY_OPEN');
  });

  it('schliesst die Teilnahme nach Ablauf der Frist', async () => {
    const ends = new Date(Date.now() + 60_000);
    const created = await R.createRaffle(ADMIN, draft({ entryEndsAt: ends.toISOString() }));
    await R.publishRaffle(ADMIN, created.id);

    const result = await R.runRaffleTick(new Date(ends.getTime() + 1000));
    expect(result.closed).toContain(created.id);
    expect((await R.getRaffle(created.id))!.status).toBe('ENTRY_CLOSED');
  });

  it('meldet nur bei ausdrücklichem Wunsch zur selbsttätigen Ziehung', async () => {
    const drawAt = new Date(Date.now() - 1000);
    const ohne = await R.createRaffle(
      ADMIN,
      draft({ drawScheduledAt: drawAt.toISOString(), autoDraw: false }),
    );
    const mit = await R.createRaffle(ADMIN, draft({ drawScheduledAt: drawAt.toISOString(), autoDraw: true }));
    for (const id of [ohne.id, mit.id]) {
      await R.publishRaffle(ADMIN, id);
      await R.closeEntries(ADMIN, id);
    }

    const result = await R.runRaffleTick(new Date());
    const ids = result.readyToDraw.map((entry) => entry.id);
    expect(ids).toContain(mit.id);
    // Standardmässig wird nicht selbsttätig gezogen.
    expect(ids).not.toContain(ohne.id);
  });

  it('lässt sich mehrfach ausführen, ohne etwas zu verdoppeln', async () => {
    const ends = new Date(Date.now() - 1000);
    const created = await R.createRaffle(ADMIN, draft({ entryEndsAt: ends.toISOString() }));
    await R.publishRaffle(ADMIN, created.id);

    const first = await R.runRaffleTick(new Date());
    const second = await R.runRaffleTick(new Date());
    expect(first.closed).toContain(created.id);
    // Beim zweiten Lauf ist nichts mehr zu tun.
    expect(second.closed).toEqual([]);
  });

  it('holt nach einem Ausfall nach, statt die Frist zu verlieren', async () => {
    // Der Zustand steht in der Datenbank, nicht in einem Zeitgeber im
    // Arbeitsspeicher. Ein Lauf, der einen Tag später kommt, holt deshalb
    // nach, was in der Zwischenzeit fällig geworden ist.
    const ends = new Date(Date.now() - 86_400_000);
    const created = await R.createRaffle(ADMIN, draft({ entryEndsAt: ends.toISOString() }));
    await R.publishRaffle(ADMIN, created.id);

    const result = await R.runRaffleTick(new Date());
    expect(result.closed).toContain(created.id);
  });
});
