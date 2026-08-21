import { appUrl } from '@swisshub/config';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { XpRaffle } from '@swisshub/database';
import {
  discord as defaultDiscord,
  getDiscordAvatarUrl,
  BUTTON_STYLE,
  type DiscordGateway,
} from '@swisshub/discord';
import type { DiscordButton, DiscordEmbed, SentMessage } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { formatSwissNumber } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';
import { readLevelSettings } from '../admin';
import { calculateEntryCost } from './entry-cost';
import { latestDraw } from './draw';
import { entryCostRules, requireRaffle } from './service';
import type { RaffleActor } from './schemas';

const logger = createLogger('level.raffle.discord');

/**
 * Ankündigung und Teilnahme auf Discord.
 *
 * Die Nachricht ist nur eine Anzeige. Der Knopf prüft bei jedem Klick den
 * Stand in der Datenbank - einem alten Embed, das seit Tagen im Kanal steht,
 * wird nichts geglaubt.
 */

/** Feste Kennung, damit der Knopf einen Neustart des Bots übersteht. */
export const RAFFLE_BUTTON_PREFIX = 'swisshub:xp-raffle:enter';

export const raffleButtonId = (raffleId: string): string => `${RAFFLE_BUTTON_PREFIX}:${raffleId}`;

/** Liest die Verlosungs-ID aus einer Knopf-Kennung. `null`, wenn es keine ist. */
export function parseRaffleButtonId(customId: string): string | null {
  if (!customId.startsWith(`${RAFFLE_BUTTON_PREFIX}:`)) {
    return null;
  }
  const raffleId = customId.slice(RAFFLE_BUTTON_PREFIX.length + 1);
  return raffleId.length > 0 ? raffleId : null;
}

export const raffleUrl = (): string => appUrl('/xp-gluecksrad');

const number = formatSwissNumber;

const timestamp = (date: Date | null, style: 'R' | 'f' = 'f'): string =>
  date === null ? '—' : `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

/** Beschreibt den Einsatz so, wie ihn die Teilnehmenden verstehen sollen. */
export function describeEntryCost(raffle: XpRaffle): string {
  if (raffle.entryModel === 'FIXED') {
    return `${number(raffle.fixedEntryXp ?? 0)} XP für alli`;
  }
  const percent = (raffle.percentageBasisPoints ?? 0) / 100;
  const parts = [`${percent} % vo dine XP`];
  if (raffle.minimumEntryXp) {
    parts.push(`min. ${number(raffle.minimumEntryXp)} XP`);
  }
  if (raffle.maximumEntryXp) {
    parts.push(`max. ${number(raffle.maximumEntryXp)} XP`);
  }
  return parts.join(' · ');
}

/** Wie die Gewinnchance zustande kommt - in einem Satz. */
export const describeFairness = (raffle: XpRaffle): string =>
  raffle.entryModel === 'FIXED'
    ? 'Alli zahled glich vill und hend die glich Chance.'
    : 'Dini Chance richtet sich nach dim Isatz im Verhältnis zu allne Isätz.';

function bannerUrl(raffle: XpRaffle): string | undefined {
  if (raffle.bannerUrl) {
    return raffle.bannerUrl;
  }
  return undefined;
}

/** Das Embed der Ankündigung. */
export function buildRaffleEmbed(raffle: XpRaffle, accentColor: string): DiscordEmbed {
  const open = raffle.status === 'ENTRY_OPEN';
  const fields = [
    { name: '🎁 Gwünn', value: raffle.prizeDescription.slice(0, 1024), inline: false },
    { name: '💰 Isatz', value: describeEntryCost(raffle), inline: true },
    { name: '👥 Teilnehmer', value: number(raffle.entryCount), inline: true },
    { name: '🎰 XP im Topf', value: `${number(raffle.potXp)} XP`, inline: true },
  ];

  if (raffle.status === 'SCHEDULED') {
    fields.push({ name: '⏰ Start', value: timestamp(raffle.entryStartsAt, 'R'), inline: true });
  } else if (open) {
    fields.push({
      name: '⏰ Mitmache bis',
      value: raffle.entryEndsAt ? timestamp(raffle.entryEndsAt, 'R') : 'Bis zum Schluss durch d Verwaltig',
      inline: true,
    });
  } else if (raffle.status === 'CANCELLED') {
    fields.push({ name: '⚠️ Status', value: 'Abbroche - alli XP sind zrugzahlt', inline: false });
  } else {
    fields.push({ name: '⏰ Status', value: 'D Teilnahm isch zue', inline: true });
  }

  fields.push({ name: '⚖️ Fairness', value: describeFairness(raffle), inline: false });

  return {
    title: `🎡 ${raffle.title}`,
    description: raffle.description
      ? raffle.description.slice(0, 2000)
      : 'Setz dini XP ii und mach bi de Verlosig mit!',
    color: Number.parseInt(accentColor.replace('#', ''), 16),
    fields,
    image: bannerUrl(raffle) ? { url: bannerUrl(raffle)! } : undefined,
    footer: { text: 'SwissHub XP-Glücksrad' },
    url: raffleUrl(),
  };
}

/** Knöpfe unter der Ankündigung. */
export function buildRaffleButtons(raffle: XpRaffle): DiscordButton[] {
  const buttons: DiscordButton[] = [];
  if (raffle.status === 'ENTRY_OPEN') {
    buttons.push({
      type: 2,
      style: BUTTON_STYLE.SUCCESS,
      label: 'Mitmache',
      emoji: { name: '🎟️' },
      custom_id: raffleButtonId(raffle.id),
    });
  }
  buttons.push({
    type: 2,
    style: BUTTON_STYLE.LINK,
    label: 'Zum Glücksrad',
    url: raffleUrl(),
  });
  return buttons;
}

const messagePayload = (raffle: XpRaffle, accentColor: string) => ({
  embeds: [buildRaffleEmbed(raffle, accentColor)],
  components: [{ type: 1 as const, components: buildRaffleButtons(raffle) }],
  // Eine Ankündigung erwähnt niemanden - sonst pingt sie beim Bearbeiten erneut.
  allowedMentions: { parse: [] as never[] },
});

/**
 * Veröffentlicht die Ankündigung.
 *
 * Ohne hinterlegten Channel passiert nichts - eine Verlosung ohne
 * Discord-Ankündigung ist zulässig und funktioniert über die Webseite.
 */
export async function announceRaffle(
  raffleId: string,
  options: { gateway?: DiscordGateway; actor?: RaffleActor; republish?: boolean } = {},
): Promise<SentMessage | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const raffle = await requireRaffle(raffleId);
  if (!raffle.discordChannelId) {
    return null;
  }

  const settings = await readLevelSettings();
  let sent: SentMessage;
  try {
    sent = await gateway.channels.send(raffle.discordChannelId, messagePayload(raffle, settings.accentColor));
  } catch (error) {
    logger.warn('Ankündigung konnte nicht gesendet werden', { raffleId, error });
    return null;
  }

  await prisma.xpRaffle.update({
    where: { id: raffleId },
    data: { discordMessageId: sent.id, discordMessageMissing: false },
  });

  if (options.republish && options.actor) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.XP_RAFFLE_ANNOUNCEMENT_REPUBLISHED,
      module: LEVEL_MODULE_ID,
      actorDiscordId: options.actor.discordId,
      actorUsername: options.actor.username,
      targetLabel: raffle.title,
      success: true,
      metadata: { raffleId, channelId: raffle.discordChannelId, messageId: sent.id },
    });
  }

  return sent;
}

/**
 * Schreibt die Ankündigung fort.
 *
 * Ist die Nachricht nicht mehr auffindbar - jemand hat sie gelöscht -, wird
 * das an der Verlosung vermerkt, damit das Dashboard es anzeigen und eine
 * neue Veröffentlichung anbieten kann.
 */
export async function refreshAnnouncement(
  raffleId: string,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  const raffle = await requireRaffle(raffleId);
  if (!raffle.discordChannelId || !raffle.discordMessageId) {
    return false;
  }

  const settings = await readLevelSettings();
  try {
    await gateway.channels.edit(
      raffle.discordChannelId,
      raffle.discordMessageId,
      messagePayload(raffle, settings.accentColor),
    );
    if (raffle.discordMessageMissing) {
      await prisma.xpRaffle.update({
        where: { id: raffleId },
        data: { discordMessageMissing: false },
      });
    }
    return true;
  } catch (error) {
    logger.warn('Ankündigung konnte nicht aktualisiert werden', { raffleId, error });
    await prisma.xpRaffle.update({ where: { id: raffleId }, data: { discordMessageMissing: true } });
    return false;
  }
}

/**
 * Sammelt Aktualisierungen der Ankündigung.
 *
 * Bei jeder Teilnahme sofort zu bearbeiten hiesse, bei einem Ansturm die
 * Discord-Grenzen zu reissen. Stattdessen wird je Verlosung höchstens alle
 * paar Sekunden geschrieben; zwischendurch eingehende Teilnahmen fallen in
 * dieselbe spätere Aktualisierung.
 */
const pendingRefresh = new Map<string, NodeJS.Timeout>();
export const ANNOUNCEMENT_REFRESH_DELAY_MS = 5000;

export async function scheduleAnnouncementRefresh(
  raffleId: string,
  options: { gateway?: DiscordGateway; delayMs?: number } = {},
): Promise<void> {
  if (pendingRefresh.has(raffleId)) {
    return;
  }
  const delay = options.delayMs ?? ANNOUNCEMENT_REFRESH_DELAY_MS;
  const timer = setTimeout(() => {
    pendingRefresh.delete(raffleId);
    void refreshAnnouncement(raffleId, options.gateway).catch((error: unknown) =>
      logger.warn('Verzögerte Aktualisierung fehlgeschlagen', { raffleId, error }),
    );
  }, delay);
  // Der Zeitgeber darf das Herunterfahren nicht aufhalten - die Anzeige ist
  // Beiwerk, der Stand steht in der Datenbank.
  timer.unref?.();
  pendingRefresh.set(raffleId, timer);
}

/** Nur für Tests: wartende Aktualisierungen verwerfen. */
export function clearPendingRefreshes(): void {
  for (const timer of pendingRefresh.values()) {
    clearTimeout(timer);
  }
  pendingRefresh.clear();
}

/** Verkündet den bestätigten Gewinner. */
export async function announceWinner(
  raffleId: string,
  gateway: DiscordGateway = defaultDiscord,
): Promise<SentMessage | null> {
  const raffle = await requireRaffle(raffleId);
  if (!raffle.discordChannelId) {
    return null;
  }
  const draw = await latestDraw(raffleId);
  if (!draw) {
    return null;
  }

  const settings = await readLevelSettings();
  const member = await gateway.members.get(draw.winnerDiscordId).catch(() => null);

  const embed: DiscordEmbed = {
    title: '🎉 Mir händ en Gwünner!',
    description: `<@${draw.winnerDiscordId}> het d XP-Verlosig gwunne!\n\nDanke allne fürs Mitmache ❤️`,
    color: Number.parseInt(settings.accentColor.replace('#', ''), 16),
    fields: [
      { name: '🎁 Gwünn', value: raffle.prizeDescription.slice(0, 1024), inline: false },
      { name: '🎡 Verlosig', value: raffle.title, inline: true },
      { name: '👥 Teilnehmer', value: number(draw.participantCount), inline: true },
    ],
    thumbnail: { url: getDiscordAvatarUrl(draw.winnerDiscordId, member?.avatarHash ?? null, 256) },
    footer: { text: 'SwissHub XP-Glücksrad' },
  };

  try {
    const sent = await gateway.channels.send(raffle.discordChannelId, {
      embeds: [embed],
      // Die gewinnende Person darf gepingt werden - aber nur sie.
      // Nur die gewinnende Person wird erwähnt - sonst nichts und niemand.
      allowedMentions: { parse: [], users: [draw.winnerDiscordId] },
      components: [
        {
          type: 1,
          components: [{ type: 2, style: BUTTON_STYLE.LINK, label: 'Zum Glücksrad', url: raffleUrl() }],
        },
      ],
    });
    await prisma.xpRaffle.update({ where: { id: raffleId }, data: { winnerMessageId: sent.id } });
    return sent;
  } catch (error) {
    logger.warn('Gewinner konnte nicht verkündet werden', { raffleId, error });
    return null;
  }
}

/**
 * Der Text, den der Knopf vor der Bestätigung zeigt.
 *
 * Die Zahlen stammen aus derselben Berechnung wie die Webseite - es gibt
 * keinen zweiten Preis für denselben Klick.
 */
export function buildEntryPrompt(raffle: XpRaffle, currentXp: number): string {
  const cost = calculateEntryCost(entryCostRules(raffle), currentXp);
  const lines = [`**${raffle.title}**`, ''];

  if (raffle.entryModel === 'PERCENTAGE') {
    const percent = (raffle.percentageBasisPoints ?? 0) / 100;
    lines.push(
      `Dini Teilnahm choschtet aktuell **${number(cost.entryXp)} XP** (${percent} % vo dine aktuelle XP).`,
    );
    if (cost.raisedToMinimum) {
      lines.push(`_Da s Minimum bi ${number(raffle.minimumEntryXp ?? 0)} XP liit._`);
    }
    if (cost.cappedToMaximum) {
      lines.push(`_Begrenzt uf s Maximum vo ${number(raffle.maximumEntryXp ?? 0)} XP._`);
    }
  } else {
    lines.push(`D Teilnahm choschtet **${number(cost.entryXp)} XP**.`);
  }

  lines.push(
    '',
    `Aktuell: **${number(currentXp)} XP**`,
    `Nachher: **${number(Math.max(0, currentXp - cost.entryXp))} XP**`,
    '',
    describeFairness(raffle),
  );

  return lines.join('\n');
}
