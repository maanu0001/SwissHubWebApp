import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import type * as DiscordModul from '@swisshub/discord';

type DiscordGateway = DiscordModul.DiscordGateway;
type GuildChannel = DiscordModul.GuildChannel;
type DiscordMessagePayload = DiscordModul.DiscordMessagePayload;

useTestSchema('test_logs_discord');

/**
 * Die Discord-Ausgabe der Logs gegen eine echte Datenbank.
 *
 * Die entscheidenden Zusagen hängen an Datenbankeigenschaften: die
 * Eindeutigkeit des Zustellschlüssels, das Beanspruchen unter Bedingung, das
 * Verhalten nach einem Neustart. Eine Nachbildung von Prisma würde hier vor
 * allem sich selbst prüfen.
 *
 * Vier Zusagen stehen im Mittelpunkt:
 *
 * 1. **Die Aktion bleibt.** Ein Bann bleibt ein Bann, auch wenn Discord den
 *    Embed nicht annimmt.
 * 2. **Nichts zweimal.** Ein Logeintrag erzeugt je Ziel höchstens eine
 *    Nachricht - auch über einen Neustart hinweg.
 * 3. **Keine Schleife.** Ein Log-Embed erzeugt kein neues Log.
 * 4. **Niemand wird gepingt.**
 */
const { prisma } = await import('@swisshub/database');
const { logs, analytics } = await import('@swisshub/modules');

const KANAL = '300000000000000003';
const ZWEITER_KANAL = '310000000000000031';
const AKTEUR = { discordId: '100000000000000001', username: 'admin' };
const GUILD = '900000000000000009';

/** Was der Bot tatsächlich gesendet hat. */
let gesendet: Array<{ channelId: string; payload: DiscordMessagePayload }> = [];
let sendeFehler: Error | null = null;

function kanal(id: string, name: string, type = 0): GuildChannel {
  return { id, name, type, parentId: null, position: 0, nsfw: false, overwrites: [] } as GuildChannel;
}

/** Alle Rechte, die ein Log-Kanal braucht - und sonst nichts. */
const ALLE_RECHTE = (1n << 10n) | (1n << 11n) | (1n << 14n);

function gateway(optionen: { kanaele?: GuildChannel[]; rechte?: bigint } = {}): DiscordGateway {
  const kanaele = optionen.kanaele ?? [kanal(KANAL, 'logs-moderation'), kanal(ZWEITER_KANAL, 'server-logs')];
  return {
    channels: {
      list: async () => kanaele,
      botPermissions: async () => optionen.rechte ?? ALLE_RECHTE,
      send: async (channelId: string, payload: DiscordMessagePayload) => {
        if (sendeFehler) {
          throw sendeFehler;
        }
        gesendet.push({ channelId, payload });
        return { id: `msg-${gesendet.length}`, channelId };
      },
    },
  } as unknown as DiscordGateway;
}

async function richteEin(category: string, channelId = KANAL): Promise<void> {
  await logs.setzeZiel({ category: category as never, channelId, actor: AKTEUR }, { gateway: gateway() });
}

async function legeMassnahmeAn(teile: Record<string, unknown> = {}) {
  return prisma.moderationAction.create({
    data: {
      type: 'BAN',
      module: 'moderation',
      actorDiscordId: '100000000000000001',
      actorUsername: 'nina.mod',
      targetDiscordId: '200000000000000002',
      targetUsername: 'spammer',
      reason: 'Spam',
      source: 'WEBAPP',
      ...teile,
    } as never,
  });
}

async function legeEreignisAn(teile: Record<string, unknown> = {}) {
  return prisma.discordEvent.create({
    data: {
      guildId: GUILD,
      category: 'MESSAGE',
      type: analytics.EVENT_TYPES.MESSAGE_DELETE,
      subjectDiscordId: '200000000000000002',
      subjectUsername: 'spammer',
      channelId: '500000000000000005',
      channelName: 'general',
      contentBefore: 'Hallo Welt',
      occurredAt: new Date(),
      ...teile,
    } as never,
  });
}

describeWithDatabase('Discord-Log-Kanäle', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    gesendet = [];
    sendeFehler = null;
    await prisma.discordLogDelivery.deleteMany();
    await prisma.discordLogChannel.deleteMany();
    await prisma.moderationAction.deleteMany();
    await prisma.discordEvent.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  // --- Einrichtung ---------------------------------------------------------

  it('richtet eine Kategorie ein und merkt sich den Kanalnamen', async () => {
    await richteEin('MODERATION');

    const ziele = await logs.ladeZiele();
    const moderation = ziele.find((ziel) => ziel.category === 'MODERATION');
    expect(moderation?.channelId).toBe(KANAL);
    expect(moderation?.channelName).toBe('logs-moderation');
    expect(moderation?.enabled).toBe(true);
    expect(moderation?.health).toBe('HEALTHY');
  });

  it('zeigt jede Kategorie, auch die nicht eingerichteten', async () => {
    const ziele = await logs.ladeZiele();
    expect(ziele).toHaveLength(logs.LOG_KATEGORIE_IDS.length);
    expect(ziele.every((ziel) => ziel.channelId === null)).toBe(true);
  });

  /** Wer alles in einen Kanal schreiben will, soll das können. */
  it('erlaubt denselben Kanal für mehrere Kategorien', async () => {
    await richteEin('MODERATION', ZWEITER_KANAL);
    await richteEin('VOICE', ZWEITER_KANAL);

    await logs.dispatchMassnahme(await legeMassnahmeAn());
    await logs.dispatchEreignis(
      await legeEreignisAn({ category: 'VOICE', type: analytics.EVENT_TYPES.VOICE_JOIN }),
    );

    const zustellungen = await prisma.discordLogDelivery.findMany();
    expect(zustellungen).toHaveLength(2);
    expect(zustellungen.every((zeile) => zeile.channelId === ZWEITER_KANAL)).toBe(true);
  });

  it('schaltet eine Kategorie ab, ohne sie zu vergessen', async () => {
    await richteEin('MODERATION');
    await logs.setzeZiel({ category: 'MODERATION', channelId: null, actor: AKTEUR });

    const ziel = await logs.zielFuer('MODERATION');
    expect(ziel).toBeNull();

    const ergebnis = await logs.dispatchMassnahme(await legeMassnahmeAn());
    expect(ergebnis.ergebnis).toBe('kein-ziel');
    expect(await prisma.discordLogDelivery.count()).toBe(0);
  });

  // --- Kanalprüfung --------------------------------------------------------

  it('weist einen Kanal ab, den es nicht gibt', async () => {
    await expect(
      logs.setzeZiel(
        { category: 'MODERATION', channelId: '999999999999999999', actor: AKTEUR },
        { gateway: gateway() },
      ),
    ).rejects.toThrow();
    expect(await prisma.discordLogChannel.count()).toBe(0);
  });

  it('weist einen Sprachkanal ab', async () => {
    await expect(
      logs.setzeZiel(
        { category: 'MODERATION', channelId: KANAL, actor: AKTEUR },
        { gateway: gateway({ kanaele: [kanal(KANAL, 'sprachkanal', 2)] }) },
      ),
    ).rejects.toThrow();
  });

  /** Ohne «Embeds senden» käme eine leere Nachricht an - das ist kein Log. */
  it('weist einen Kanal ohne Senderecht ab und sagt welches fehlt', async () => {
    const nurLesen = 1n << 10n;
    await expect(
      logs.setzeZiel(
        { category: 'MODERATION', channelId: KANAL, actor: AKTEUR },
        { gateway: gateway({ rechte: nurLesen }) },
      ),
    ).rejects.toThrow(/Nachrichten senden|Embeds senden/u);
  });

  // --- Vom Logeintrag zur Zustellung ---------------------------------------

  it('reiht eine Moderationsmassnahme ein', async () => {
    await richteEin('MODERATION');
    const massnahme = await legeMassnahmeAn();

    const ergebnis = await logs.dispatchMassnahme(massnahme);

    expect(ergebnis.ergebnis).toBe('eingereiht');
    const zustellung = await prisma.discordLogDelivery.findFirst();
    expect(zustellung?.category).toBe('MODERATION');
    expect(zustellung?.status).toBe('PENDING');
    expect(JSON.stringify(zustellung?.payload)).toContain('gebannt');
  });

  it.each([
    ['MESSAGES', 'MESSAGE', analytics.EVENT_TYPES.MESSAGE_DELETE],
    ['VOICE', 'VOICE', analytics.EVENT_TYPES.VOICE_JOIN],
    ['MEMBERS', 'MEMBER', analytics.EVENT_TYPES.MEMBER_JOIN],
    ['ADMIN', 'CHANNEL', analytics.EVENT_TYPES.CHANNEL_DELETE],
  ])('reiht ein Ereignis der Kategorie %s ein', async (kategorie, eventKategorie, type) => {
    await richteEin(kategorie);
    const ereignis = await legeEreignisAn({ category: eventKategorie, type });

    const ergebnis = await logs.dispatchEreignis(ereignis);

    expect(ergebnis.ergebnis).toBe('eingereiht');
    const zustellung = await prisma.discordLogDelivery.findFirst();
    expect(zustellung?.category).toBe(kategorie);
  });

  /**
   * Ein Bann steht einmal in Discord.
   *
   * Über das Dashboard entstehen beide: Akteneintrag und Statistikereignis.
   * Die Akte meldet ihn; das Ereignis, das an ihr hängt, schweigt.
   */
  it('erzeugt für einen Bann über das Dashboard genau eine Nachricht', async () => {
    await richteEin('MODERATION');
    await richteEin('MEMBERS', ZWEITER_KANAL);

    const massnahme = await legeMassnahmeAn();
    await logs.dispatchMassnahme(massnahme);
    await logs.dispatchEreignis(
      await legeEreignisAn({
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_BAN,
        moderationActionId: massnahme.id,
      }),
    );

    expect(await prisma.discordLogDelivery.count()).toBe(1);
  });

  it('erzeugt für einen direkt in Discord verhängten Bann genau eine Nachricht', async () => {
    await richteEin('MODERATION');
    await richteEin('MEMBERS', ZWEITER_KANAL);

    await logs.dispatchMassnahme(await legeMassnahmeAn({ source: 'DISCORD', actorType: 'HUMAN' }));
    // Das Statistikereignis kommt ohne Verknüpfung an - der Typ genügt.
    await logs.dispatchEreignis(
      await legeEreignisAn({ category: 'MEMBER', type: analytics.EVENT_TYPES.MEMBER_BAN }),
    );

    expect(await prisma.discordLogDelivery.count()).toBe(1);
  });

  /** Eine interne Notiz gehört nicht in einen Kanal, den das Team liest. */
  it('gibt eine interne Notiz nicht aus', async () => {
    await richteEin('MODERATION');
    const notiz = await legeMassnahmeAn({ type: 'NOTE', reason: 'Interner Vermerk' });

    const ergebnis = await logs.dispatchMassnahme(notiz);

    expect(ergebnis.ergebnis).toBe('uebersprungen');
    expect(await prisma.discordLogDelivery.count()).toBe(0);
  });

  // --- Keine Schleife ------------------------------------------------------

  /**
   * Der wichtigste Test dieser Datei.
   *
   * Ein Embed im Log-Kanal ist eine Nachricht, die Nachricht wäre ein
   * Ereignis, das Ereignis wieder ein Embed. Ohne diese Sperre füllte sich
   * der Kanal, bis Discord den Bot bremst.
   */
  it('gibt ein Ereignis aus einem Log-Kanal nicht erneut aus', async () => {
    await richteEin('MESSAGES');
    const ereignis = await legeEreignisAn({ channelId: KANAL, channelName: 'logs-moderation' });

    const ergebnis = await logs.dispatchEreignis(ereignis);

    expect(ergebnis).toEqual({ ergebnis: 'uebersprungen', grund: 'log-kanal' });
    expect(await prisma.discordLogDelivery.count()).toBe(0);
  });

  // --- Zustellung ----------------------------------------------------------

  it('stellt eingereihte Nachrichten zu', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());

    const ergebnis = await logs.stelleZu({ gateway: gateway() });

    expect(ergebnis.gesendet).toBe(1);
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]?.channelId).toBe(KANAL);

    const zustellung = await prisma.discordLogDelivery.findFirst();
    expect(zustellung?.status).toBe('SENT');
    expect(zustellung?.discordMessageId).toBe('msg-1');
  });

  /**
   * Niemand wird gepingt.
   *
   * Geloggte Inhalte enthalten regelmässig `@everyone` - im Zweifel genau
   * deshalb, weil sie gelöscht wurden.
   */
  it('sendet ohne jede Erwähnung, auch bei @everyone im Inhalt', async () => {
    await richteEin('MESSAGES');
    await logs.dispatchEreignis(
      await legeEreignisAn({ contentBefore: '@everyone kommt alle her <@123456789012345678>' }),
    );

    await logs.stelleZu({ gateway: gateway() });

    expect(gesendet[0]?.payload.allowedMentions).toEqual({ parse: [] });
  });

  /** Der Vorgang bleibt, auch wenn Discord nicht mitspielt. */
  it('lässt den Logeintrag bestehen, wenn die Zustellung scheitert', async () => {
    await richteEin('MODERATION');
    const massnahme = await legeMassnahmeAn();
    await logs.dispatchMassnahme(massnahme);

    const { DiscordApiError } = await import('@swisshub/discord');
    sendeFehler = new DiscordApiError(404, 10_003, '/channels/x', 'Unknown Channel');
    await logs.stelleZu({ gateway: gateway() });

    expect(await prisma.moderationAction.findUnique({ where: { id: massnahme.id } })).not.toBeNull();
    const zustellung = await prisma.discordLogDelivery.findFirst();
    expect(zustellung?.status).toBe('FAILED');
  });

  /** Ein gelöschter Kanal wird nicht dadurch wieder da, dass man es nochmal probiert. */
  it('gibt bei einem dauerhaften Fehler sofort auf', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());

    const { DiscordApiError } = await import('@swisshub/discord');
    sendeFehler = new DiscordApiError(403, 50_013, '/channels/x', 'Missing Permissions');
    await logs.stelleZu({ gateway: gateway() });

    const zustellung = await prisma.discordLogDelivery.findFirst();
    expect(zustellung?.status).toBe('FAILED');
    expect(zustellung?.attempts).toBe(1);

    const ziel = await prisma.discordLogChannel.findUnique({ where: { category: 'MODERATION' } });
    expect(ziel?.health).toBe('INVALID');
  });

  it('wiederholt bei einer Störung und gibt erst nach drei Versuchen auf', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());

    const { DiscordApiError } = await import('@swisshub/discord');
    sendeFehler = new DiscordApiError(502, undefined, '/channels/x', 'Bad Gateway');

    let jetzt = new Date();
    for (let versuch = 1; versuch <= logs.MAX_VERSUCHE; versuch += 1) {
      await logs.stelleZu({ gateway: gateway(), jetzt });
      jetzt = new Date(jetzt.getTime() + 10 * 60_000);
    }

    const zustellung = await prisma.discordLogDelivery.findFirst();
    expect(zustellung?.attempts).toBe(logs.MAX_VERSUCHE);
    expect(zustellung?.status).toBe('FAILED');

    // Eine Störung ist kein kaputter Kanal.
    const ziel = await prisma.discordLogChannel.findUnique({ where: { category: 'MODERATION' } });
    expect(ziel?.health).toBe('DEGRADED');
  });

  it('wartet zwischen den Versuchen', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());

    const { DiscordApiError } = await import('@swisshub/discord');
    sendeFehler = new DiscordApiError(502, undefined, '/x', 'Bad Gateway');

    const jetzt = new Date();
    await logs.stelleZu({ gateway: gateway(), jetzt });
    // Sofort nochmal: die Zeile ist noch nicht wieder fällig.
    const zweiter = await logs.stelleZu({ gateway: gateway(), jetzt });

    expect(zweiter.gesendet + zweiter.gescheitert + zweiter.verschoben).toBe(0);
  });

  /** Ein erfolgreicher Versuch macht ein angeschlagenes Ziel wieder gesund. */
  it('setzt ein Ziel nach einer erfolgreichen Zustellung zurück', async () => {
    await richteEin('MODERATION');
    await prisma.discordLogChannel.update({
      where: { category: 'MODERATION' },
      data: { health: 'DEGRADED' },
    });
    await logs.dispatchMassnahme(await legeMassnahmeAn());

    await logs.stelleZu({ gateway: gateway() });

    const ziel = await prisma.discordLogChannel.findUnique({ where: { category: 'MODERATION' } });
    expect(ziel?.health).toBe('HEALTHY');
  });

  // --- Nichts zweimal ------------------------------------------------------

  it('reiht denselben Logeintrag kein zweites Mal ein', async () => {
    await richteEin('MODERATION');
    const massnahme = await legeMassnahmeAn();

    const erst = await logs.dispatchMassnahme(massnahme);
    const zweit = await logs.dispatchMassnahme(massnahme);

    expect(erst.ergebnis).toBe('eingereiht');
    expect(zweit.ergebnis).toBe('bereits-eingereiht');
    expect(await prisma.discordLogDelivery.count()).toBe(1);
  });

  it('hält die Eindeutigkeit in der Datenbank fest', async () => {
    await richteEin('MODERATION');
    const massnahme = await legeMassnahmeAn();
    await logs.dispatchMassnahme(massnahme);

    await expect(
      prisma.discordLogDelivery.create({
        data: {
          dedupeKey: logs.dedupeKey('moderation', massnahme.id, KANAL),
          guildId: GUILD,
          category: 'MODERATION',
          channelId: KANAL,
          payload: {},
        },
      }),
    ).rejects.toThrow();
  });

  /**
   * Ein Neustart mitten in der Zustellung.
   *
   * Die Zeile bleibt beansprucht zurück. Sie wird zurückgeholt und
   * weiterverarbeitet - aber nur einmal gesendet.
   */
  it('sendet nach einem Neustart nicht doppelt', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());
    await logs.stelleZu({ gateway: gateway() });

    // Der «Neustart»: die Zeile steht auf SENT und wird nicht erneut geholt.
    await logs.holeSteckengebliebeneZurueck(0);
    await logs.stelleZu({ gateway: gateway() });

    expect(gesendet).toHaveLength(1);
  });

  it('holt eine steckengebliebene Zustellung zurück', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());
    await prisma.discordLogDelivery.updateMany({
      data: { claimedAt: new Date(Date.now() - 3_600_000), claimedBy: 'toter-prozess' },
    });

    const zurueck = await logs.holeSteckengebliebeneZurueck(60_000);
    expect(zurueck).toBe(1);

    await logs.stelleZu({ gateway: gateway() });
    expect(gesendet).toHaveLength(1);
  });

  // --- Reihenfolge und Last ------------------------------------------------

  /** Erst der Bann, dann die Aufhebung - nicht andersherum. */
  it('behält die Reihenfolge je Kanal', async () => {
    await richteEin('MODERATION');
    const bann = await legeMassnahmeAn({ createdAt: new Date(Date.now() - 2_000) });
    await logs.dispatchMassnahme(bann);
    const aufhebung = await legeMassnahmeAn({ type: 'UNBAN', createdAt: new Date() });
    await logs.dispatchMassnahme(aufhebung);

    await logs.stelleZu({ gateway: gateway() });

    expect(JSON.stringify(gesendet[0]?.payload)).toContain('gebannt');
    expect(JSON.stringify(gesendet[1]?.payload)).toContain('aufgehoben');
  });

  /** Viele Ereignisse ergeben mehrere Läufe, keine Flut gleichzeitiger Anfragen. */
  it('sendet je Lauf höchstens einen Stapel', async () => {
    await richteEin('MESSAGES');
    for (let i = 0; i < logs.STAPEL + 5; i += 1) {
      await logs.dispatchEreignis(await legeEreignisAn({ contentBefore: `Nachricht ${i}` }));
    }

    const ergebnis = await logs.stelleZu({ gateway: gateway() });

    expect(ergebnis.gesendet).toBeLessThanOrEqual(logs.STAPEL);
    expect(await prisma.discordLogDelivery.count({ where: { status: 'PENDING' } })).toBeGreaterThan(0);
  });

  // --- Gesundheit ----------------------------------------------------------

  it('erkennt einen gelöschten Kanal', async () => {
    await richteEin('MODERATION');

    const ergebnis = await logs.pruefeAlleZiele({ gateway: gateway({ kanaele: [] }) });

    expect(ergebnis.ungueltig).toBe(1);
    const ziel = await prisma.discordLogChannel.findUnique({ where: { category: 'MODERATION' } });
    expect(ziel?.health).toBe('INVALID');
    expect(ziel?.healthNote).toContain('nicht');
  });

  it('erkennt entzogene Senderechte', async () => {
    await richteEin('MODERATION');

    await logs.pruefeAlleZiele({ gateway: gateway({ rechte: 1n << 10n }) });

    const ziel = await prisma.discordLogChannel.findUnique({ where: { category: 'MODERATION' } });
    expect(ziel?.health).toBe('INVALID');
    expect(ziel?.healthNote).toContain('fehlt');
  });

  /** Ein kaputtes Ziel nimmt nichts mehr an - der Logeintrag bleibt trotzdem. */
  it('reiht für ein ungültiges Ziel nichts mehr ein', async () => {
    await richteEin('MODERATION');
    await prisma.discordLogChannel.update({
      where: { category: 'MODERATION' },
      data: { health: 'INVALID' },
    });

    const massnahme = await legeMassnahmeAn();
    const ergebnis = await logs.dispatchMassnahme(massnahme);

    expect(ergebnis.ergebnis).toBe('kein-ziel');
    expect(await prisma.moderationAction.findUnique({ where: { id: massnahme.id } })).not.toBeNull();
  });

  // --- Testnachricht -------------------------------------------------------

  /** Sie prüft die Verbindung - sie verschiebt keine Zahlen. */
  it('sendet eine Testnachricht, ohne einen Logeintrag zu erzeugen', async () => {
    await richteEin('MODERATION');

    await logs.sendeTestnachricht('MODERATION', AKTEUR, { gateway: gateway() });

    expect(gesendet).toHaveLength(1);
    expect(JSON.stringify(gesendet[0]?.payload)).toContain('Log-Test');
    expect(await prisma.discordLogDelivery.count()).toBe(0);
    expect(await prisma.moderationAction.count()).toBe(0);
    expect(await prisma.discordEvent.count()).toBe(0);
  });

  it('lehnt eine Testnachricht ohne eingerichteten Kanal ab', async () => {
    await expect(
      logs.sendeTestnachricht('MODERATION', AKTEUR, { gateway: gateway() }),
    ).rejects.toThrow();
  });

  // --- Audit ---------------------------------------------------------------

  it('protokolliert die Änderung der Konfiguration', async () => {
    await richteEin('MODERATION');

    const spur = await prisma.auditLog.findFirst({
      where: { action: 'LOG_CHANNEL_CONFIG_CHANGED' },
    });
    expect(spur).not.toBeNull();
    const daten = spur?.metadata as Record<string, unknown>;
    expect(daten.category).toBe('MODERATION');
    expect(daten.neuerKanal).toBe(KANAL);
  });

  it('protokolliert das Abschalten', async () => {
    await richteEin('MODERATION');
    await logs.setzeZiel({ category: 'MODERATION', channelId: null, actor: AKTEUR });

    expect(
      await prisma.auditLog.count({ where: { action: 'LOG_CHANNEL_DISABLED' } }),
    ).toBe(1);
  });

  it('protokolliert die Testnachricht', async () => {
    await richteEin('MODERATION');
    await logs.sendeTestnachricht('MODERATION', AKTEUR, { gateway: gateway() });

    expect(await prisma.auditLog.count({ where: { action: 'LOG_CHANNEL_TEST_SENT' } })).toBe(1);
  });

  /** Nicht jede einzelne Zustellung - die steht ohnehin in ihrer eigenen Tabelle. */
  it('protokolliert keine einzelne Zustellung im Audit Log', async () => {
    await richteEin('MODERATION');
    await logs.dispatchMassnahme(await legeMassnahmeAn());
    await logs.stelleZu({ gateway: gateway() });

    const spuren = await prisma.auditLog.findMany();
    expect(spuren.every((spur) => !spur.action.startsWith('LOG_DELIVERY'))).toBe(true);
  });
});
