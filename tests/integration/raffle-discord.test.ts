import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_raffle_discord');

/**
 * Ankündigung und Teilnahme über Discord.
 *
 * Der Knopf ist die zweite Tür zu derselben Verlosung. Geprüft wird deshalb
 * vor allem, dass er dieselben Regeln anwendet wie die Webseite und dass er
 * dem Embed im Kanal nichts glaubt.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');
const { raffle: R } = level;

const ADMIN = { discordId: '100000000000000020', username: 'verwaltung' };
const CHANNEL = '200000000000000001';

/** Eine Attrappe des Gateways, die festhält, was gesendet wurde. */
function fakeGateway() {
  const sent: Array<{ channelId: string; payload: unknown }> = [];
  const edited: Array<{ messageId: string; payload: unknown }> = [];
  let failEdit = false;
  let counter = 0;

  return {
    sent,
    edited,
    failNextEdits: () => {
      failEdit = true;
    },
    gateway: {
      channels: {
        async send(channelId: string, payload: unknown) {
          sent.push({ channelId, payload });
          counter += 1;
          return { id: `msg-${counter}`, channelId };
        },
        async edit(_channelId: string, messageId: string, payload: unknown) {
          if (failEdit) {
            throw new Error('Unknown Message');
          }
          edited.push({ messageId, payload });
        },
      },
      members: {
        async get(discordId: string) {
          return { discordId, username: 'gewinner', displayName: 'Gewinner', avatarHash: 'abc123' };
        },
      },
    } as never,
  };
}

const draft = (overrides: Record<string, unknown> = {}) =>
  R.raffleSchema.parse({
    title: 'August Giveaway',
    prizeKind: 'EXTERNAL_PRIZE',
    prizeDescription: '1 Monat Discord Nitro',
    entryModel: 'FIXED',
    fixedEntryXp: 500,
    minimumParticipants: 2,
    discordChannelId: CHANNEL,
    ...overrides,
  });

async function giveXp(discordId: string, xp: number): Promise<void> {
  await prisma.levelProfile.upsert({
    where: { discordId },
    create: { discordId, xp },
    update: { xp },
  });
}

describeWithDatabase('XP-Verlosungen auf Discord', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "XpRaffleRefund","XpRaffleDraw","XpRaffleEntry","XpRaffle","XpTransaction","LevelProfile","AuditLog" RESTART IDENTITY CASCADE',
    );
    R.clearPendingRefreshes();
  });

  it('veröffentlicht die Ankündigung und merkt sich die Nachricht', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft());
    await R.publishRaffle(ADMIN, created.id);

    const message = await R.announceRaffle(created.id, { gateway: fake.gateway });

    expect(message?.id).toBe('msg-1');
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.channelId).toBe(CHANNEL);

    const stored = await prisma.xpRaffle.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.discordMessageId).toBe('msg-1');
    expect(stored.discordMessageMissing).toBe(false);
  });

  it('sendet keine Ankündigung ohne Channel', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft({ discordChannelId: '' }));
    await R.publishRaffle(ADMIN, created.id);

    expect(await R.announceRaffle(created.id, { gateway: fake.gateway })).toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('erwähnt in der Ankündigung niemanden', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft());
    await R.publishRaffle(ADMIN, created.id);
    await R.announceRaffle(created.id, { gateway: fake.gateway });

    const payload = fake.sent[0]!.payload as { allowedMentions: { parse: string[] } };
    expect(payload.allowedMentions.parse).toEqual([]);
  });

  it('trägt den Mitmache-Knopf nur bei offener Teilnahme', async () => {
    const created = await R.createRaffle(ADMIN, draft());
    const open = await R.publishRaffle(ADMIN, created.id);
    expect(R.buildRaffleButtons(open).some((b) => 'custom_id' in b)).toBe(true);

    const closed = await R.closeEntries(ADMIN, created.id);
    expect(R.buildRaffleButtons(closed).some((b) => 'custom_id' in b)).toBe(false);
    // Der Verweis auf die Webseite bleibt in jedem Fall.
    expect(R.buildRaffleButtons(closed)).toHaveLength(1);
  });

  it('erkennt die eigene Knopf-Kennung wieder', () => {
    const id = R.raffleButtonId('abc123');
    expect(id).toBe('swisshub:xp-raffle:enter:abc123');
    expect(R.parseRaffleButtonId(id)).toBe('abc123');
    // Fremde Knöpfe gehören anderen Modulen.
    expect(R.parseRaffleButtonId('swisshub:spielersuche:join')).toBeNull();
    expect(R.parseRaffleButtonId('swisshub:xp-raffle:enter:')).toBeNull();
  });

  it('vermerkt eine gelöschte Nachricht, statt still zu scheitern', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft());
    await R.publishRaffle(ADMIN, created.id);
    await R.announceRaffle(created.id, { gateway: fake.gateway });

    fake.failNextEdits();
    expect(await R.refreshAnnouncement(created.id, fake.gateway)).toBe(false);

    const stored = await prisma.xpRaffle.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.discordMessageMissing).toBe(true);
  });

  it('veröffentlicht nach dem Verlust der Nachricht erneut', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft());
    await R.publishRaffle(ADMIN, created.id);
    await R.announceRaffle(created.id, { gateway: fake.gateway });
    await prisma.xpRaffle.update({
      where: { id: created.id },
      data: { discordMessageMissing: true },
    });

    const again = await R.announceRaffle(created.id, {
      gateway: fake.gateway,
      actor: ADMIN,
      republish: true,
    });

    expect(again?.id).toBe('msg-2');
    const stored = await prisma.xpRaffle.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.discordMessageId).toBe('msg-2');
    expect(stored.discordMessageMissing).toBe(false);
  });

  it('fasst Aktualisierungen zusammen, statt bei jeder Teilnahme zu schreiben', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft());
    await R.publishRaffle(ADMIN, created.id);
    await R.announceRaffle(created.id, { gateway: fake.gateway });

    // Zehn Teilnahmen kurz hintereinander. Mit einer kurzen Frist, damit der
    // Test nicht wartet - der Lauf greift auf die Datenbank zu und liesse
    // sich mit einer Zeitgeber-Attrappe nicht vorspulen.
    for (let index = 0; index < 10; index += 1) {
      await R.scheduleAnnouncementRefresh(created.id, { gateway: fake.gateway, delayMs: 50 });
    }
    expect(fake.edited).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 400));
    // Genau eine Aktualisierung statt zehn.
    expect(fake.edited).toHaveLength(1);
  });

  it('zeigt vor der Teilnahme dieselben Kosten wie die Webseite', async () => {
    await giveXp('910000000000000001', 20_000);
    const created = await R.createRaffle(
      ADMIN,
      draft({ entryModel: 'PERCENTAGE', fixedEntryXp: null, percentage: 5 }),
    );
    const open = await R.publishRaffle(ADMIN, created.id);

    const preview = await R.previewEntry('910000000000000001', created.id);
    const prompt = R.buildEntryPrompt(open, preview.currentXp);

    expect(preview.cost.entryXp).toBe(1000);
    expect(prompt).toContain('1’000 XP');
    expect(prompt).toContain('5 % vo dine aktuelle XP');
  });

  it('verkündet den Gewinner und erwähnt nur ihn', async () => {
    const fake = fakeGateway();
    const created = await R.createRaffle(ADMIN, draft());
    await R.publishRaffle(ADMIN, created.id);
    for (const discordId of ['910000000000000101', '910000000000000102']) {
      await giveXp(discordId, 5000);
      await R.enterRaffle({ discordId }, created.id);
    }
    await R.closeEntries(ADMIN, created.id);
    const { draw } = await R.startDraw(ADMIN, created.id);
    await R.confirmWinner(ADMIN, created.id);

    const message = await R.announceWinner(created.id, fake.gateway);
    expect(message).not.toBeNull();

    const payload = fake.sent.at(-1)!.payload as {
      allowedMentions: { parse: string[]; users: string[] };
      embeds: Array<{ description: string; thumbnail?: { url: string } }>;
    };
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.allowedMentions.users).toEqual([draw.winnerDiscordId]);
    expect(payload.embeds[0]!.description).toContain(`<@${draw.winnerDiscordId}>`);
    // Avatar als Vorschaubild. Ohne eigenen Avatar liefert Discord ein
    // Standardbild - eine Adresse steht in beiden Fällen da.
    expect(payload.embeds[0]!.thumbnail?.url).toContain(draw.winnerDiscordId);
    expect(payload.embeds[0]!.thumbnail?.url).toContain('abc123');
  });

  it('beschreibt den Einsatz für Discord auf Schweizerdeutsch', async () => {
    const fixed = await R.createRaffle(ADMIN, draft());
    expect(R.describeEntryCost(fixed)).toBe('500 XP für alli');
    expect(R.describeFairness(fixed)).toContain('glich Chance');

    const percentage = await R.createRaffle(
      ADMIN,
      draft({ entryModel: 'PERCENTAGE', fixedEntryXp: null, percentage: 5, minimumEntryXp: 100 }),
    );
    expect(R.describeEntryCost(percentage)).toBe('5 % vo dine XP · min. 100 XP');
  });
});
