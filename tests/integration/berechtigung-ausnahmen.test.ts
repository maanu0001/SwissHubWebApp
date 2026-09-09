import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_berechtigung_ausnahmen');

/**
 * Ausnahmen gegen eine echte Datenbank.
 *
 * Die Wirkung ist eine Spalte, kein Rechentrick: dass eine Ausnahme das
 * Speichern ueberlebt, dass sie sich wieder aufheben laesst und dass die
 * Eindeutigkeit von `(discordRoleId, permission)` verhindert, dass dieselbe
 * Berechtigung gleichzeitig erlaubt und verweigert ist - das sind
 * Datenbankeigenschaften und keine Behauptungen einer Nachbildung.
 *
 * Ebenfalls hier und nicht im Einheitstest: dass eine Rolle wirklich jede
 * registrierte Berechtigung tragen kann. Genau daran ist es vorher
 * gescheitert, und eine Zahl im Schema faellt erst auf, wenn jemand sie
 * ueberschreitet.
 */
const { prisma } = await import('@swisshub/database');
const {
  hasPermission,
  listPermissions,
  loadRoleConfiguration,
  invalidateRoleConfiguration,
  checkLockout,
  isRecoveryNeeded,
  resolvePermissions,
} = await import('@swisshub/permissions');
await import('@swisshub/modules');

const ADMIN_ROLE = '900000000000003001';
const ZWEITE_ROLLE = '900000000000003002';
const PERSON = '900000000000003099';

const ALLE = listPermissions().map((definition) => definition.key);

async function rolle(discordRoleId: string, label: string): Promise<void> {
  await prisma.managedRole.upsert({
    where: { discordRoleId },
    create: { discordRoleId, label },
    update: { label },
  });
}

async function setze(
  discordRoleId: string,
  erlaubt: readonly string[],
  verweigert: readonly string[] = [],
): Promise<void> {
  await prisma.rolePermission.deleteMany({ where: { discordRoleId } });
  await prisma.rolePermission.createMany({
    data: [
      ...erlaubt.map((permission) => ({ discordRoleId, permission, effect: 'ALLOW' as const })),
      ...verweigert.map((permission) => ({ discordRoleId, permission, effect: 'DENY' as const })),
    ],
  });
  invalidateRoleConfiguration();
}

/** Wie das laufende System die Rolle sieht - ueber Store und Engine. */
async function aufloesen(roleIds: string[]) {
  const konfiguration = await loadRoleConfiguration(true);
  return resolvePermissions({ discordId: PERSON, roleIds, isOwner: false }, konfiguration.mappings);
}

describeWithDatabase('Vollzugriff mit Ausnahmen in der Datenbank', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "RolePermission","ManagedRole","SystemConfig" RESTART IDENTITY CASCADE',
    );
    invalidateRoleConfiguration();
    await rolle(ADMIN_ROLE, 'Administrator');
  });

  it('speichert jede registrierte Berechtigung an einer einzigen Rolle', async () => {
    await setze(ADMIN_ROLE, ALLE);

    const gespeichert = await prisma.rolePermission.count({ where: { discordRoleId: ADMIN_ROLE } });
    expect(gespeichert).toBe(ALLE.length);
    expect(gespeichert).toBeGreaterThan(128);

    const resolution = await aufloesen([ADMIN_ROLE]);
    for (const permission of ALLE) {
      expect(hasPermission(resolution, permission), permission).toBe(true);
    }
  });

  it('sperrt mit Vollzugriff genau die eine Ausnahme', async () => {
    await setze(ADMIN_ROLE, ['admin.full'], ['migration.execute']);

    const resolution = await aufloesen([ADMIN_ROLE]);
    expect(hasPermission(resolution, 'migration.execute')).toBe(false);
    for (const permission of ALLE.filter((key) => key !== 'migration.execute')) {
      expect(hasPermission(resolution, permission), permission).toBe(true);
    }
  });

  it('haelt zwei Ausnahmen nebeneinander', async () => {
    await setze(ADMIN_ROLE, ['admin.full'], ['migration.execute', 'integrations.secrets.manage']);

    const resolution = await aufloesen([ADMIN_ROLE]);
    expect(hasPermission(resolution, 'migration.execute')).toBe(false);
    expect(hasPermission(resolution, 'integrations.secrets.manage')).toBe(false);
    expect(hasPermission(resolution, 'settings.edit')).toBe(true);
  });

  it('gibt die Berechtigung zurueck, sobald die Ausnahme entfernt wird', async () => {
    await setze(ADMIN_ROLE, ['admin.full'], ['migration.execute']);
    expect(hasPermission(await aufloesen([ADMIN_ROLE]), 'migration.execute')).toBe(false);

    await setze(ADMIN_ROLE, ['admin.full']);
    expect(hasPermission(await aufloesen([ADMIN_ROLE]), 'migration.execute')).toBe(true);
  });

  it('schreibt die Wirkung beim Umschalten wirklich um', async () => {
    // Der Fall, der beim Speichern beinahe durchgerutscht waere: die Zeile
    // existiert bereits, faellt also weder unter das Loeschen noch unter das
    // Anlegen. Ohne `update: { effect }` bliebe sie fuer immer eine Ausnahme.
    await setze(ADMIN_ROLE, ['admin.full'], ['migration.execute']);
    await prisma.rolePermission.upsert({
      where: {
        discordRoleId_permission: { discordRoleId: ADMIN_ROLE, permission: 'migration.execute' },
      },
      create: { discordRoleId: ADMIN_ROLE, permission: 'migration.execute', effect: 'ALLOW' },
      update: { effect: 'ALLOW' },
    });
    invalidateRoleConfiguration();

    const zeile = await prisma.rolePermission.findFirstOrThrow({
      where: { discordRoleId: ADMIN_ROLE, permission: 'migration.execute' },
    });
    expect(zeile.effect).toBe('ALLOW');
    expect(hasPermission(await aufloesen([ADMIN_ROLE]), 'migration.execute')).toBe(true);
  });

  it('laesst dieselbe Berechtigung nicht gleichzeitig erlauben und verweigern', async () => {
    await setze(ADMIN_ROLE, ['admin.full']);

    await expect(
      prisma.rolePermission.create({
        data: { discordRoleId: ADMIN_ROLE, permission: 'admin.full', effect: 'DENY' },
      }),
    ).rejects.toThrow();
  });

  it('vergibt bestehenden Zeilen ohne Angabe die Wirkung ALLOW', async () => {
    // Bestandsdaten aus der Zeit vor der Spalte. Waeren sie hinterher
    // Ausnahmen, verloere nach dem Deployment jede Rolle alles.
    await prisma.rolePermission.create({
      data: { discordRoleId: ADMIN_ROLE, permission: 'jail.create' },
    });
    invalidateRoleConfiguration();

    const zeile = await prisma.rolePermission.findFirstOrThrow({
      where: { discordRoleId: ADMIN_ROLE, permission: 'jail.create' },
    });
    expect(zeile.effect).toBe('ALLOW');
    expect(hasPermission(await aufloesen([ADMIN_ROLE]), 'jail.create')).toBe(true);
  });

  it('laesst eine Ausnahme nicht durch eine zweite Rolle aushebeln', async () => {
    await rolle(ZWEITE_ROLLE, 'Helfer');
    await setze(ADMIN_ROLE, ['admin.full'], ['migration.execute']);
    await prisma.rolePermission.create({
      data: { discordRoleId: ZWEITE_ROLLE, permission: 'migration.execute', effect: 'ALLOW' },
    });
    invalidateRoleConfiguration();

    const resolution = await aufloesen([ADMIN_ROLE, ZWEITE_ROLLE]);
    expect(hasPermission(resolution, 'migration.execute')).toBe(false);
  });

  it('liefert nach einer Aenderung erst mit Invalidierung den neuen Stand', async () => {
    await setze(ADMIN_ROLE, ['admin.full']);
    await loadRoleConfiguration();

    // Direkt an der Datenbank vorbei am Speicherweg - der Zwischenspeicher
    // darf davon nichts mitbekommen.
    await prisma.rolePermission.create({
      data: { discordRoleId: ADMIN_ROLE, permission: 'migration.execute', effect: 'DENY' },
    });

    const veraltet = await loadRoleConfiguration();
    expect(veraltet.mappings.some((eintrag) => eintrag.permission === 'migration.execute')).toBe(false);

    invalidateRoleConfiguration();
    const frisch = await loadRoleConfiguration();
    const eintrag = frisch.mappings.find((zeile) => zeile.permission === 'migration.execute');
    expect(eintrag?.effect).toBe('DENY');
  });

  it('zaehlt eine Rolle mit gesperrter Verwaltung nicht als Verwalter', async () => {
    await setze(ADMIN_ROLE, ['admin.full'], ['permissions.manage']);

    const pruefung = await checkLockout(ZWEITE_ROLLE, []);
    expect(pruefung.remainingManagerRoles).toBe(0);
    expect(await isRecoveryNeeded()).toBe(true);
  });

  it('zaehlt dieselbe Rolle ohne die Ausnahme wieder als Verwalter', async () => {
    await setze(ADMIN_ROLE, ['admin.full']);

    const pruefung = await checkLockout(ZWEITE_ROLLE, []);
    expect(pruefung.remainingManagerRoles).toBe(1);
    expect(await isRecoveryNeeded()).toBe(false);
  });

  it('erkennt eine geplante Ausnahme auf die Verwaltung als Aussperrung', async () => {
    await setze(ADMIN_ROLE, ['admin.full']);

    // Genau die Aenderung, die der Editor gleich schreiben wuerde.
    const pruefung = await checkLockout(ADMIN_ROLE, ['admin.full'], ['permissions.manage']);
    expect(pruefung.remainingManagerRoles).toBe(0);
  });

  it('laesst eine Ausnahme auf etwas anderes als die Verwaltung zu', async () => {
    await setze(ADMIN_ROLE, ['admin.full']);

    const pruefung = await checkLockout(ADMIN_ROLE, ['admin.full'], ['migration.execute']);
    expect(pruefung.remainingManagerRoles).toBe(1);
    expect(pruefung.wouldLockOut).toBe(false);
  });
});
