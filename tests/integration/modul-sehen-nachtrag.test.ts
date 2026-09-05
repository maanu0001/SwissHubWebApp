import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_modul_sehen');

/**
 * Der Nachtrag der «Modul sehen»-Berechtigungen gegen eine echte Datenbank.
 *
 * Das ist die riskanteste Zeile dieses ganzen Vorhabens: läuft sie nicht,
 * verliert nach dem Deployment jede bestehende Rolle ihre Navigation - und
 * niemand kommt mehr an die Stelle, an der sich das beheben liesse. Deshalb
 * gegen echtes Postgres und nicht gegen eine Nachbildung: die
 * Eindeutigkeit von `(discordRoleId, permission)` und das Verhalten von
 * `createMany({ skipDuplicates })` sind Datenbankeigenschaften.
 */
const { prisma } = await import('@swisshub/database');
const { backfillModuleViewPermissions, buildNavigation, listModuleDefinitions } = await import(
  '@swisshub/modules'
);

const ADMIN = '900000000000001001';
const MODERATOR = '900000000000001002';
const PREMIUM = '900000000000001003';
const MITGLIED = '900000000000001004';
const WILDCARD = '900000000000001005';
const NIEMAND = '900000000000001006';

const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));

async function rolle(discordRoleId: string, label: string, permissions: string[]) {
  await prisma.managedRole.create({ data: { discordRoleId, label } });
  if (permissions.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ discordRoleId, permission })),
    });
  }
}

async function rechte(discordRoleId: string): Promise<string[]> {
  const zeilen = await prisma.rolePermission.findMany({
    where: { discordRoleId },
    select: { permission: true },
  });
  return zeilen.map((zeile) => zeile.permission);
}

/** Welche Module diese Rolle in der Seitenleiste sieht. */
async function sichtbareModule(discordRoleId: string): Promise<Set<string>> {
  return new Set(
    buildNavigation(await rechte(discordRoleId), ALLE_MODULE).map((eintrag) => eintrag.moduleId),
  );
}

describeWithDatabase('«Modul sehen» nachtragen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "RolePermission","ManagedRole","SystemConfig" RESTART IDENTITY CASCADE',
    );

    await rolle(ADMIN, 'Administrator', ['admin.full']);
    await rolle(MODERATOR, 'Moderator', [
      'dashboard.view',
      'members.view',
      'moderation.view',
      'jail.view',
      'jail.create',
    ]);
    // Genau die Ausgangslage aus der Aufgabe: Vote Jail ja, Jail-Akte nein.
    await rolle(PREMIUM, 'Premium', [
      'dashboard.view',
      'music.view',
      'music.queue.manage',
      'jail.vote.start',
      'voiceHub.view',
    ]);
    await rolle(MITGLIED, 'Mitglied', ['dashboard.view', 'level.view', 'tickets.viewOwn']);
    await rolle(WILDCARD, 'Musikteam', ['dashboard.view', 'music.*']);
    await rolle(NIEMAND, 'Ohne Rechte', []);
  });

  it('gibt jeder Rolle genau die Bereiche zurück, die sie vorher sah', async () => {
    // Vor dem Nachtrag: die Seitenleiste ist leer, weil der neue Schlüssel
    // niemandem gehört. Genau der Zustand, den der Nachtrag verhindern soll.
    expect((await sichtbareModule(MODERATOR)).size).toBe(0);

    await backfillModuleViewPermissions();

    const moderator = await sichtbareModule(MODERATOR);
    expect(moderator).toContain('dashboard');
    expect(moderator).toContain('members');
    expect(moderator).toContain('moderation');
    expect(moderator).toContain('jail');
    // Und nichts, was er vorher nicht sah.
    expect(moderator).not.toContain('music');
    expect(moderator).not.toContain('tickets');
  });

  it('gibt Premium den Jail-Bereich über die Abstimmung - nicht die Akte', async () => {
    await backfillModuleViewPermissions();

    // «Modul sehen» kommt, weil `jail.vote.start` den Eintrag früher zeigte.
    expect(await rechte(PREMIUM)).toContain('jail.module.view');
    // Aber nicht das Recht, die Akte zu lesen.
    expect(await rechte(PREMIUM)).not.toContain('jail.view');

    // Der Eintrag führt entsprechend zu den Abstimmungen, nicht zur Übersicht.
    const eintraege = buildNavigation(await rechte(PREMIUM), ALLE_MODULE).filter(
      (eintrag) => eintrag.moduleId === 'jail',
    );
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.href).toBe('/jail/votes');
  });

  it('lässt admin.full unangetastet', async () => {
    // Vollzugriff braucht keinen Eintrag - `hasPermission` lässt ihn ohnehin
    // durch. Eine Zeile dafür wäre nur Ballast.
    await backfillModuleViewPermissions();
    expect(await rechte(ADMIN)).toEqual(['admin.full']);
  });

  it('deckt Wildcards ab, ohne eine Zeile zu schreiben', async () => {
    await backfillModuleViewPermissions();
    const musikteam = await rechte(WILDCARD);

    // `music.*` schliesst `music.module.view` bereits ein - eine zusätzliche
    // Zeile wäre überflüssig.
    expect(musikteam).not.toContain('music.module.view');
    // Für `dashboard.view` gibt es keine Wildcard, also wird nachgetragen.
    expect(musikteam).toContain('dashboard.module.view');
  });

  it('gibt einer Rolle ohne Rechte nichts', async () => {
    await backfillModuleViewPermissions();
    expect(await rechte(NIEMAND)).toEqual([]);
  });

  it('vergibt nur, was ein früher sichtbarer Eintrag rechtfertigt', async () => {
    await backfillModuleViewPermissions();
    const mitglied = await rechte(MITGLIED);

    expect(mitglied).toContain('dashboard.module.view');
    expect(mitglied).toContain('level.module.view');
    expect(mitglied).toContain('tickets.module.view');
    expect(mitglied).not.toContain('jail.module.view');
    expect(mitglied).not.toContain('moderation.module.view');
    expect(mitglied).not.toContain('members.module.view');
  });

  it('läuft genau einmal', async () => {
    const erste = await backfillModuleViewPermissions();
    expect(erste.vergeben).toBeGreaterThan(0);
    expect(erste.uebersprungen).toBe(false);

    // Jeder Start ruft ihn auf; ab dem zweiten Mal tut er nichts.
    const zweite = await backfillModuleViewPermissions();
    expect(zweite).toEqual({ vergeben: 0, rollen: 0, uebersprungen: true });
  });

  it('gibt einen bewusst entzogenen Schlüssel nicht zurück', async () => {
    await backfillModuleViewPermissions();
    await prisma.rolePermission.deleteMany({
      where: { discordRoleId: MODERATOR, permission: 'jail.module.view' },
    });

    await backfillModuleViewPermissions();

    // Der Nachtrag ist keine Dauerüberwachung: wer den Bereich absichtlich
    // schliesst, findet ihn beim nächsten Start nicht wieder offen.
    expect(await rechte(MODERATOR)).not.toContain('jail.module.view');
  });

  it('ist auch beim erzwungenen Lauf wiederholbar', async () => {
    // Zwei Instanzen können gleichzeitig starten - der zweite Lauf darf
    // weder doppelte Zeilen anlegen noch scheitern.
    await backfillModuleViewPermissions();
    const vorher = (await rechte(MODERATOR)).sort();

    const zweite = await backfillModuleViewPermissions({ erzwingen: true });
    expect(zweite.vergeben).toBe(0);
    expect((await rechte(MODERATOR)).sort()).toEqual(vorher);
  });

  it('vermerkt seine Herkunft an den angelegten Zeilen', async () => {
    await backfillModuleViewPermissions();
    const zeile = await prisma.rolePermission.findFirstOrThrow({
      where: { discordRoleId: MODERATOR, permission: 'jail.module.view' },
    });
    expect(zeile.createdBy).toBe('module-view-backfill');
  });
});
