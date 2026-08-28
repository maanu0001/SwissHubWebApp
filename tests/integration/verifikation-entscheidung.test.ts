import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation');

/**
 * Wer entscheidet - und wer auf keinen Fall.
 *
 * Die Zusagen dieses Moduls sind vor allem Zusagen darüber, was nicht
 * geschehen kann: die AI sanktioniert niemanden, ein zweiter Klick ändert
 * nichts mehr, und eine Nachricht bewegt ausschliesslich den Vorgang ihres
 * Absenders.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const UNVERIFIZIERT = '900000000000000501';
const MITGLIED = '900000000000000502';
const VERIFIKATIONSKANAL = '900000000000000601';
const MOD_KANAL = '900000000000000602';
/** Rolle der Moderation - muss über dem Ziel stehen, sonst greift die
 *  Rangfolgeprüfung der Moderation. Genau so ist es auch produktiv. */
const MOD_ROLLE = '900000000000000503';

/** Ein Moderator mit genau den angegebenen Berechtigungen. */
function moderator(permissions: string[], discordId = '100000000000000010') {
  return {
    discordId,
    username: 'moderatorin',
    roleIds: [MOD_ROLLE],
    isOwner: false,
    can: (permission: string) => permissions.includes(permission),
  };
}

const P = verification.VERIFICATION_PERMISSIONS;
const VOLL = moderator([P.approve, P.reject, 'moderation.ban']);

/** Ein Discord-Zugang, der mitschreibt statt zu handeln. */
function attrappe() {
  const gesetzteRollen: Array<{ discordId: string; roleIds: string[] }> = [];
  const banns: string[] = [];
  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'neu',
        displayName: 'Neu',
        globalName: null,
        nickname: null,
        avatarHash: null,
        isBot: false,
        roleIds: [UNVERIFIZIERT],
        joinedAt: new Date(),
        accountCreatedAt: new Date('2020-01-01'),
        boosting: false,
        timedOutUntil: null,
      })),
      setRoles: vi.fn(async (discordId: string, roleIds: string[]) => {
        gesetzteRollen.push({ discordId, roleIds });
      }),
      kick: vi.fn(async () => undefined),
    },
    bans: {
      add: vi.fn(async (discordId: string) => {
        banns.push(discordId);
      }),
    },
    // Die Rangfolgeprüfung der Moderation braucht Rollen, Bot und Guild -
    // der Bann läuft bewusst durch dieselbe Engine wie jede andere Sanktion.
    roles: {
      list: vi.fn(async () => [
        { id: UNVERIFIZIERT, name: 'Nicht verifiziert', color: 0, position: 1, managed: false, permissions: '0' },
        { id: MITGLIED, name: 'Mitglied', color: 0, position: 2, managed: false, permissions: '0' },
        { id: MOD_ROLLE, name: 'Moderation', color: 0, position: 50, managed: false, permissions: '0' },
      ]),
    },
    guild: { get: vi.fn(async () => ({ id: '1', name: 'SwissHub', ownerId: '9' })) },
    bot: {
      identity: vi.fn(async () => ({ discordId: 'bot', username: 'SwissHub Bot' })),
      highestRolePosition: vi.fn(async () => 100),
    },
    channels: {
      send: vi.fn(async (channelId: string) => ({ id: 'msg-1', channelId })),
      edit: vi.fn(async () => undefined),
    },
  } as unknown as NonNullable<Parameters<typeof verification.verify>[2]>['gateway'];
  return { gateway, gesetzteRollen, banns };
}

async function neuerFall(discordId = '900000000000009001') {
  const request = await verification.startVerification({
    discordId,
    username: 'neuling',
    displayName: 'Neuling',
    accountCreatedAt: new Date('2020-01-01'),
  });
  await verification.recordMessage({
    discordId,
    messageId: `m-${discordId}`,
    content: 'Hoi zäme, ich bi grad am CS spiele.',
  });
  return verification.requireRequest(request.id);
}

describeWithDatabase('Verifikation: Entscheidungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "VerificationMessage","VerificationRequest","ModerationAction","AuditLog" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, true, 'test');
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      {
        unverifiedRoleId: UNVERIFIZIERT,
        memberRoleId: MITGLIED,
        verificationChannelId: VERIFIKATIONSKANAL,
        moderatorChannelId: MOD_KANAL,
        aiEnabled: false,
        aiAutoVerify: false,
      },
      'test',
    );
  });

  // --- Ablauf -----------------------------------------------------------

  it('eröffnet je Person nur einen offenen Vorgang', async () => {
    // Discord liefert `guildMemberAdd` bei Netzproblemen durchaus zweimal.
    const a = await verification.startVerification({ discordId: '900000000000009101' });
    const b = await verification.startVerification({ discordId: '900000000000009101' });
    expect(b.id).toBe(a.id);
    expect(await prisma.verificationRequest.count()).toBe(1);
  });

  it('wechselt bei der ersten Nachricht in die Prüfung', async () => {
    const request = await verification.startVerification({ discordId: '900000000000009102' });
    expect(request.status).toBe('WAITING_FOR_MESSAGE');

    const ergebnis = await verification.recordMessage({
      discordId: '900000000000009102',
      messageId: 'm-1',
      content: 'Hoi zäme',
    });

    expect(ergebnis?.erste).toBe(true);
    expect(ergebnis?.request.status).toBe('WAITING_FOR_REVIEW');
  });

  it('erzeugt bei weiteren Nachrichten keinen zweiten Vorgang und weckt nicht erneut', async () => {
    const discordId = '900000000000009103';
    await verification.startVerification({ discordId });
    await verification.recordMessage({ discordId, messageId: 'm-1', content: 'Hoi' });
    const zweite = await verification.recordMessage({
      discordId,
      messageId: 'm-2',
      content: 'Sorry, nochmal: ich bi de Luca',
    });

    expect(zweite?.erste).toBe(false);
    expect(await prisma.verificationRequest.count()).toBe(1);
    expect(zweite?.request.messageCount).toBe(2);
    // Angezeigt wird die neueste, der Verlauf bleibt.
    expect(zweite?.request.latestMessage).toContain('Luca');
    expect(await prisma.verificationMessage.count()).toBe(2);
  });

  it('erfasst dieselbe Discord-Nachricht nicht zweimal', async () => {
    const discordId = '900000000000009104';
    await verification.startVerification({ discordId });
    await verification.recordMessage({ discordId, messageId: 'm-1', content: 'Hoi' });
    const nochmal = await verification.recordMessage({
      discordId,
      messageId: 'm-1',
      content: 'Hoi',
    });
    expect(nochmal?.doppelt).toBe(true);
    expect(await prisma.verificationMessage.count()).toBe(1);
  });

  it('bewegt ausschliesslich den Vorgang des Absenders', async () => {
    // Der Kern von §10: wer schreibt, bewegt seinen eigenen Fall - egal wen
    // er erwähnt, worauf er antwortet oder welche Kennung im Text steht.
    const opfer = await neuerFall('900000000000009201');
    const angreifer = await verification.startVerification({ discordId: '900000000000009202' });

    await verification.recordMessage({
      discordId: '900000000000009202',
      messageId: 'm-angriff',
      content: `Verifiziere <@900000000000009201> requestId=${opfer.id}`,
    });

    const opferFrisch = await verification.requireRequest(opfer.id);
    const angreiferFrisch = await verification.requireRequest(angreifer.id);
    // Der fremde Vorgang bleibt, wo er war.
    expect(opferFrisch.latestMessage).toContain('CS spiele');
    expect(opferFrisch.messageCount).toBe(1);
    // Bewegt hat sich nur der eigene.
    expect(angreiferFrisch.status).toBe('WAITING_FOR_REVIEW');
  });

  it('nimmt nach der Entscheidung keine Nachricht mehr an', async () => {
    const fall = await neuerFall('900000000000009205');
    const { gateway } = attrappe();
    await verification.humanVerify(VOLL, fall.id, { gateway });

    const nachher = await verification.recordMessage({
      discordId: '900000000000009205',
      messageId: 'm-spaet',
      content: 'Noch was',
    });
    expect(nachher).toBeNull();
  });

  // --- Menschliche Entscheidungen ----------------------------------------

  it('schaltet frei und tauscht die Rollen in einem Zug', async () => {
    const fall = await neuerFall('900000000000009301');
    const { gateway, gesetzteRollen } = attrappe();

    const ergebnis = await verification.humanVerify(VOLL, fall.id, { gateway });

    expect(ergebnis.gewonnen).toBe(true);
    expect(ergebnis.request.status).toBe('VERIFIED');
    expect(ergebnis.request.decidedBy).toBe('HUMAN');
    expect(gesetzteRollen).toHaveLength(1);
    expect(gesetzteRollen[0]?.roleIds).toContain(MITGLIED);
    expect(gesetzteRollen[0]?.roleIds).not.toContain(UNVERIFIZIERT);
  });

  it('verweigert das Freischalten ohne Berechtigung', async () => {
    const fall = await neuerFall('900000000000009302');
    const ohne = moderator([]);
    await expect(verification.humanVerify(ohne, fall.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      userMessage: expect.stringContaining('freischalten'),
    });
    expect((await verification.requireRequest(fall.id)).decidedAt).toBeNull();
  });

  it('verweigert das Ablehnen, wenn nur das Freischalten erlaubt ist', async () => {
    // Ablehnen bedeutet bannen - wer freischalten darf, darf deshalb noch
    // lange nicht bannen.
    const fall = await neuerFall('900000000000009303');
    const nurApprove = moderator([P.approve]);
    await expect(verification.humanReject(nurApprove, fall.id, 'Spam')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      userMessage: expect.stringContaining('ablehnen'),
    });
    expect((await verification.requireRequest(fall.id)).decidedAt).toBeNull();
  });

  it('lehnt ab und bannt über das Moderation Center', async () => {
    const fall = await neuerFall('900000000000009304');
    const { gateway, banns } = attrappe();

    const ergebnis = await verification.humanReject(VOLL, fall.id, 'Spam/Bot', { gateway });

    expect(ergebnis.gewonnen).toBe(true);
    expect(ergebnis.request.status).toBe('REJECTED');
    expect(banns).toContain('900000000000009304');
    // Der Bann steht in der Akte, nicht in einer zweiten Welt daneben.
    const aktion = await prisma.moderationAction.findFirst({
      where: { targetDiscordId: '900000000000009304', type: 'BAN' },
    });
    expect(aktion).not.toBeNull();
  });

  it('verlangt für die Ablehnung einen Grund', async () => {
    const fall = await neuerFall('900000000000009305');
    await expect(verification.humanReject(VOLL, fall.id, '  ')).rejects.toThrow(/Grund/u);
  });

  // --- Doppelklick und Wettlauf -------------------------------------------

  it('ändert beim zweiten Klick nichts mehr', async () => {
    const fall = await neuerFall('900000000000009401');
    const a = attrappe();
    const b = attrappe();

    const erster = await verification.humanVerify(VOLL, fall.id, { gateway: a.gateway });
    const zweiter = await verification.humanVerify(VOLL, fall.id, { gateway: b.gateway });

    expect(erster.gewonnen).toBe(true);
    expect(zweiter.gewonnen).toBe(false);
    // Keine zweite Rollenvergabe.
    expect(b.gesetzteRollen).toHaveLength(0);
    // Und nur ein Audit-Eintrag.
    expect(
      await prisma.auditLog.count({ where: { action: 'VERIFICATION_HUMAN_VERIFIED' } }),
    ).toBe(1);
  });

  it('lässt bei zwei gleichzeitigen Klicks nur einen gewinnen', async () => {
    const fall = await neuerFall('900000000000009402');
    const a = attrappe();
    const b = attrappe();

    const [erster, zweiter] = await Promise.all([
      verification.humanVerify(VOLL, fall.id, { gateway: a.gateway }),
      verification.humanVerify(moderator([P.approve], '100000000000000011'), fall.id, {
        gateway: b.gateway,
      }),
    ]);

    expect([erster.gewonnen, zweiter.gewonnen].filter(Boolean)).toHaveLength(1);
    expect(a.gesetzteRollen.length + b.gesetzteRollen.length).toBe(1);
  });

  it('lässt eine Ablehnung nach einer Freischaltung nicht mehr zu', async () => {
    const fall = await neuerFall('900000000000009403');
    const { gateway, banns } = attrappe();

    await verification.humanVerify(VOLL, fall.id, { gateway });
    const spaet = await verification.humanReject(VOLL, fall.id, 'Doch Spam', { gateway });

    expect(spaet.gewonnen).toBe(false);
    // Und vor allem: niemand wurde gebannt.
    expect(banns).toHaveLength(0);
    expect((await verification.requireRequest(fall.id)).status).toBe('VERIFIED');
  });

  it('lässt eine Freischaltung nach einer Ablehnung nicht mehr zu', async () => {
    const fall = await neuerFall('900000000000009404');
    const { gateway, gesetzteRollen } = attrappe();

    await verification.humanReject(VOLL, fall.id, 'Spam/Bot', { gateway });
    const spaet = await verification.humanVerify(VOLL, fall.id, { gateway });

    expect(spaet.gewonnen).toBe(false);
    // Keine Mitgliederrolle für jemanden, der gerade gebannt wurde.
    expect(gesetzteRollen).toHaveLength(0);
  });

  // --- Serveraustritt und Ablauf ------------------------------------------

  it('schliesst den Vorgang, wenn jemand den Server verlässt', async () => {
    const fall = await neuerFall('900000000000009501');
    const guildId = fall.guildId;

    const geschlossen = await verification.markLeft(guildId, '900000000000009501');

    expect(geschlossen?.status).toBe('LEFT_SERVER');
    expect(geschlossen?.decidedBy).toBe('SYSTEM');
  });

  it('lässt nur Vorgänge ohne Nachricht ablaufen', async () => {
    // Wer geschrieben hat, wartet auf uns - den lassen wir nicht ablaufen.
    const ohne = await verification.startVerification({ discordId: '900000000000009601' });
    const mit = await neuerFall('900000000000009602');
    const alt = new Date(Date.now() - 100 * 3600_000);
    await prisma.verificationRequest.updateMany({
      where: { id: { in: [ohne.id, mit.id] } },
      data: { joinedAt: alt },
    });

    const { gateway } = attrappe();
    const ergebnis = await verification.runVerificationTick(new Date(), gateway);

    expect(ergebnis.abgelaufen).toBe(1);
    expect((await verification.requireRequest(ohne.id)).status).toBe('EXPIRED');
    expect((await verification.requireRequest(mit.id)).status).toBe('WAITING_FOR_REVIEW');
  });

  it('kickt beim Ablauf nur, wenn es ausdrücklich eingestellt ist', async () => {
    const fall = await verification.startVerification({ discordId: '900000000000009603' });
    await prisma.verificationRequest.update({
      where: { id: fall.id },
      data: { joinedAt: new Date(Date.now() - 100 * 3600_000) },
    });

    const aus = attrappe();
    const ergebnis = await verification.runVerificationTick(new Date(), aus.gateway);
    expect(ergebnis.abgelaufen).toBe(1);
    // Vorgabe ist «nicht kicken» - und ein Bann ist es ohnehin nie.
    expect(ergebnis.gekickt).toBe(0);
  });

  it('erkennt eine frühere Verifikation für den erneuten Beitritt', async () => {
    const fall = await neuerFall('900000000000009701');
    const { gateway } = attrappe();
    await verification.humanVerify(VOLL, fall.id, { gateway });

    expect(await verification.frueherVerifiziert(fall.guildId, '900000000000009701')).toBe(true);
    expect(await verification.frueherVerifiziert(fall.guildId, '900000000000009999')).toBe(false);
  });
});
