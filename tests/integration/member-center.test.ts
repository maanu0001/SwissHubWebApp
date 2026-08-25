import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_member_center');

/**
 * Das Member Center gegen eine echte Datenbank.
 *
 * Geprueft wird vor allem eines: dass ein verbotener Abschnitt nicht in der
 * Antwort steht. Nicht leer, nicht `null` - gar nicht. Ein Test, der nur
 * prueft, ob die Oberflaeche ihn versteckt, wuerde genau die Luecke uebersehen,
 * um die es geht: wer die Antwort direkt abruft, saehe die Daten trotzdem.
 */
const { prisma } = await import('@swisshub/database');
const { members, setModuleEnabled, syncDiscord } = await import('@swisshub/modules');
const { setDiscordGateway, createMockGateway, resolveGuildId, clearGuildIdCache } = await import(
  '@swisshub/discord'
);

let GUILD = '';

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
/** Mitglieder aus dem Mock-Gateway. */
const ANNA = '100000000000000001';
const BEAT = '100000000000000005';

/** Ein Betrachter mit genau den angegebenen Rechten. */
const viewer = (discordId: string, rechte: string[], roleIds: string[] = []) => ({
  discordId,
  roleIds,
  can: (permission: string) => rechte.includes(permission),
});

const OWN = [
  'members.view.basic.own',
  'members.view.level.own',
  'members.view.tickets.own',
  'members.view.premium.own',
  'members.view.tournaments.own',
];

const STAFF = [
  'members.view',
  'members.view.basic.all',
  'members.view.roles.all',
  'members.view.moderation.all',
  'members.view.notes.all',
  'members.notes.create',
];

describeWithDatabase('Member Center', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "MemberNote","JailEntry","ModerationAction","LevelProfile",' +
        '"PremiumSubscription","User","ModuleState" RESTART IDENTITY CASCADE',
    );
    setDiscordGateway(createMockGateway());
    await syncDiscord({ trigger: 'manual' });
    clearGuildIdCache();
    GUILD = await resolveGuildId();
    await setModuleEnabled('members', true, ADMIN.discordId).catch(() => undefined);
  });

  // --- Sichtbarkeit der Abschnitte -----------------------------------------

  it('liefert einem Betrachter ohne jedes Recht gar nichts', async () => {
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, []),
      targetDiscordId: ANNA,
    });
    expect(profil).toBeNull();
  });

  it('lässt Verbotenes nicht in der Antwort stehen', async () => {
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, ['members.view', 'members.view.basic.all']),
      targetDiscordId: ANNA,
    });

    expect(profil).not.toBeNull();
    // Nicht `null`, nicht `[]` - der Schluessel darf gar nicht existieren.
    expect(profil && 'moderation' in profil).toBe(false);
    expect(profil && 'notes' in profil).toBe(false);
    expect(profil && 'level' in profil).toBe(false);
    expect(profil && 'tickets' in profil).toBe(false);
    expect(profil && 'premium' in profil).toBe(false);
  });

  it('liefert die Moderationsakte nur mit dem passenden Recht', async () => {
    await prisma.jailEntry.create({
      data: {
        targetDiscordId: ANNA,
        targetUsername: 'anna',
        moderatorDiscordId: ADMIN.discordId,
        moderatorUsername: ADMIN.username,
        reason: 'Test',
        type: 'TEMPORARY',
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 3600_000),
        status: 'COMPLETED',
      },
    });

    const ohne = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, ['members.view', 'members.view.basic.all']),
      targetDiscordId: ANNA,
    });
    expect(ohne && 'moderation' in ohne).toBe(false);

    const mit = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, STAFF),
      targetDiscordId: ANNA,
    });
    expect(mit?.moderation?.jailHistory).toHaveLength(1);
    expect(mit?.moderation?.jailsGesamt).toBe(1);
  });

  // --- Geltungsbereich OWN --------------------------------------------------

  it('öffnet mit OWN das eigene Profil', async () => {
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(ANNA, OWN),
      targetDiscordId: ANNA,
    });
    expect(profil).not.toBeNull();
    expect(profil?.basic.discordId).toBe(ANNA);
  });

  it('verweigert mit OWN das fremde Profil - auch bei geänderter Adresse', async () => {
    // Genau der Fall aus der Adresszeile: /members/<fremde ID>.
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(ANNA, OWN),
      targetDiscordId: BEAT,
    });
    expect(profil).toBeNull();
  });

  it('zeigt mit OWN das eigene Level, aber keine Moderation', async () => {
    await prisma.levelProfile.create({ data: { discordId: ANNA, xp: 500, messages: 42 } });

    const profil = await members.getMemberCenterProfile({
      viewer: viewer(ANNA, OWN),
      targetDiscordId: ANNA,
    });
    expect(profil?.level?.xp).toBe(500);
    expect(profil && 'moderation' in profil).toBe(false);
    expect(profil && 'notes' in profil).toBe(false);
  });

  it('gibt ALL den Vorrang vor OWN', async () => {
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, ['members.view.basic.all', 'members.view.level.own', 'members.view.level.all']),
      targetDiscordId: ANNA,
    });
    expect(profil && 'level' in profil).toBe(true);
  });

  // --- Altbestand -----------------------------------------------------------

  it('lässt bestehende Moderationsrollen die Akte weiter sehen', async () => {
    // `moderation.view` gab es vor dem Member Center. Wer es hat, verliert
    // beim Deployment nichts.
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, ['members.view', 'members.view.basic.all', 'moderation.view']),
      targetDiscordId: ANNA,
    });
    expect(profil && 'moderation' in profil).toBe(true);
  });

  // --- Notizen --------------------------------------------------------------

  it('schreibt eine Notiz mit dem Autor aus der Sitzung', async () => {
    const betrachter = viewer(ADMIN.discordId, STAFF);
    const notiz = await members.createMemberNote(betrachter, ADMIN, {
      targetDiscordId: ANNA,
      content: '  Mehrfach   verwarnt.  ',
    });

    expect(notiz.author.discordId).toBe(ADMIN.discordId);
    expect(notiz.content).toBe('Mehrfach verwarnt.');

    const gespeichert = await prisma.memberNote.findFirstOrThrow();
    expect(gespeichert.guildId).toBe(GUILD);
    expect(gespeichert.authorDiscordId).toBe(ADMIN.discordId);
  });

  it('verweigert eine Notiz ohne Berechtigung', async () => {
    await expect(
      members.createMemberNote(viewer(BEAT, ['members.view']), { discordId: BEAT, username: 'beat' }, {
        targetDiscordId: ANNA,
        content: 'Sollte nicht gehen',
      }),
    ).rejects.toThrow();
  });

  it('zeigt Notizen niemandem ohne das Recht - auch nicht im eigenen Profil', async () => {
    await members.createMemberNote(viewer(ADMIN.discordId, STAFF), ADMIN, {
      targetDiscordId: ANNA,
      content: 'Intern',
    });

    // Anna selbst hat alle OWN-Rechte - Notizen sind trotzdem nicht dabei.
    const eigenes = await members.getMemberCenterProfile({
      viewer: viewer(ANNA, OWN),
      targetDiscordId: ANNA,
    });
    expect(eigenes && 'notes' in eigenes).toBe(false);
  });

  it('lässt den Verfasser die eigene Notiz ändern, ohne Recht auf fremde', async () => {
    const autor = viewer(ADMIN.discordId, ['members.notes.create', 'members.view.notes.all']);
    const notiz = await members.createMemberNote(autor, ADMIN, {
      targetDiscordId: ANNA,
      content: 'Erste Fassung',
    });

    await members.updateMemberNote(autor, ADMIN, { id: notiz.id, content: 'Zweite Fassung' });
    const danach = await prisma.memberNote.findUniqueOrThrow({ where: { id: notiz.id } });
    expect(danach.content).toBe('Zweite Fassung');
    expect(danach.editedAt).not.toBeNull();

    // Eine fremde Notiz darf derselbe nicht anfassen.
    const fremd = await members.createMemberNote(
      viewer(BEAT, ['members.notes.create']),
      { discordId: BEAT, username: 'beat' },
      { targetDiscordId: ANNA, content: 'Von jemand anderem' },
    );
    await expect(
      members.updateMemberNote(autor, ADMIN, { id: fremd.id, content: 'Übernommen' }),
    ).rejects.toThrow();
  });

  it('trennt Notizen nach Guild', async () => {
    await members.createMemberNote(viewer(ADMIN.discordId, STAFF), ADMIN, {
      targetDiscordId: ANNA,
      content: 'Guild A',
    });
    // Eine Zeile einer anderen Guild darf nie erscheinen.
    await prisma.memberNote.create({
      data: {
        guildId: '999999999999999999',
        targetDiscordId: ANNA,
        authorDiscordId: ADMIN.discordId,
        authorUsername: ADMIN.username,
        content: 'Guild B',
      },
    });

    const sichtbar = await members.listMemberNotes(viewer(ADMIN.discordId, STAFF), ANNA, GUILD);
    expect(sichtbar).toHaveLength(1);
    expect(sichtbar[0]?.content).toBe('Guild A');
  });

  // --- Rollen ---------------------------------------------------------------

  it('bietet ohne Berechtigung keine Rollen an', async () => {
    const angebot = await members.rollenAngebot(viewer(BEAT, ['members.view']), {
      discordId: ANNA,
      roleIds: [],
    });
    expect(angebot).toEqual([]);
  });

  it('verweigert Rollen über der eigenen Höhe', async () => {
    const rollen = await (await import('@swisshub/discord')).discord.roles.list();
    const hoechste = [...rollen].sort((a, b) => b.position - a.position)[0];
    expect(hoechste).toBeDefined();

    await expect(
      members.grantMemberRole({
        // Betrachter ohne eigene Rollen - seine Hoehe ist 0.
        viewer: viewer(BEAT, ['members.roles.manage'], []),
        actor: { discordId: BEAT, username: 'beat' },
        targetDiscordId: ANNA,
        roleId: hoechste!.id,
      }),
    ).rejects.toThrow();
  });

  it('lässt niemanden die eigenen Rollen ändern', async () => {
    const rollen = await (await import('@swisshub/discord')).discord.roles.list();
    const irgendeine = rollen.find((rolle) => rolle.position > 0);
    expect(irgendeine).toBeDefined();

    await expect(
      members.grantMemberRole({
        viewer: viewer(ANNA, ['members.roles.manage']),
        actor: { discordId: ANNA, username: 'anna' },
        targetDiscordId: ANNA,
        roleId: irgendeine!.id,
      }),
    ).rejects.toThrow();
  });

  // --- Ausfall einzelner Quellen -------------------------------------------

  it('lädt das Profil weiter, wenn eine Quelle ausfällt', async () => {
    await prisma.levelProfile.create({ data: { discordId: ANNA, xp: 100 } });
    // Ohne Benutzerzeile kaeme der Premium-Abschnitt gar nicht bis zur
    // Abfrage - er liefe sauber ins Leere statt zu scheitern, und der Test
    // pruefte nichts.
    await prisma.user.create({ data: { discordId: ANNA, username: 'anna' } });

    // Die Premium-Tabelle wegnehmen: der Abschnitt scheitert, der Rest nicht.
    await prisma.$executeRawUnsafe('ALTER TABLE "PremiumSubscription" RENAME TO "PremiumSubscription_weg"');
    try {
      const profil = await members.getMemberCenterProfile({
        viewer: viewer(BEAT, [
          'members.view',
          'members.view.basic.all',
          'members.view.level.all',
          'members.view.premium.all',
        ]),
        targetDiscordId: ANNA,
      });

      expect(profil).not.toBeNull();
      expect(profil?.level?.xp).toBe(100);
      expect(profil?.fehler.map((eintrag) => eintrag.section)).toContain('premium');
      expect(profil && 'premium' in profil).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "PremiumSubscription_weg" RENAME TO "PremiumSubscription"');
    }
  });

  // --- Mitglied nicht mehr auf dem Server -----------------------------------

  it('zeigt historische Daten, wenn das Mitglied den Server verlassen hat', async () => {
    const WEG = '400000000000000999';
    await prisma.jailEntry.create({
      data: {
        targetDiscordId: WEG,
        targetUsername: 'ehemalig',
        moderatorDiscordId: ADMIN.discordId,
        moderatorUsername: ADMIN.username,
        reason: 'Damals',
        type: 'TEMPORARY',
        startedAt: new Date(),
        endsAt: new Date(),
        status: 'COMPLETED',
      },
    });

    const profil = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, STAFF),
      targetDiscordId: WEG,
    });

    expect(profil).not.toBeNull();
    expect(profil?.imServer).toBe(false);
    expect(profil?.moderation?.jailHistory).toHaveLength(1);
  });

  // --- Fähigkeiten ----------------------------------------------------------

  it('meldet nur Fähigkeiten, die der Betrachter wirklich hat', async () => {
    const profil = await members.getMemberCenterProfile({
      viewer: viewer(BEAT, [...STAFF, 'jail.create']),
      targetDiscordId: ANNA,
    });

    expect(profil?.capabilities.canJail).toBe(true);
    expect(profil?.capabilities.canCreateNote).toBe(true);
    expect(profil?.capabilities.canManageRoles).toBe(false);
    expect(profil?.capabilities.canManageXp).toBe(false);
    expect(profil?.capabilities.canManagePremium).toBe(false);
  });
});
