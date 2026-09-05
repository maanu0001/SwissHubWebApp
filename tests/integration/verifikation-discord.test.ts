import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation_discord');

/**
 * Der Weg über Discord.
 *
 * Die vorigen Dateien prüfen den Dienst. Hier geht es um das Stück davor:
 * was der Bot tatsächlich tut, wenn jemand beitritt, schreibt oder einen
 * Knopf drückt. Die interessanten Fälle sind die, in denen nichts passieren
 * darf - falscher Kanal, fehlende Berechtigung, abgeschaltetes Modul - und
 * der, in dem die Rollenhierarchie nicht stimmt: dann muss die Moderation
 * es erfahren, statt dass jemand unbemerkt mit vollem Zugriff dasteht.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { setDiscordGateway } = await import('@swisshub/discord');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');
const { registerVerification, registerRejectConfirmation } = await import('../../apps/bot/src/verification');

const GUILD = '200000000000000000';
const UNVERIFIZIERT = '900000000000000701';
const MITGLIED = '900000000000000702';
const MOD_ROLLE = '900000000000000703';
const PING_ROLLE = '900000000000000704';
const VERIFIKATIONSKANAL = '900000000000000801';
const MOD_KANAL = '900000000000000802';
const ANDERER_KANAL = '900000000000000803';

const MODERATOR = '100000000000000021';
const FREMDER = '100000000000000022';

/** Ein Discord-Zugang, der mitschreibt statt zu handeln. */
function attrappe() {
  const gesendet: Array<{ channelId: string; payload: Record<string, unknown> }> = [];
  const bearbeitet: Array<{ channelId: string; messageId: string }> = [];
  const gesetzteRollen: Array<{ discordId: string; roleIds: string[] }> = [];
  const banns: string[] = [];
  const kicks: string[] = [];
  let zaehler = 0;

  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'neuling',
        displayName: 'Neuling',
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
      kick: vi.fn(async (discordId: string) => {
        kicks.push(discordId);
      }),
    },
    bans: {
      add: vi.fn(async (discordId: string) => {
        banns.push(discordId);
      }),
    },
    roles: {
      list: vi.fn(async () => [
        {
          id: UNVERIFIZIERT,
          name: 'Nicht verifiziert',
          color: 0,
          position: 1,
          managed: false,
          permissions: '0',
        },
        { id: MITGLIED, name: 'Mitglied', color: 0, position: 2, managed: false, permissions: '0' },
        { id: MOD_ROLLE, name: 'Moderation', color: 0, position: 50, managed: false, permissions: '0' },
      ]),
    },
    guild: { get: vi.fn(async () => ({ id: GUILD, name: 'SwissHub', ownerId: '9' })) },
    bot: {
      identity: vi.fn(async () => ({ discordId: 'bot', username: 'SwissHub Bot' })),
      highestRolePosition: vi.fn(async () => 100),
    },
    channels: {
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        zaehler += 1;
        gesendet.push({ channelId, payload });
        return { id: `msg-${zaehler}`, channelId };
      }),
      edit: vi.fn(async (channelId: string, messageId: string) => {
        bearbeitet.push({ channelId, messageId });
      }),
    },
  };

  return { gateway, gesendet, bearbeitet, gesetzteRollen, banns, kicks };
}

type Attrappe = ReturnType<typeof attrappe>;

/** Ein Client, der die angemeldeten Ereignisbehandler festhält. */
function fakeClient() {
  const behandler = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const client = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const liste = behandler.get(event) ?? [];
      liste.push(handler);
      behandler.set(event, liste);
      return client;
    },
  };
  const feuere = async (event: string, ...args: unknown[]): Promise<void> => {
    for (const handler of behandler.get(event) ?? []) {
      await handler(...args);
    }
  };
  return { client, feuere };
}

/**
 * Auf eine Wirkung warten.
 *
 * `messageCreate` startet bewusst eine eigene Aufgabe und wartet nicht auf
 * sie - sonst hinge der Gateway-Strom an der Datenbank. Der Test muss das
 * Ergebnis deshalb abwarten statt es anzunehmen.
 */
async function bisWahr(pruefung: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const ende = Date.now() + ms;
  for (;;) {
    if (await pruefung()) {
      return;
    }
    if (Date.now() > ende) {
      throw new Error('Erwartete Wirkung ist nicht eingetreten');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface FakeMember {
  id: string;
  user: { bot: boolean; username: string; avatar: string | null; createdAt: Date };
  displayName: string;
  guild: { id: string };
  joinedAt: Date;
  roles: { add: ReturnType<typeof vi.fn> };
}

function mitglied(discordId: string, options: { rollenFehler?: boolean } = {}): FakeMember {
  return {
    id: discordId,
    user: {
      bot: false,
      username: 'neuling',
      avatar: null,
      createdAt: new Date('2020-01-01'),
    },
    displayName: 'Neuling',
    guild: { id: GUILD },
    joinedAt: new Date(),
    roles: {
      add: vi.fn(async () => {
        if (options.rollenFehler) {
          // Genau das meldet Discord, wenn die Bot-Rolle zu tief steht.
          throw new Error('Missing Permissions');
        }
      }),
    },
  };
}

function nachricht(autor: string, channelId: string, content: string, id = `m-${autor}`) {
  return {
    id,
    author: { id: autor, bot: false },
    guild: { id: GUILD },
    channelId,
    content,
    createdAt: new Date(),
  };
}

/** Ein Knopfdruck, wie discord.js ihn liefert - samt Antwortkanal. */
function knopfdruck(customId: string, benutzer: string, rollen: string[]) {
  const antworten: Array<Record<string, unknown>> = [];
  const interaction = {
    isButton: () => true,
    // discord.js liefert diese Pruefung an jeder Interaktion mit - und beide
    // Behandler fragen danach, ehe sie etwas tun.
    isModalSubmit: () => false,
    customId,
    guildId: GUILD,
    user: { id: benutzer, username: 'klickerin' },
    member: { roles: { cache: new Map(rollen.map((id) => [id, { id }])) } },
    deferred: false,
    replied: false,
    reply: vi.fn(async (payload: Record<string, unknown>) => {
      interaction.replied = true;
      antworten.push(payload);
    }),
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async (payload: Record<string, unknown>) => {
      antworten.push(payload);
    }),
    update: vi.fn(async (payload: Record<string, unknown>) => {
      antworten.push(payload);
    }),
  };
  return { interaction, antworten };
}

/**
 * Ein Klick auf einen Bestaetigungsknopf.
 *
 * Anders als der erste Knopf beantwortet dieser eine bereits sichtbare
 * ephemere Nachricht - `update` und `deferUpdate` statt `reply`.
 */
function bestaetigung(customId: string, benutzer: string, rollen: string[]) {
  const antworten: Array<Record<string, unknown>> = [];
  const interaction = {
    isButton: () => true,
    isModalSubmit: () => false,
    customId,
    guildId: GUILD,
    user: { id: benutzer, username: 'klickerin' },
    member: { roles: { cache: new Map(rollen.map((id) => [id, { id }])) } },
    deferred: false,
    replied: false,
    update: vi.fn(async (payload: Record<string, unknown>) => {
      antworten.push(payload);
    }),
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    reply: vi.fn(async (payload: Record<string, unknown>) => {
      interaction.replied = true;
      antworten.push(payload);
    }),
    editReply: vi.fn(async (payload: Record<string, unknown>) => {
      antworten.push(payload);
    }),
    showModal: vi.fn(async () => undefined),
  };
  return { interaction, antworten };
}

/** Ein abgeschicktes Modal mit freiem Grund. */
function modal(customId: string, grund: string, benutzer: string, rollen: string[]) {
  const antworten: Array<Record<string, unknown>> = [];
  const interaction = {
    isButton: () => false,
    isModalSubmit: () => true,
    customId,
    guildId: GUILD,
    user: { id: benutzer, username: 'klickerin' },
    member: { roles: { cache: new Map(rollen.map((id) => [id, { id }])) } },
    fields: { getTextInputValue: () => grund },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    reply: vi.fn(async (payload: Record<string, unknown>) => {
      antworten.push(payload);
    }),
    editReply: vi.fn(async (payload: Record<string, unknown>) => {
      antworten.push(payload);
    }),
  };
  return { interaction, antworten };
}

const texte = (antworten: Array<Record<string, unknown>>): string =>
  antworten.map((eintrag) => String(eintrag.content ?? '')).join(' | ');

let discord: Attrappe;
let bot: ReturnType<typeof fakeClient>;

describeWithDatabase('Verifikation über Discord', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "VerificationMessage","VerificationRequest","RolePermission","ManagedRole","ModerationAction","AuditLog" RESTART IDENTITY CASCADE',
    );

    // Rechte kommen über dieselbe Rollen-Zuordnung wie im Dashboard - es gibt
    // keine zweite Adminliste und keine Prüfung auf Rollennamen.
    await prisma.managedRole.create({
      data: { discordRoleId: MOD_ROLLE, label: 'Moderation', moderationLevel: 50 },
    });
    await prisma.rolePermission.createMany({
      data: [
        verification.VERIFICATION_PERMISSIONS.approve,
        verification.VERIFICATION_PERMISSIONS.reject,
        verification.VERIFICATION_PERMISSIONS.review,
        'moderation.ban',
      ].map((permission) => ({ discordRoleId: MOD_ROLLE, permission })),
    });
    invalidateRoleConfiguration();

    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, true, 'test');
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      {
        unverifiedRoleId: UNVERIFIZIERT,
        memberRoleId: MITGLIED,
        verificationChannelId: VERIFIKATIONSKANAL,
        moderatorChannelId: MOD_KANAL,
        moderatorPingRoleId: PING_ROLLE,
        logChannelId: null,
        greetingMessage: 'Hoi {user}, schriib bitte öppis. @everyone',
        aiEnabled: false,
        aiAutoVerify: false,
        trustReturningMembers: false,
      },
      'test',
    );

    discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    bot = fakeClient();
    registerVerification(bot.client as never);
    registerRejectConfirmation(bot.client as never);
  });

  // --- Beitritt und Begrüssung ------------------------------------------

  it('vergibt die Rolle und begrüsst im Verifikationskanal', async () => {
    const neu = mitglied('900000000000009301');
    await bot.feuere('guildMemberAdd', neu);

    expect(neu.roles.add).toHaveBeenCalledWith(UNVERIFIZIERT, 'Verifikation ausstehend');

    const begruessung = discord.gesendet.find((eintrag) => eintrag.channelId === VERIFIKATIONSKANAL);
    expect(begruessung).toBeDefined();
    // `{user}` wird durch die Erwähnung ersetzt.
    expect(begruessung?.payload.content).toContain('<@900000000000009301>');
    // Und das `@everyone` im Text pingt niemanden: erlaubt ist ausschliesslich
    // die begrüsste Person.
    expect(begruessung?.payload.allowedMentions).toEqual({
      parse: [],
      users: ['900000000000009301'],
    });

    const request = await prisma.verificationRequest.findFirst({
      where: { discordId: '900000000000009301' },
    });
    expect(request?.status).toBe('WAITING_FOR_MESSAGE');
  });

  it('meldet der Moderation, wenn die Rolle nicht vergeben werden kann', async () => {
    // Der praktische Fall: die Bot-Rolle steht unter der Rolle, die sie
    // vergeben soll. Ohne Meldung stünde die Person unbemerkt mit vollem
    // Zugriff im Server.
    const neu = mitglied('900000000000009302', { rollenFehler: true });
    await bot.feuere('guildMemberAdd', neu);

    const request = await prisma.verificationRequest.findFirst({
      where: { discordId: '900000000000009302' },
    });
    expect(request?.status).toBe('ERROR');
    expect(request?.decisionReason).toContain('Rollenhierarchie');

    const meldung = discord.gesendet.find((eintrag) => eintrag.channelId === MOD_KANAL);
    expect(meldung).toBeDefined();
    expect(meldung?.payload.content).toBe(`<@&${PING_ROLLE}>`);

    // Und ganz sicher keine Sanktion.
    expect(discord.banns).toEqual([]);
    expect(discord.kicks).toEqual([]);
    // Keine Begrüssung in einem Kanal, den die Person gar nicht sehen kann.
    expect(discord.gesendet.some((eintrag) => eintrag.channelId === VERIFIKATIONSKANAL)).toBe(false);
  });

  it('rührt sich beim Beitritt nicht, wenn das Modul aus ist', async () => {
    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, false, 'test');
    const neu = mitglied('900000000000009303');

    await bot.feuere('guildMemberAdd', neu);

    expect(neu.roles.add).not.toHaveBeenCalled();
    expect(discord.gesendet).toEqual([]);
    expect(await prisma.verificationRequest.count()).toBe(0);
  });

  // --- Nachrichten -------------------------------------------------------

  it('weckt die Moderation bei der ersten Nachricht und schreibt sie danach fort', async () => {
    const discordId = '900000000000009304';
    await bot.feuere('guildMemberAdd', mitglied(discordId));

    await bot.feuere(
      'messageCreate',
      nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme, ich bi de Luca.', 'm-1'),
    );
    await bisWahr(() => discord.gesendet.some((eintrag) => eintrag.channelId === MOD_KANAL));

    const meldung = discord.gesendet.find((eintrag) => eintrag.channelId === MOD_KANAL);
    // Beim ersten Mal wird die Moderation erwähnt.
    expect(meldung?.payload.content).toBe(`<@&${PING_ROLLE}>`);

    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Sorry, nochmal.', 'm-2'));
    await bisWahr(() => discord.bearbeitet.length > 0);

    // Die bestehende Meldung wird fortgeschrieben, nicht ersetzt - und ein
    // zweiter Ping bleibt aus.
    expect(discord.gesendet.filter((eintrag) => eintrag.channelId === MOD_KANAL)).toHaveLength(1);
    expect(discord.bearbeitet[0]?.channelId).toBe(MOD_KANAL);
  });

  it('beachtet Nachrichten in anderen Kanälen nicht', async () => {
    const discordId = '900000000000009305';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    const vorher = discord.gesendet.length;

    await bot.feuere('messageCreate', nachricht(discordId, ANDERER_KANAL, 'Hoi zäme', 'm-fremd'));
    // Kurz Zeit lassen - es soll ja gerade nichts geschehen.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const request = await prisma.verificationRequest.findFirst({ where: { discordId } });
    expect(request?.status).toBe('WAITING_FOR_MESSAGE');
    expect(request?.messageCount).toBe(0);
    expect(await prisma.verificationMessage.count()).toBe(0);
    expect(discord.gesendet).toHaveLength(vorher);
  });

  // --- Knöpfe ------------------------------------------------------------

  it('schaltet frei, wenn eine berechtigte Person den Knopf drückt', async () => {
    const discordId = '900000000000009306';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme', 'm-3'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = knopfdruck(
      verification.buildButtonId('approve', request.id),
      MODERATOR,
      [MOD_ROLLE],
    );
    await bot.feuere('interactionCreate', interaction);
    // Der Knopf-Behandler laeuft bewusst als eigene Aufgabe.
    await bisWahr(() => antworten.length > 0);
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
      return stand.status === 'VERIFIED';
    });

    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.decidedBy).toBe('HUMAN');
    expect(danach.decidedByDiscordId).toBe(MODERATOR);
    expect(texte(antworten)).toContain('freigeschaltet');

    // Die Rollen wurden in einem Zug getauscht.
    const rollen = discord.gesetzteRollen.at(-1);
    expect(rollen?.discordId).toBe(discordId);
    expect(rollen?.roleIds).toContain(MITGLIED);
    expect(rollen?.roleIds).not.toContain(UNVERIFIZIERT);
  });

  it('lässt einen Fremden den Knopf nicht drücken', async () => {
    // Die Knopf-Kennung steht im Klartext in der Nachricht. Wer sie nachbaut,
    // gewinnt damit nichts: geprüft werden die echten Rollen des Drückenden.
    const discordId = '900000000000009307';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme', 'm-4'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = knopfdruck(
      verification.buildButtonId('approve', request.id),
      FREMDER,
      [],
    );
    await bot.feuere('interactionCreate', interaction);
    // Der Knopf-Behandler laeuft bewusst als eigene Aufgabe.
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('Berechtigung');
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('WAITING_FOR_REVIEW');
    expect(danach.decidedAt).toBeNull();
    expect(discord.gesetzteRollen).toEqual([]);
  });

  it('lässt einen Fremden erst recht nicht ablehnen', async () => {
    const discordId = '900000000000009308';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme', 'm-5'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = knopfdruck(
      verification.buildButtonId('reject', request.id),
      FREMDER,
      [],
    );
    await bot.feuere('interactionCreate', interaction);
    // Der Knopf-Behandler laeuft bewusst als eigene Aufgabe.
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('Berechtigung');
    expect(discord.banns).toEqual([]);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('WAITING_FOR_REVIEW');
  });

  it('bannt beim Ablehnen nicht sofort, sondern fragt nach dem Grund', async () => {
    const discordId = '900000000000009309';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'aaa', 'm-6'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = knopfdruck(
      verification.buildButtonId('reject', request.id),
      MODERATOR,
      [MOD_ROLLE],
    );
    await bot.feuere('interactionCreate', interaction);
    // Der Knopf-Behandler laeuft bewusst als eigene Aufgabe.
    await bisWahr(() => antworten.length > 0);

    // Ein Bann ist nicht rückgängig zu machen - der erste Klick fragt nur.
    expect(texte(antworten)).toContain('wirklich vom SwissHub Server bannen');
    expect(discord.banns).toEqual([]);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('WAITING_FOR_REVIEW');
    expect(danach.decidedAt).toBeNull();
  });

  it('nimmt keinen Knopfdruck an, wenn das Modul ausgeschaltet ist', async () => {
    const discordId = '900000000000009310';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme', 'm-7'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, false, 'test');

    const { interaction, antworten } = knopfdruck(
      verification.buildButtonId('approve', request.id),
      MODERATOR,
      [MOD_ROLLE],
    );
    await bot.feuere('interactionCreate', interaction);
    // Der Knopf-Behandler laeuft bewusst als eigene Aufgabe.
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('ausgeschaltet');
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('WAITING_FOR_REVIEW');
  });

  it('nimmt einen Knopf aus einem anderen Server nicht an', async () => {
    const discordId = '900000000000009311';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme', 'm-8'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = knopfdruck(
      verification.buildButtonId('approve', request.id),
      MODERATOR,
      [MOD_ROLLE],
    );
    interaction.guildId = '300000000000000000';
    await bot.feuere('interactionCreate', interaction);
    // Der Knopf-Behandler laeuft bewusst als eigene Aufgabe.
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('anderen Server');
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.decidedAt).toBeNull();
  });

  // --- Erwähnungen -------------------------------------------------------

  it('pingt genau die eingestellte Staff-Rolle und sonst niemanden', async () => {
    const discordId = '900000000000009320';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi zäme', 'm-ping'));
    await bisWahr(() => discord.gesendet.some((eintrag) => eintrag.channelId === MOD_KANAL));

    const meldung = discord.gesendet.find((eintrag) => eintrag.channelId === MOD_KANAL);
    const erlaubt = meldung?.payload.allowedMentions as {
      parse?: string[];
      roles?: string[];
      users?: string[];
    };

    // Die eine gewollte Ausnahme im ganzen System: hier soll die Moderation
    // tatsächlich benachrichtigt werden.
    expect(erlaubt.roles).toEqual([PING_ROLLE]);
    // Und ausschliesslich sie: kein `everyone`, keine Sammelfreigabe.
    expect(erlaubt.parse).toEqual([]);
    expect(erlaubt.users).toBeUndefined();
  });

  it('lässt ein @everyone aus der Verifikationsnachricht niemanden pingen', async () => {
    const discordId = '900000000000009321';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere(
      'messageCreate',
      nachricht(discordId, VERIFIKATIONSKANAL, '@everyone @here hallo <@&999> ', 'm-evil'),
    );
    await bisWahr(() => discord.gesendet.some((eintrag) => eintrag.channelId === MOD_KANAL));

    const meldung = discord.gesendet.find((eintrag) => eintrag.channelId === MOD_KANAL);
    const embed = (meldung?.payload.embeds as Array<{ fields: Array<{ value: string }> }>)[0]!;
    const nachrichtenfeld = embed.fields.find((f) => f.value.includes('@everyone'));

    // Der Text steht sichtbar da …
    expect(nachrichtenfeld).toBeDefined();
    // … erreicht aber niemanden: freigegeben ist nur die Staff-Rolle.
    const erlaubt = meldung?.payload.allowedMentions as { parse?: string[]; roles?: string[] };
    expect(erlaubt.parse).toEqual([]);
    expect(erlaubt.roles).toEqual([PING_ROLLE]);
  });

  it('stellt das geprüfte Mitglied klickbar und mit kopierbarer Kennung dar', async () => {
    const discordId = '900000000000009322';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi', 'm-embed'));
    await bisWahr(() => discord.gesendet.some((eintrag) => eintrag.channelId === MOD_KANAL));

    const meldung = discord.gesendet.find((eintrag) => eintrag.channelId === MOD_KANAL);
    const embed = (
      meldung?.payload.embeds as Array<{
        title: string;
        description: string;
        fields: Array<{ name: string; value: string }>;
      }>
    )[0]!;

    expect(embed.title).toContain('Neue Verifikation');
    expect(embed.description).toContain(`<@${discordId}>`);
    // Die Kennung bleibt lesbar, auch wenn die Person später weg ist.
    expect(embed.fields.find((f) => f.name === 'Discord ID')?.value).toBe(`\`${discordId}\``);
    // Zeitpunkte in Discords eigener Schreibweise - jeder sieht seine Zone.
    expect(embed.fields.find((f) => f.name === 'Server beigetreten')?.value).toMatch(/^<t:\d+:F>$/u);
    expect(embed.fields.find((f) => f.name === 'Status')?.value).toBe('Wartet auf Entscheidung');
  });

  // --- Ablehnen: Bestätigung und Bann ------------------------------------

  it('bannt erst nach der Bestätigung - und über den Moderationsdienst', async () => {
    const discordId = '900000000000009330';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'aaa', 'm-ban'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = bestaetigung(`verification:confirm:0:${request.id}`, MODERATOR, [
      MOD_ROLLE,
    ]);
    await bot.feuere('interactionCreate', interaction);
    await bisWahr(() => antworten.length > 0);

    expect(discord.banns).toEqual([discordId]);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('REJECTED');
    expect(danach.decidedByDiscordId).toBe(MODERATOR);
    expect(danach.decidedSource).toBe('DISCORD');

    // Der Bann steht in der Moderationsakte - nicht in einer zweiten Welt
    // neben der Moderation.
    const massnahme = await prisma.moderationAction.findFirst({
      where: { targetDiscordId: discordId, type: 'BAN' },
    });
    expect(massnahme).not.toBeNull();
    expect(massnahme?.reason).toContain(verification.ABLEHNUNGSGRUENDE[0]);
  });

  it('nimmt einen frei formulierten Grund entgegen', async () => {
    const discordId = '900000000000009331';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'aaa', 'm-modal'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = modal(
      `verification:reasonModal:${request.id}`,
      'Werbung für einen fremden Server',
      MODERATOR,
      [MOD_ROLLE],
    );
    await bot.feuere('interactionCreate', interaction);
    await bisWahr(() => antworten.length > 0);

    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('REJECTED');
    expect(danach.decisionReason).toBe('Werbung für einen fremden Server');
    expect(discord.banns).toEqual([discordId]);
  });

  it('lässt einen Unberechtigten die Bestätigung nicht drücken', async () => {
    const discordId = '900000000000009332';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'aaa', 'm-fremd2'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = bestaetigung(`verification:confirm:0:${request.id}`, FREMDER, []);
    await bot.feuere('interactionCreate', interaction);
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('Berechtigung');
    expect(discord.banns).toEqual([]);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.decidedAt).toBeNull();
  });

  it('bricht ab, ohne jemanden zu bannen', async () => {
    const discordId = '900000000000009333';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'aaa', 'm-abbruch'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    const { interaction, antworten } = bestaetigung(`verification:cancel:${request.id}`, MODERATOR, [
      MOD_ROLLE,
    ]);
    await bot.feuere('interactionCreate', interaction);
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('Abgebrochen');
    expect(discord.banns).toEqual([]);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.decidedAt).toBeNull();
  });

  it('lässt nach einer Entscheidung im Dashboard keinen Discord-Knopf mehr wirken', async () => {
    const discordId = '900000000000009334';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi', 'm-sync'));
    await bisWahr(async () => {
      const stand = await prisma.verificationRequest.findFirst({ where: { discordId } });
      return stand?.status === 'WAITING_FOR_REVIEW';
    });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });

    // Die WebApp entscheidet zuerst - derselbe Dienst, andere Oberfläche.
    await verification.humanVerify(
      {
        discordId: MODERATOR,
        username: 'dashboard',
        roleIds: [MOD_ROLLE],
        isOwner: false,
        can: () => true,
        source: 'WEBAPP',
      },
      request.id,
    );

    const { interaction, antworten } = bestaetigung(`verification:confirm:0:${request.id}`, MODERATOR, [
      MOD_ROLLE,
    ]);
    await bot.feuere('interactionCreate', interaction);
    await bisWahr(() => antworten.length > 0);

    expect(texte(antworten)).toContain('bereits bearbeitet');
    expect(discord.banns).toEqual([]);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.status).toBe('VERIFIED');
    expect(danach.decidedSource).toBe('WEBAPP');
  });

  it('erzeugt nach einem Neustart des Bots kein zweites Review-Embed', async () => {
    // Der Zustand steht in der Datenbank, nicht im Arbeitsspeicher: die
    // Kennung der Meldung hängt am Vorgang.
    const discordId = '900000000000009335';
    await bot.feuere('guildMemberAdd', mitglied(discordId));
    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Hoi', 'm-neu-1'));
    await bisWahr(() => discord.gesendet.some((eintrag) => eintrag.channelId === MOD_KANAL));

    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { discordId } });
    expect(request.modChannelId).toBe(MOD_KANAL);
    expect(request.modMessageId).not.toBeNull();

    // Neustart: neue Behandler, derselbe Datenbestand.
    bot = fakeClient();
    registerVerification(bot.client as never);
    registerRejectConfirmation(bot.client as never);

    await bot.feuere('messageCreate', nachricht(discordId, VERIFIKATIONSKANAL, 'Nochmal', 'm-neu-2'));
    await bisWahr(() => discord.bearbeitet.length > 0);

    // Genau eine Meldung, danach nur noch Fortschreibungen.
    expect(discord.gesendet.filter((eintrag) => eintrag.channelId === MOD_KANAL)).toHaveLength(1);
    const danach = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(danach.modMessageId).toBe(request.modMessageId);
    expect(danach.messageCount).toBe(2);
  });
});
