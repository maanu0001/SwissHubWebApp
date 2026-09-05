import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil_bezeichnung');

/**
 * Die «Bezeichnung im Dashboard» oben rechts im Profil.
 *
 * Eine Rolle kann auf Discord «Moderator» heissen und im Dashboard
 * «Teamleitung». Gepflegt wird das im Berechtigungseditor; das Profil liest
 * es nur. Genau darum geht es hier: dass es *gelesen* und nicht ein zweites
 * Mal gespeichert wird - zwei Kopien laufen auseinander, und dann stimmt eine
 * von beiden nicht.
 */
const { prisma } = await import('@swisshub/database');
const { dashboardRoleLabel, invalidateRoleConfiguration } = await import('@swisshub/permissions');

const TEAM = '900000000000003001';
const SUPPORT = '900000000000003002';
const OHNE_NAMEN = '900000000000003003';

async function rolle(discordRoleId: string, label: string, moderationLevel = 0) {
  await prisma.managedRole.create({ data: { discordRoleId, label, moderationLevel } });
  invalidateRoleConfiguration();
}

describeWithDatabase('Bezeichnung im Dashboard', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "RolePermission","ManagedRole" RESTART IDENTITY CASCADE',
    );
    invalidateRoleConfiguration();
  });

  it('nimmt die Bezeichnung der verwalteten Rolle', async () => {
    await rolle(TEAM, 'Teamleitung', 70);
    expect(await dashboardRoleLabel([TEAM])).toBe('Teamleitung');
  });

  it('nimmt bei mehreren Rollen die mit der höchsten Stufe', async () => {
    await rolle(SUPPORT, 'Supporter', 40);
    await rolle(TEAM, 'Teamleitung', 70);
    expect(await dashboardRoleLabel([SUPPORT, TEAM])).toBe('Teamleitung');
    // Die Reihenfolge der Rollen am Mitglied darf nichts ändern.
    expect(await dashboardRoleLabel([TEAM, SUPPORT])).toBe('Teamleitung');
  });

  it('entscheidet bei Gleichstand nicht zufällig', async () => {
    await rolle(SUPPORT, 'Zweite', 10);
    await rolle(TEAM, 'Erste', 10);
    // Zweimal gefragt, zweimal dieselbe Antwort - sonst trüge dieselbe Person
    // bei jedem Seitenaufruf eine andere Bezeichnung.
    expect(await dashboardRoleLabel([SUPPORT, TEAM])).toBe('Erste');
    expect(await dashboardRoleLabel([TEAM, SUPPORT])).toBe('Erste');
  });

  it('gibt null zurück, wenn keine Rolle verwaltet wird', async () => {
    // Der Aufrufer setzt dann seinen bisherigen Text ein - eine leere Anzeige
    // wäre schlechter als eine ungenaue.
    expect(await dashboardRoleLabel(['900000000000003099'])).toBeNull();
    expect(await dashboardRoleLabel([])).toBeNull();
  });

  it('überspringt eine Rolle ohne Bezeichnung', async () => {
    await prisma.managedRole.create({
      data: { discordRoleId: OHNE_NAMEN, label: '   ', moderationLevel: 90 },
    });
    await rolle(TEAM, 'Teamleitung', 10);
    expect(await dashboardRoleLabel([OHNE_NAMEN, TEAM])).toBe('Teamleitung');
  });

  it('folgt einer Änderung im Berechtigungsmodul', async () => {
    await rolle(TEAM, 'Teamleitung', 70);
    expect(await dashboardRoleLabel([TEAM])).toBe('Teamleitung');

    await prisma.managedRole.update({
      where: { discordRoleId: TEAM },
      data: { label: 'Serverleitung' },
    });
    invalidateRoleConfiguration();

    // Keine zweite Kopie am Benutzer: die Änderung wirkt sofort.
    expect(await dashboardRoleLabel([TEAM])).toBe('Serverleitung');
  });

  it('speichert nichts am Benutzer', async () => {
    // Die Bezeichnung darf nirgends dupliziert werden - sie steht genau an
    // einer Stelle, und das ist die verwaltete Rolle.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const schema = readFileSync(
      join(process.cwd(), 'packages/database/prisma/schema.prisma'),
      'utf8',
    );
    const modell = schema.slice(schema.indexOf('model User {'), schema.indexOf('model Session {'));
    expect(modell).not.toContain('dashboardLabel');
    expect(modell).not.toContain('primaryRole');
  });
});
