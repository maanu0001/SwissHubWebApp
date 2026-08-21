import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Kommunikationsmodul.
 *
 * Geprüft wird der Weg von der validierten Eingabe bis zum Discord-Payload:
 * Validierung, Channel-Berechtigungen, Erwähnungen, Umfrage-Reaktionen,
 * Idempotenz und Verlauf.
 */
const fake = vi.hoisted(() => ({ state: null as unknown, module: null as unknown }));

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const modules = await import('@swisshub/modules');
const { communication } = modules;
const { createMockGateway, setDiscordGateway, clearDiscordCache } = await import('@swisshub/discord');

type State = ReturnType<typeof createFakeState>;

const TEXT_CHANNEL = '700000000000000001'; // moderation-log
const VOICE_CHANNEL = '700000000000000004'; // Lounge
const ROLE = '900000000000000003';

const ACTOR = {
  discordId: '100000000000000001',
  username: 'manuel',
  avatarHash: null,
  permissionKeys: ['communication.send', 'communication.news'] as string[],
  isOwner: false,
};

const MENTION_ACTOR = { ...ACTOR, permissionKeys: [...ACTOR.permissionKeys, 'communication.mention'] };

/** Darf zusätzlich den ganzen Server anpingen - das ist eine eigene Berechtigung. */
const EVERYONE_ACTOR = {
  ...MENTION_ACTOR,
  permissionKeys: [...MENTION_ACTOR.permissionKeys, 'communication.mentionEveryone'],
};

let state: State;
let gateway: ReturnType<typeof createMockGateway>;

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channelId: TEXT_CHANNEL,
    title: 'Server Update',
    content: 'Wir haben neue Regeln.',
    mention: 'none',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

beforeEach(async () => {
  state = fake.state as State;
  state.audits.length = 0;
  state.communicationMessages.length = 0;
  state.idempotency.clear();
  state.roleCache.length = 0;
  state.channelCache.length = 0;
  state.guildConfig = null;
  state.moduleSettings.communication = {
    footerText: 'SwissHub • Zäme hock, zäme zocke',
    autoPollReactions: true,
    allowEveryoneMention: false,
  };

  gateway = createMockGateway();
  setDiscordGateway(gateway);
  clearDiscordCache();

  // Channels in den Sync-Cache spiegeln - daraus kommen die Auswahllisten.
  await modules.connectGuild({ guildId: '000000000000000000' });
  await modules.syncDiscord({ trigger: 'manual' });
});

describe('Validierung', () => {
  it('akzeptiert eine vollständige Neuigkeit', () => {
    const parsed = communication.sendNewsSchema.safeParse(baseInput());
    expect(parsed.success).toBe(true);
  });

  it('lehnt zu kurze Titel und Texte ab', () => {
    expect(communication.sendNewsSchema.safeParse(baseInput({ title: 'ab' })).success).toBe(false);
    expect(communication.sendNewsSchema.safeParse(baseInput({ content: 'x' })).success).toBe(false);
  });

  it('verlangt bei einer Rollen-Erwähnung auch eine Rolle', () => {
    expect(communication.sendNewsSchema.safeParse(baseInput({ mention: 'role' })).success).toBe(false);
    expect(
      communication.sendNewsSchema.safeParse(baseInput({ mention: 'role', mentionRoleId: ROLE })).success,
    ).toBe(true);
  });

  it('verlangt beim Event ein gültiges Datum', () => {
    expect(communication.sendEventSchema.safeParse(baseInput()).success).toBe(false);
    expect(
      communication.sendEventSchema.safeParse(
        baseInput({ startsAt: '2026-09-01T18:00:00.000Z', location: 'Discord Lounge' }),
      ).success,
    ).toBe(true);
  });

  it('verlangt beim Event einen Treffpunkt', () => {
    // Beim Vorgänger war das Feld ebenfalls Pflicht.
    const ohne = communication.sendEventSchema.safeParse(baseInput({ startsAt: '2026-09-01T18:00:00.000Z' }));
    expect(ohne.success).toBe(false);
  });

  it('nimmt beim Event auch freien Datumstext an', () => {
    // Das Discord-Modal von `/post` kennt keinen Datumsauswähler. Was sich
    // nicht zuverlässig deuten lässt, wird als Text übernommen.
    const parsed = communication.sendEventSchema.safeParse(
      baseInput({ startsAtText: '01.01.2026 18:00 Uhr', location: 'Bern' }),
    );
    expect(parsed.success).toBe(true);
  });

  it('verlangt bei "Anmeldung via Adresse" eine https-Adresse', () => {
    const base = { startsAt: '2026-09-01T18:00:00.000Z', location: 'Discord' };
    expect(
      communication.sendEventSchema.safeParse(
        baseInput({ ...base, registrationType: 'URL', registrationValue: 'javascript:alert(1)' }),
      ).success,
    ).toBe(false);
    expect(
      communication.sendEventSchema.safeParse(
        baseInput({ ...base, registrationType: 'URL', registrationValue: 'https://swisshub.gg/anmeldung' }),
      ).success,
    ).toBe(true);
  });

  it('lehnt freien Text als Erwähnung ab', () => {
    // Der alte Bot schrieb hier beliebigen Text unverändert in die Nachricht.
    const parsed = communication.sendNewsSchema.safeParse(baseInput({ mention: '@everyone <@&123>' }));
    expect(parsed.success).toBe(false);
  });

  it('erhält Zeilenumbrüche im Text', () => {
    const parsed = communication.sendNewsSchema.parse(baseInput({ content: 'Zeile 1\n\nZeile 2' }));
    expect(parsed.content).toBe('Zeile 1\n\nZeile 2');
  });
});

describe('Banner-URL', () => {
  it('akzeptiert https', () => {
    expect(communication.validateBannerUrl('https://example.com/banner.png')).toBeNull();
  });

  it('lehnt gefährliche Protokolle ab', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'http://example.com/banner.png',
    ]) {
      expect(communication.validateBannerUrl(url)).not.toBeNull();
    }
  });

  it('lehnt interne Adressen ab', () => {
    for (const url of [
      'https://localhost/banner.png',
      'https://127.0.0.1/banner.png',
      'https://10.0.0.5/banner.png',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      expect(communication.validateBannerUrl(url)).not.toBeNull();
    }
  });

  it('weist eine ungültige Banner-URL bereits im Schema zurück', () => {
    const parsed = communication.sendNewsSchema.safeParse(baseInput({ bannerUrl: 'javascript:alert(1)' }));
    expect(parsed.success).toBe(false);
  });
});

describe('Embed-Payload', () => {
  it('unterdrückt Erwähnungen standardmässig', () => {
    const payload = communication.buildNewsPayload({
      title: 'Titel',
      content: 'Text',
      footerText: 'Footer',
      mention: null,
    });
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.content).toBeUndefined();
  });

  it('gibt eine Rollen-Erwähnung gezielt frei', () => {
    const payload = communication.buildNewsPayload({
      title: 'Titel',
      content: 'Text',
      footerText: 'Footer',
      mention: { kind: 'role', roleId: ROLE },
    });
    expect(payload.content).toBe(`<@&${ROLE}>`);
    expect(payload.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
  });

  it('setzt das Banner als Bild', () => {
    const payload = communication.buildNewsPayload({
      title: 'Titel',
      content: 'Text',
      bannerUrl: 'https://example.com/b.png',
      footerText: 'Footer',
    });
    expect(payload.embeds?.[0]?.image?.url).toBe('https://example.com/b.png');
  });

  it('nutzt Discord-Timestamps für das Event-Datum', () => {
    const startsAt = new Date('2026-09-01T18:00:00.000Z');
    const payload = communication.buildEventPayload({
      title: 'Movie Night',
      content: 'Kommt vorbei',
      footerText: 'Footer',
      startsAt,
      responsibleDiscordId: ACTOR.discordId,
    });
    const unix = Math.floor(startsAt.getTime() / 1000);
    const dateField = payload.embeds?.[0]?.fields?.find((field) => field.name.includes('Datum'));
    expect(dateField?.value).toContain(`<t:${unix}:F>`);
    expect(dateField?.value).toContain(`<t:${unix}:R>`);
  });

  it('erklärt in der Umfrage die Reaktionen', () => {
    const payload = communication.buildPollPayload({
      title: 'Neue Map?',
      content: 'Was meint ihr?',
      footerText: 'Footer',
    });
    expect(payload.embeds?.[0]?.description).toContain('👍 Ja');
    expect(payload.embeds?.[0]?.description).toContain('👎 Nei');
  });
});

describe('Senden', () => {
  it('sendet eine Neuigkeit und schreibt den Verlauf', async () => {
    const input = communication.sendNewsSchema.parse(baseInput());
    const result = await communication.sendNews(input, ACTOR, { gateway });

    expect(result.duplicate).toBe(false);
    expect(result.message.discordMessageId).toBeTruthy();
    expect(state.communicationMessages).toHaveLength(1);
    expect(state.audits.map((entry) => entry.action)).toContain('COMMUNICATION_NEWS_SENT');
  });

  it('lehnt einen Channel ab, der kein Textkanal ist', async () => {
    const input = communication.sendNewsSchema.parse(baseInput({ channelId: VOICE_CHANNEL }));
    await expect(communication.sendNews(input, ACTOR, { gateway })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('setzt bei Umfragen die Reaktionen', async () => {
    const react = vi.spyOn(gateway.channels, 'react');
    const input = communication.sendPollSchema.parse(baseInput());
    await communication.sendPoll(input, { ...ACTOR, permissionKeys: ['communication.poll'] }, { gateway });

    expect(react).toHaveBeenCalledTimes(2);
    expect(react.mock.calls.map((call) => call[2])).toEqual(['👍', '👎']);
  });

  it('sendet die Umfrage auch, wenn die Reaktion scheitert - mit Warnung', async () => {
    vi.spyOn(gateway.channels, 'react').mockRejectedValue(new Error('Missing Permissions'));
    const input = communication.sendPollSchema.parse(baseInput());
    const result = await communication.sendPoll(input, ACTOR, { gateway });

    expect(result.message.discordMessageId).toBeTruthy();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('entfernt Erwähnungen ohne Berechtigung', async () => {
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendNewsSchema.parse(baseInput({ mention: 'role', mentionRoleId: ROLE }));
    const result = await communication.sendNews(input, ACTOR, { gateway });

    expect(result.warnings.some((warning) => warning.includes('Berechtigung'))).toBe(true);
    expect(send.mock.calls[0]?.[1].content).toBeUndefined();
  });

  it('verlangt für @everyone eine eigene Berechtigung', async () => {
    const send = vi.spyOn(gateway.channels, 'send');
    state.moduleSettings.communication = {
      ...(state.moduleSettings.communication as object),
      allowEveryoneMention: true,
    };

    // Wer Erwähnungen senden darf, darf deshalb noch lange nicht den ganzen
    // Server anpingen. Die Nachricht geht raus, sie pingt nur niemanden.
    const input = communication.sendNewsSchema.parse(baseInput({ mention: 'everyone' }));
    const result = await communication.sendNews(input, MENTION_ACTOR, { gateway });
    expect(result.warnings.some((warning) => warning.includes('Berechtigung'))).toBe(true);
    expect(send.mock.calls[0]?.[1].content).toBeUndefined();
  });

  it('erlaubt @everyone nur, wenn Berechtigung UND Einstellung es zulassen', async () => {
    const send = vi.spyOn(gateway.channels, 'send');

    // Berechtigung vorhanden, Einstellung aus -> kein Ping.
    let input = communication.sendNewsSchema.parse(baseInput({ mention: 'everyone' }));
    const blocked = await communication.sendNews(input, EVERYONE_ACTOR, { gateway });
    expect(blocked.warnings.some((warning) => warning.includes('deaktiviert'))).toBe(true);
    expect(send.mock.calls[0]?.[1].content).toBeUndefined();

    // Einstellung an -> Ping mit expliziter Freigabe.
    state.moduleSettings.communication = {
      ...(state.moduleSettings.communication as object),
      allowEveryoneMention: true,
    };
    input = communication.sendNewsSchema.parse(baseInput({ mention: 'everyone' }));
    await communication.sendNews(input, EVERYONE_ACTOR, { gateway });
    expect(send.mock.calls[1]?.[1].content).toBe('@everyone');
    expect(send.mock.calls[1]?.[1].allowedMentions).toEqual({ parse: ['everyone'] });
  });

  it('gibt eine Personen-Erwähnung gezielt frei', async () => {
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendNewsSchema.parse(
      baseInput({ mention: 'user', mentionTarget: '100000000000000002' }),
    );
    await communication.sendNews(input, MENTION_ACTOR, { gateway });

    expect(send.mock.calls[0]?.[1].content).toBe('<@100000000000000002>');
    expect(send.mock.calls[0]?.[1].allowedMentions).toEqual({
      parse: [],
      users: ['100000000000000002'],
    });
  });

  it('sendet bei gleichem Idempotency Key nur einmal', async () => {
    const key = crypto.randomUUID();
    const send = vi.spyOn(gateway.channels, 'send');

    const first = await communication.sendNews(
      communication.sendNewsSchema.parse(baseInput({ idempotencyKey: key })),
      ACTOR,
      { gateway },
    );
    const second = await communication.sendNews(
      communication.sendNewsSchema.parse(baseInput({ idempotencyKey: key })),
      ACTOR,
      { gateway },
    );

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.communicationMessages).toHaveLength(1);
  });

  it('nimmt ohne Auswahl die sendende Person als verantwortlich', async () => {
    // Genau das Verhalten des Vorgängers: `person` war optional, und ohne
    // Angabe stand der Aufrufer im Embed.
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendEventSchema.parse(
      baseInput({ startsAt: '2026-09-01T18:00:00.000Z', location: 'Discord Lounge' }),
    );
    await communication.sendEvent(input, ACTOR, { gateway });

    const fields = send.mock.calls[0]?.[1].embeds?.[0]?.fields ?? [];
    const responsible = fields.find((field) => field.name === 'Verantwortlichi Person');
    expect(responsible?.value).toBe(`<@${ACTOR.discordId}>`);
  });

  it('behält eine ausgewählte verantwortliche Person', async () => {
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendEventSchema.parse(
      baseInput({
        startsAt: '2026-09-01T18:00:00.000Z',
        location: 'Discord Lounge',
        responsibleDiscordId: '100000000000000002',
      }),
    );
    await communication.sendEvent(input, ACTOR, { gateway });

    const fields = send.mock.calls[0]?.[1].embeds?.[0]?.fields ?? [];
    expect(fields.find((field) => field.name === 'Verantwortlichi Person')?.value).toBe(
      '<@100000000000000002>',
    );
  });

  it('setzt beim Ticket-Modus den konfigurierten Channel ein', async () => {
    // Der alte Bot hatte hier eine fest eingetragene Channel-ID im Quelltext.
    state.moduleSettings.communication = {
      ...(state.moduleSettings.communication as object),
      ticketChannelId: '700000000000000002',
    };
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendEventSchema.parse(
      baseInput({
        startsAt: '2026-09-01T18:00:00.000Z',
        location: 'Discord Lounge',
        registrationType: 'TICKET',
      }),
    );
    await communication.sendEvent(input, ACTOR, { gateway });

    const fields = send.mock.calls[0]?.[1].embeds?.[0]?.fields ?? [];
    expect(fields.find((field) => field.name === 'Ahmäldig via')?.value).toBe('<#700000000000000002>');
  });

  it('meldet einen fehlenden Ticket-Channel, statt ins Leere zu verweisen', async () => {
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendEventSchema.parse(
      baseInput({
        startsAt: '2026-09-01T18:00:00.000Z',
        location: 'Discord Lounge',
        registrationType: 'TICKET',
      }),
    );
    const result = await communication.sendEvent(input, ACTOR, { gateway });

    expect(result.warnings.some((warning) => warning.includes('Ticket-Channel'))).toBe(true);
    const fields = send.mock.calls[0]?.[1].embeds?.[0]?.fields ?? [];
    expect(fields.find((field) => field.name === 'Ahmäldig via')?.value).toBe('Kei Ahgab');
  });

  it('verwendet ohne eigenes Banner das hinterlegte Standardbanner', async () => {
    // Ersetzt den fest eingetragenen Imgur-Link des Vorgängers.
    state.moduleSettings.communication = {
      ...(state.moduleSettings.communication as object),
      defaultEventBannerUrl: 'https://swisshub.gg/event.png',
    };
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendEventSchema.parse(
      baseInput({ startsAt: '2026-09-01T18:00:00.000Z', location: 'Discord' }),
    );
    await communication.sendEvent(input, ACTOR, { gateway });

    expect(send.mock.calls[0]?.[1].embeds?.[0]?.image?.url).toBe('https://swisshub.gg/event.png');
  });

  it('sendet ohne Banner und ohne Standardbanner ein Embed ohne Bild', async () => {
    const send = vi.spyOn(gateway.channels, 'send');
    const input = communication.sendEventSchema.parse(
      baseInput({ startsAt: '2026-09-01T18:00:00.000Z', location: 'Discord' }),
    );
    await communication.sendEvent(input, ACTOR, { gateway });

    expect(send.mock.calls[0]?.[1].embeds?.[0]?.image).toBeUndefined();
  });

  it('hält Treffpunkt und Anmeldung im Verlauf fest', async () => {
    const input = communication.sendEventSchema.parse(
      baseInput({
        startsAt: '2026-09-01T18:00:00.000Z',
        location: 'Game Lounge',
        registrationType: 'TEXT',
        registrationValue: 'Meldung im Chat',
      }),
    );
    await communication.sendEvent(input, ACTOR, { gateway });

    const record = state.communicationMessages[0];
    expect(record?.eventLocation).toBe('Game Lounge');
    expect(record?.registrationType).toBe('TEXT');
    expect(record?.registrationValue).toBe('Meldung im Chat');
    expect(record?.source).toBe('WEBAPP');
  });

  it('vermerkt die Quelle eines Slash-Command-Versands', async () => {
    const input = communication.sendEventSchema.parse(
      baseInput({ startsAt: '2026-09-01T18:00:00.000Z', location: 'Discord' }),
    );
    await communication.sendEvent(input, ACTOR, { gateway, source: 'SLASH_COMMAND' });

    expect(state.communicationMessages[0]?.source).toBe('SLASH_COMMAND');
  });

  it('hält einen Fehlschlag im Verlauf fest und gibt den Schlüssel frei', async () => {
    vi.spyOn(gateway.channels, 'send').mockRejectedValueOnce(new Error('Missing Access'));
    const input = communication.sendNewsSchema.parse(baseInput());

    await expect(communication.sendNews(input, ACTOR, { gateway })).rejects.toMatchObject({
      code: 'DISCORD_UNAVAILABLE',
    });
    expect(state.audits.map((entry) => entry.action)).toContain('COMMUNICATION_SEND_FAILED');

    // Ein gescheiterter Versand hinterlässt einen Eintrag - sonst wäre später
    // nicht nachvollziehbar, dass überhaupt etwas versucht wurde.
    expect(state.communicationMessages).toHaveLength(1);
    expect(state.communicationMessages[0]?.status).toBe('FAILED');
    expect(state.communicationMessages[0]?.discordMessageId).toBeNull();
  });

  it('bricht nach einer Frist ab, statt unbegrenzt zu warten', async () => {
    // Discord antwortet nicht. Ohne Frist bliebe die Oberfläche hängen -
    // genau das war der gemeldete Fehler.
    vi.spyOn(gateway.channels, 'send').mockImplementationOnce(() => new Promise(() => undefined) as never);
    const input = communication.sendNewsSchema.parse(baseInput());

    await expect(communication.sendNews(input, ACTOR, { gateway, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'DISCORD_UNAVAILABLE',
    });

    expect(state.communicationMessages[0]?.status).toBe('FAILED');
    expect(state.communicationMessages[0]?.failureCode).toBe('TIMEOUT');
  });

  it('sendet nach einem Timeout nicht versehentlich ein zweites Mal', async () => {
    // Nach einem Timeout ist unklar, ob Discord die Nachricht doch bekommen
    // hat. Ein erneuter Versuch mit demselben Schlüssel darf deshalb nicht
    // noch einmal senden.
    const key = crypto.randomUUID();
    const send = vi
      .spyOn(gateway.channels, 'send')
      .mockImplementationOnce(() => new Promise(() => undefined) as never);

    await expect(
      communication.sendNews(communication.sendNewsSchema.parse(baseInput({ idempotencyKey: key })), ACTOR, {
        gateway,
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE' });

    send.mockClear();
    await expect(
      communication.sendNews(communication.sendNewsSchema.parse(baseInput({ idempotencyKey: key })), ACTOR, {
        gateway,
      }),
    ).rejects.toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Verlauf', () => {
  it('listet gesendete Nachrichten', async () => {
    await communication.sendNews(communication.sendNewsSchema.parse(baseInput()), ACTOR, { gateway });

    const history = await communication.listCommunicationHistory({
      type: 'ALL',
      status: 'ALL',
      page: 1,
      pageSize: 25,
    });
    expect(history.total).toBe(1);
    expect(history.entries[0]?.title).toBe('Server Update');
    expect(history.entries[0]?.discordUrl).toContain('discord.com/channels/');
  });

  it('markiert eine gelöschte Nachricht, statt den Eintrag zu entfernen', async () => {
    const sent = await communication.sendNews(communication.sendNewsSchema.parse(baseInput()), ACTOR, {
      gateway,
    });

    const deleted = await communication.deleteCommunicationMessage(sent.message.id, ACTOR, { gateway });
    expect(deleted.deletedAt).not.toBeNull();
    expect(state.communicationMessages).toHaveLength(1);
    expect(state.audits.map((entry) => entry.action)).toContain('COMMUNICATION_MESSAGE_DELETED');

    const history = await communication.listCommunicationHistory({
      type: 'ALL',
      status: 'ALL',
      page: 1,
      pageSize: 25,
    });
    expect(history.entries[0]?.deletedAt).not.toBeNull();
    expect(history.entries[0]?.discordUrl).toBeNull();
  });
});
