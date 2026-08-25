import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_voice_hub');

/**
 * Der Voice Hub gegen eine echte Datenbank.
 *
 * Geprueft wird, was sich nur hier pruefen laesst: dass zwei schnell
 * aufeinanderfolgende Beitritte nur einen Talk erzeugen, dass ein leerer Talk
 * erst nach der Schonfrist verschwindet und ein Rueckkehrer das verhindert,
 * dass ein verwaister Talk an den naechsten Anwesenden geht - und dass ein
 * Fremder mit einer Kanalkennung aus dem Browser nichts ausrichtet.
 */
const { prisma } = await import('@swisshub/database');
const { voice, voiceHub, setModuleEnabled, syncDiscord, writeModuleSettings } = await import(
  '@swisshub/modules'
);
const { setDiscordGateway, createMockGateway, resolveGuildId, clearGuildIdCache } = await import(
  '@swisshub/discord'
);

let GUILD = '';
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const KATEGORIE = '700000000000000010'; // Kategorie "Moderation" im Mock
const HUB_KANAL = '700000000000000020';

/** Ein Betrachter mit genau den angegebenen Rechten. */
const viewer = (discordId: string, rechte: string[]) => ({
  discordId,
  can: (permission: string) => rechte.includes(permission),
});

const kontext = (discordId: string, username: string, rechte: string[]) => ({
  viewer: viewer(discordId, rechte),
  actor: { discordId, username, source: 'WEBAPP' as const },
});

/** Alle Rechte des eigenen Talks - fuer Faelle, in denen sie nicht der Punkt sind. */
const EIGENE_RECHTE = [
  'voiceHub.view',
  'voiceHub.use',
  'voiceHub.manageOwn',
  'voiceHub.manageUsers',
  'voiceHub.transferOwnership',
];

async function preset(name = 'Standard', werte: Record<string, unknown> = {}) {
  return prisma.voicePreset.create({
    data: {
      guildId: GUILD,
      name,
      nameTemplate: "🔊 {username}'s Talk",
      userLimit: 0,
      maxUserLimit: 10,
      deleteGraceSeconds: 30,
      renameCooldownSeconds: 300,
      ownerModeration: true,
      ...werte,
    },
  });
}

async function hub(presetId: string, werte: Record<string, unknown> = {}) {
  return prisma.voiceHub.create({
    data: {
      guildId: GUILD,
      name: 'Eigenen Talk erstellen',
      discordChannelId: HUB_KANAL,
      targetCategoryId: KATEGORIE,
      presetId,
      enabled: true,
      ...werte,
    },
  });
}

/** Ein Beitritt, wie ihn der Bot meldet. */
const beitritt = (
  discordId: string,
  username: string,
  werte: Partial<Parameters<typeof voiceHub.handleHubJoin>[0]> = {},
) => ({
  discordId,
  username,
  displayName: username,
  roleIds: [] as string[],
  isBot: false,
  channelId: HUB_KANAL,
  darfNutzen: true,
  ...werte,
});

/** Jemanden in einen Kanal setzen - der Bot schreibt das sonst aus dem Gateway. */
async function anwesend(discordId: string, channelId: string, isBot = false) {
  await prisma.voicePresence.upsert({
    where: { discordId },
    create: { discordId, guildId: GUILD, channelId, isBot },
    update: { channelId, isBot },
  });
}

describeWithDatabase('Voice Hub', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "TemporaryVoiceAccess","TemporaryVoiceChannel","VoiceHubEvent",' +
        '"VoiceTrustedMember","VoiceUserPreference","VoiceHub","VoicePreset",' +
        '"VoicePresence","ModuleState" RESTART IDENTITY CASCADE',
    );
    setDiscordGateway(createMockGateway());
    await syncDiscord({ trigger: 'manual' });
    clearGuildIdCache();
    GUILD = await resolveGuildId();
    await setModuleEnabled(voiceHub.VOICE_HUB_MODULE_ID, true, ADMIN.discordId);
    await writeModuleSettings(
      voiceHub.VOICE_HUB_MODULE_ID,
      { maxActivePerUser: 1, defaultDeleteGraceSeconds: 30, controlPanelEnabled: false },
      ADMIN,
    );
  });

  // --- Erstellen -----------------------------------------------------------

  it('erzeugt beim Betreten des Hubs einen Talk und verschiebt hinein', async () => {
    const p = await preset();
    await hub(p.id);

    const ergebnis = await voiceHub.handleHubJoin(beitritt('900000000000001001', 'anna'));

    expect(ergebnis.art).toBe('ERSTELLT');
    if (ergebnis.art !== 'ERSTELLT') {
      return;
    }
    expect(ergebnis.kanal.discordChannelId).not.toBeNull();
    expect(ergebnis.kanal.ownerDiscordId).toBe('900000000000001001');
    expect(ergebnis.kanal.name).toContain('anna');
    expect(ergebnis.kanal.source).toBe('VOICE_HUB');
  });

  it('erzeugt bei zwei gleichzeitigen Beitritten nur einen Talk', async () => {
    const p = await preset();
    await hub(p.id);

    // Discord schickt `VoiceStateUpdate` durchaus mehrfach. Ohne den
    // Teilindex bekaeme diese Person zwei Kanaele.
    const [a, b] = await Promise.all([
      voiceHub.handleHubJoin(beitritt('900000000000001011', 'beat')),
      voiceHub.handleHubJoin(beitritt('900000000000001011', 'beat')),
    ]);

    const offen = await prisma.temporaryVoiceChannel.count({
      where: { ownerDiscordId: '900000000000001011', closedAt: null },
    });
    expect(offen).toBe(1);
    expect([a.art, b.art].sort()).not.toContain('ABGELEHNT');
  });

  it('schickt bei erneutem Betreten in den bestehenden Talk zurück', async () => {
    const p = await preset();
    await hub(p.id);

    const erst = await voiceHub.handleHubJoin(beitritt('900000000000001021', 'carla'));
    const zweit = await voiceHub.handleHubJoin(beitritt('900000000000001021', 'carla'));

    expect(erst.art).toBe('ERSTELLT');
    expect(zweit.art).toBe('VORHANDEN');
    if (erst.art === 'ERSTELLT' && zweit.art === 'VORHANDEN') {
      expect(zweit.kanal.id).toBe(erst.kanal.id);
    }
  });

  it('lässt Bots keinen Talk auslösen', async () => {
    const p = await preset();
    await hub(p.id);

    const ergebnis = await voiceHub.handleHubJoin(
      beitritt('900000000000001031', 'musikbot', { isBot: true }),
    );
    expect(ergebnis.art).toBe('KEIN_HUB');
  });

  it('weist ohne Berechtigung ab', async () => {
    const p = await preset();
    await hub(p.id);

    const ergebnis = await voiceHub.handleHubJoin(
      beitritt('900000000000001041', 'david', { darfNutzen: false }),
    );
    expect(ergebnis.art).toBe('ABGELEHNT');
  });

  it('achtet auf gesperrte Rollen des Hubs', async () => {
    const p = await preset();
    await hub(p.id, { blockedRoleIds: ['900000000000000009'] });

    const ergebnis = await voiceHub.handleHubJoin(
      beitritt('900000000000001051', 'eva', { roleIds: ['900000000000000009'] }),
    );
    expect(ergebnis.art).toBe('ABGELEHNT');
  });

  it('übernimmt Voreinstellungen nur mit ausdrücklicher Zustimmung', async () => {
    const p = await preset();
    await hub(p.id);
    await prisma.voiceUserPreference.create({
      data: {
        guildId: GUILD,
        discordId: '900000000000001061',
        preferredName: 'Manuels Stübli',
        preferredLimit: 6,
        // Der Schalter steht aus - gespeichert ist etwas, angewendet nichts.
        applyPreferences: false,
      },
    });

    const ergebnis = await voiceHub.handleHubJoin(beitritt('900000000000001061', 'manuel'));
    expect(ergebnis.art).toBe('ERSTELLT');
    if (ergebnis.art === 'ERSTELLT') {
      expect(ergebnis.kanal.name).not.toBe('Manuels Stübli');
    }

    await prisma.voiceUserPreference.update({
      where: { guildId_discordId: { guildId: GUILD, discordId: '900000000000001061' } },
      data: { applyPreferences: true },
    });
    await voiceHub.deleteTalk(
      kontext('900000000000001061', 'manuel', EIGENE_RECHTE),
      (ergebnis as { kanal: { id: string } }).kanal.id,
    );

    const zweiter = await voiceHub.handleHubJoin(beitritt('900000000000001061', 'manuel'));
    expect(zweiter.art).toBe('ERSTELLT');
    if (zweiter.art === 'ERSTELLT') {
      expect(zweiter.kanal.name).toBe('Manuels Stübli');
      expect(zweiter.kanal.userLimit).toBe(6);
    }
  });

  // --- Verwalten -----------------------------------------------------------

  it('lässt den Besitzer seinen Talk verwalten', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002001', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000002001', 'anna', EIGENE_RECHTE);

    const umbenannt = await voiceHub.renameTalk(k, erstellt.kanal.id, 'Annas Runde');
    expect(umbenannt.name).toBe('Annas Runde');

    const gesperrt = await voiceHub.setTalkLocked(k, erstellt.kanal.id, true);
    expect(gesperrt.locked).toBe(true);

    const versteckt = await voiceHub.setTalkHidden(k, erstellt.kanal.id, true);
    expect(versteckt.hidden).toBe(true);
    // Sperre und Sichtbarkeit sind getrennt - das eine setzt das andere nicht.
    expect(versteckt.locked).toBe(true);

    const limitiert = await voiceHub.setTalkLimit(k, erstellt.kanal.id, 4);
    expect(limitiert.userLimit).toBe(4);
  });

  it('lässt einen Fremden den Talk nicht anfassen', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002011', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    // Alle Rechte fuer den *eigenen* Talk - dieser gehoert ihm aber nicht.
    const fremd = kontext('900000000000002012', 'beat', EIGENE_RECHTE);

    await expect(voiceHub.renameTalk(fremd, erstellt.kanal.id, 'Meiner jetzt')).rejects.toThrow();
    await expect(voiceHub.setTalkLocked(fremd, erstellt.kanal.id, true)).rejects.toThrow();
    await expect(voiceHub.deleteTalk(fremd, erstellt.kanal.id)).rejects.toThrow();
  });

  it('verrät einem Fremden nicht, dass es den Talk gibt', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002021', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    const fremd = kontext('900000000000002022', 'beat', EIGENE_RECHTE);
    // Dieselbe Meldung wie bei einem Talk, den es nicht gibt.
    await expect(
      voiceHub.ladeKanalMitZugriff(fremd.viewer, erstellt.kanal.id, GUILD),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      voiceHub.ladeKanalMitZugriff(fremd.viewer, 'cmt0000000000000000000000', GUILD),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('trennt Talks anderer Server', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002031', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000002031', 'anna', EIGENE_RECHTE);

    // Dieselbe Kennung, aber ein anderer Server: nicht auffindbar.
    await expect(
      voiceHub.ladeKanalMitZugriff(k.viewer, erstellt.kanal.id, '111111111111111111'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lässt die Verwaltung fremde Talks verwalten', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002041', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    const admin = kontext('900000000000002042', 'mod', [
      'voiceHub.admin.view',
      'voiceHub.admin.manage',
    ]);
    const umbenannt = await voiceHub.renameTalk(admin, erstellt.kanal.id, 'Von der Leitung');
    expect(umbenannt.name).toBe('Von der Leitung');
    // Der Besitzer bleibt der Besitzer.
    expect(umbenannt.ownerDiscordId).toBe('900000000000002041');
  });

  it('lässt nur schliessen, wer es darf', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002051', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    // Ansehen und verwalten, aber nicht schliessen.
    const halb = kontext('900000000000002052', 'mod', ['voiceHub.admin.view']);
    await expect(voiceHub.deleteTalk(halb, erstellt.kanal.id)).rejects.toThrow();

    const ganz = kontext('900000000000002053', 'mod2', [
      'voiceHub.admin.view',
      'voiceHub.admin.delete',
    ]);
    await voiceHub.deleteTalk(ganz, erstellt.kanal.id);
    const danach = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(danach.closedAt).not.toBeNull();
  });

  it('bremst häufiges Umbenennen', async () => {
    const p = await preset('Mit Bremse', { renameCooldownSeconds: 600 });
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002061', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000002061', 'anna', EIGENE_RECHTE);

    await voiceHub.renameTalk(k, erstellt.kanal.id, 'Erster Name');
    // Discord laesst zwei Umbenennungen je zehn Minuten zu - danach trifft das
    // Rate-Limit den Bot, nicht die Person.
    await expect(voiceHub.renameTalk(k, erstellt.kanal.id, 'Zweiter Name')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('hält sich an das Höchstlimit des Presets', async () => {
    const p = await preset('Duo', { userLimit: 2, maxUserLimit: 4 });
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000002071', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000002071', 'anna', EIGENE_RECHTE);

    await expect(voiceHub.setTalkLimit(k, erstellt.kanal.id, 9)).rejects.toThrow();
    const erlaubt = await voiceHub.setTalkLimit(k, erstellt.kanal.id, 4);
    expect(erlaubt.userLimit).toBe(4);
  });

  // --- Zugriff -------------------------------------------------------------

  it('lässt den Besitzer jemanden zulassen und sperren', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000003001', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000003001', 'anna', EIGENE_RECHTE);

    await voiceHub.allowInTalk(k, erstellt.kanal.id, {
      discordId: '900000000000003002',
      username: 'beat',
    });
    await voiceHub.denyInTalk(k, erstellt.kanal.id, {
      discordId: '900000000000003003',
      username: 'carla',
    });

    const ausnahmen = await prisma.temporaryVoiceAccess.findMany({
      where: { channelId: erstellt.kanal.id },
      orderBy: { discordId: 'asc' },
    });
    expect(ausnahmen.map((eintrag) => eintrag.kind)).toEqual(['ALLOW', 'DENY']);
  });

  it('lässt den Besitzer sich nicht selbst sperren', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000003011', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000003011', 'anna', EIGENE_RECHTE);

    await expect(
      voiceHub.denyInTalk(k, erstellt.kanal.id, { discordId: '900000000000003011' }),
    ).rejects.toThrow();
  });

  it('wirft niemanden aus einem fremden Kanal', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000003021', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000003021', 'anna', EIGENE_RECHTE);

    // Die Person sitzt in einem ganz anderen Kanal. Ohne die Pruefung koennte
    // der Besitzer eines Talks jemanden irgendwo trennen.
    await anwesend('900000000000003022', '700000000000000099');
    const entfernt = await voiceHub.kickFromTalk(k, erstellt.kanal.id, '900000000000003022');
    expect(entfernt).toBe(false);
  });

  // --- Besitz --------------------------------------------------------------

  it('übergibt den Talk und nimmt dem alten Besitzer die Rechte', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000004001', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000004001', 'anna', EIGENE_RECHTE);

    const uebergeben = await voiceHub.transferTalk(k, erstellt.kanal.id, {
      discordId: '100000000000000005',
      username: 'alpenfuchs',
    });
    expect(uebergeben.ownerDiscordId).toBe('100000000000000005');

    // Der alte Besitzer kann jetzt nichts mehr.
    await expect(voiceHub.renameTalk(k, erstellt.kanal.id, 'Doch wieder meiner')).rejects.toThrow();
  });

  it('lässt zwei gleichzeitige Übergaben nicht beide gewinnen', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000004011', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000004011', 'anna', EIGENE_RECHTE);

    const ergebnisse = await Promise.allSettled([
      voiceHub.transferTalk(k, erstellt.kanal.id, {
        discordId: '100000000000000005',
        username: 'alpenfuchs',
      }),
      voiceHub.transferTalk(k, erstellt.kanal.id, {
        discordId: '100000000000000006',
        username: 'roeschti',
      }),
    ]);

    const gelungen = ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled');
    expect(gelungen).toHaveLength(1);

    const danach = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(['100000000000000005', '100000000000000006']).toContain(danach.ownerDiscordId);
  });

  it('lässt den früheren Besitzer nach einer Übergabe wieder beitreten', async () => {
    // Der Schluessel "ein Beitritt, ein Talk" folgt dem Besitz. Bliebe er beim
    // Erzeuger haengen, widerspraeche die Datenbank dem Beitritt: anna besitzt
    // nichts mehr und bekaeme trotzdem zu hoeren, sie habe hier schon einen.
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000004031', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000004031', 'anna', EIGENE_RECHTE);
    await voiceHub.transferTalk(k, erstellt.kanal.id, {
      discordId: '100000000000000005',
      username: 'alpenfuchs',
    });

    const erneut = await voiceHub.handleHubJoin(beitritt('900000000000004031', 'anna'));
    expect(erneut.art).toBe('ERSTELLT');
  });

  it('übergibt keinen zweiten Talk an denselben Besitzer im selben Hub', async () => {
    const p = await preset();
    const h = await hub(p.id);
    const meiner = await voiceHub.handleHubJoin(beitritt('900000000000004041', 'anna'));
    const seiner = await voiceHub.handleHubJoin(beitritt('900000000000004042', 'beat'));
    if (meiner.art !== 'ERSTELLT' || seiner.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    expect(meiner.kanal.hubId).toBe(h.id);

    // beat besitzt hier schon einen - zwei koennen ihm nicht gehoeren.
    const k = kontext('900000000000004041', 'anna', EIGENE_RECHTE);
    await expect(
      voiceHub.transferTalk(k, meiner.kanal.id, {
        discordId: '900000000000004042',
        username: 'beat',
      }),
    ).rejects.toThrow(/bereits einen Talk/u);

    // Und der Talk gehoert unveraendert anna.
    const danach = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: meiner.kanal.id },
    });
    expect(danach.ownerDiscordId).toBe('900000000000004041');
  });

  it('startet die Schonfrist für einen Besitzer, der gar nicht im Talk sitzt', async () => {
    // Nach einer Übergabe an jemanden, der nie im Kanal war, feuert kein
    // `VoiceStateUpdate` - ohne den Abgleich bliebe der Talk auf Dauer bei
    // einem abwesenden Besitzer.
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000004051', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    // Jemand anderes ist im Kanal, damit er nicht als leer gilt.
    await anwesend('900000000000004052', erstellt.kanal.discordChannelId!);
    const k = kontext('900000000000004051', 'anna', EIGENE_RECHTE);
    await voiceHub.transferTalk(k, erstellt.kanal.id, {
      discordId: '100000000000000005',
      username: 'alpenfuchs',
    });

    const vorher = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(vorher.ownerLeftAt).toBeNull();

    await voice.reconcileTemporaryVoices();

    const nachher = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(nachher.ownerLeftAt).not.toBeNull();
  });

  it('gibt einem Bot keinen Talk', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000004021', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }
    const k = kontext('900000000000004021', 'anna', EIGENE_RECHTE);

    // `100000000000000900` ist im Mock der Bot.
    const botId = (await (await import('@swisshub/discord')).discord.bot.identity()).id;
    await anwesend(botId, erstellt.kanal.discordChannelId!, true);

    await expect(
      voiceHub.transferTalk(k, erstellt.kanal.id, { discordId: botId, username: 'SwissHub' }),
    ).rejects.toThrow();
  });

  // --- Lebenszyklus --------------------------------------------------------

  it('löscht einen leeren Talk erst nach der Schonfrist', async () => {
    const p = await preset('Kurz', { deleteGraceSeconds: 30 });
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000005001', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    await voice.planeLoeschung(erstellt.kanal, 30);
    await voice.reconcileTemporaryVoices();

    // Noch nicht faellig - der Talk steht.
    let stand = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(stand.closedAt).toBeNull();
    expect(stand.deleteScheduledAt).not.toBeNull();

    // Faellig stellen und noch einmal abgleichen.
    await prisma.temporaryVoiceChannel.update({
      where: { id: erstellt.kanal.id },
      data: { deleteScheduledAt: new Date(Date.now() - 1000) },
    });
    await voice.reconcileTemporaryVoices();

    stand = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(stand.closedAt).not.toBeNull();
  });

  it('bläst das Löschen ab, wenn jemand zurückkommt', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000005011', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    await voice.planeLoeschung(erstellt.kanal, 30);
    await voice.haltePlanungAn(erstellt.kanal.id);

    const stand = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(stand.deleteScheduledAt).toBeNull();
  });

  it('übergibt einen verwaisten Talk an den nächsten Anwesenden', async () => {
    const p = await preset('Schnell', { deleteGraceSeconds: 0 });
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000005021', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    // Der Besitzer ist weg, jemand anderes sitzt noch drin.
    await anwesend('100000000000000005', erstellt.kanal.discordChannelId!);
    await voice.merkeBesitzerFort(erstellt.kanal.id);
    await prisma.temporaryVoiceChannel.update({
      where: { id: erstellt.kanal.id },
      data: { ownerLeftAt: new Date(Date.now() - 60_000) },
    });

    await voice.reconcileTemporaryVoices();

    const danach = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(danach.ownerDiscordId).toBe('100000000000000005');
    expect(danach.closedAt).toBeNull();

    const ereignis = await prisma.voiceHubEvent.findFirst({
      where: { channelId: erstellt.kanal.id, kind: 'OWNER_AUTO_TRANSFERRED' },
    });
    expect(ereignis).not.toBeNull();
  });

  it('schliesst die Zeile, wenn der Kanal auf Discord verschwunden ist', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000005031', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    // Jemand hat den Kanal von Hand auf Discord geloescht.
    const { discord } = await import('@swisshub/discord');
    await discord.managedChannels.remove(erstellt.kanal.discordChannelId!, 'Test');

    await voice.reconcileTemporaryVoices();

    const danach = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(danach.closedAt).not.toBeNull();
  });

  it('räumt eine liegengebliebene Reservierung auf', async () => {
    // Eine Zeile ohne Kanal: der Discord-Aufruf ist gescheitert und der
    // Prozess dabei gestorben - sonst haette er selbst aufgeraeumt.
    await prisma.temporaryVoiceChannel.create({
      data: {
        guildId: GUILD,
        ownerDiscordId: '900000000000005041',
        ownerUsername: 'anna',
        name: 'Halb angelegt',
        source: 'VOICE_HUB',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const ergebnis = await voice.reconcileTemporaryVoices();
    expect(ergebnis.reservierungen).toBe(1);
  });

  it('lässt Talks der Spielersuche in Ruhe', async () => {
    // Ihr Lebensende verwaltet die Spielersuche selbst - sie schliesst dabei
    // auch die Suche, und das weiss nur sie.
    const { discord } = await import('@swisshub/discord');
    const kanal = await discord.managedChannels.createVoice({
      name: 'Gruppe',
      parentId: KATEGORIE,
    });
    await prisma.temporaryVoiceChannel.create({
      data: {
        guildId: GUILD,
        discordChannelId: kanal.id,
        ownerDiscordId: '900000000000005051',
        ownerUsername: 'anna',
        name: 'Gruppe',
        source: 'PLAYER_SEARCH',
        externalRef: 'irgendeine-suche',
      },
    });

    await voice.reconcileTemporaryVoices();

    const danach = await prisma.temporaryVoiceChannel.findFirstOrThrow({
      where: { source: 'PLAYER_SEARCH' },
    });
    expect(danach.closedAt).toBeNull();
    expect(danach.deleteScheduledAt).toBeNull();
  });

  // --- Bedienfeld ----------------------------------------------------------

  it('legt das Bedienfeld neu an, wenn es gelöscht wurde', async () => {
    const p = await preset();
    await hub(p.id);
    const erstellt = await voiceHub.handleHubJoin(beitritt('900000000000006001', 'anna'));
    if (erstellt.art !== 'ERSTELLT') {
      throw new Error('Talk nicht erstellt');
    }

    await voiceHub.posteBedienfeld(erstellt.kanal);
    const mit = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
      where: { id: erstellt.kanal.id },
    });
    expect(mit.controlMessageId).not.toBeNull();

    // Die Nachricht ist weg - das Bedienfeld laesst sich erneuern.
    await prisma.temporaryVoiceChannel.update({
      where: { id: erstellt.kanal.id },
      data: { controlMessageId: null },
    });
    const k = kontext('900000000000006001', 'anna', EIGENE_RECHTE);
    const ok = await voiceHub.repairTalkPanel(k, erstellt.kanal.id);
    expect(ok).toBe(true);
  });

  it('trägt die Kanalkennung in der Knopfkennung mit', () => {
    // Dadurch überleben die Knöpfe jeden Neustart: der Bot braucht keinen
    // Zustand im Arbeitsspeicher, um zu wissen, worauf ein Klick zielt.
    const id = voiceHub.baueKnopfId('lock', 'cmt123456789012345678901');
    const gelesen = voiceHub.leseKnopfId(id);
    expect(gelesen).toEqual({ action: 'lock', kanalId: 'cmt123456789012345678901' });
    expect(voiceHub.leseKnopfId('tournaments:result:abc')).toBeNull();
  });
});
