import { DISCORD_PERMISSIONS, type ChannelOverwrite, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { prisma } from '@swisshub/database';
import type { SpielersucheMatch } from '@swisshub/database';
import type { SpielersucheContext } from './context';

const log = createLogger('spielersuche:voice');

/**
 * Sprachkanäle der Spielersuche.
 *
 * Der alte Bot vergab dem Ersteller unter anderem `manage_channels`. Das ist
 * mehr als nötig: damit liesse sich der Kanal umbenennen, verschieben oder
 * dauerhaft umkonfigurieren. Hier bekommt der Ersteller die Rechte, die er
 * für eine Session wirklich braucht - sprechen, streamen, jemanden
 * stummschalten oder verschieben - aber keine Kanalverwaltung.
 */

/** Rechte, die jedes Mitglied der Gruppe im Kanal erhält. */
const PARTICIPANT_ALLOW =
  DISCORD_PERMISSIONS.VIEW_CHANNEL |
  DISCORD_PERMISSIONS.CONNECT |
  DISCORD_PERMISSIONS.SPEAK |
  DISCORD_PERMISSIONS.STREAM |
  DISCORD_PERMISSIONS.USE_VAD;

/** Zusätzliche Rechte des Erstellers, wenn die Einstellung es erlaubt. */
const CREATOR_MODERATION =
  DISCORD_PERMISSIONS.PRIORITY_SPEAKER |
  DISCORD_PERMISSIONS.MUTE_MEMBERS |
  DISCORD_PERMISSIONS.DEAFEN_MEMBERS |
  DISCORD_PERMISSIONS.MOVE_MEMBERS;

/** Rechte des Bots - ohne sie könnte er den Kanal nicht wieder aufräumen. */
const BOT_ALLOW = PARTICIPANT_ALLOW | DISCORD_PERMISSIONS.MANAGE_CHANNELS | DISCORD_PERMISSIONS.MOVE_MEMBERS;

export function creatorAllowBits(moderation: boolean): bigint {
  return moderation ? PARTICIPANT_ALLOW | CREATOR_MODERATION : PARTICIPANT_ALLOW;
}

/**
 * Baut den Kanalnamen aus der Vorlage.
 *
 * Discord erlaubt 100 Zeichen; problematische Zeichen werden entfernt, damit
 * der Name nicht abgelehnt wird und lesbar bleibt.
 */
export function buildVoiceChannelName(
  template: string,
  values: { game: string; creator: string; id: string },
): string {
  const clean = (value: string): string =>
    value
      .replace(/[^\p{L}\p{N}\p{Zs}\-_.·•]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();

  const rendered = template
    .replace(/\{game\}/gu, clean(values.game).slice(0, 40) || 'Gaming')
    .replace(/\{creator\}/gu, clean(values.creator).slice(0, 25) || 'Spieler')
    .replace(/\{id\}/gu, values.id.slice(-6));

  return rendered.slice(0, 100) || 'Spielersuche';
}

export interface CreateVoiceResult {
  channelId: string;
  name: string;
}

/**
 * Legt den Sprachkanal einer Suche an.
 *
 * Der Kanal ist für alle sichtbar und betretbar - genau wie beim alten Bot,
 * damit spontan jemand dazustossen kann. Ersteller und Teilnehmer bekommen
 * zusätzlich ihre persönlichen Rechte.
 */
export async function createVoiceChannel(
  match: SpielersucheMatch,
  context: SpielersucheContext,
  options: { guildId: string; creatorLabel: string },
): Promise<CreateVoiceResult | null> {
  if (!context.settings.voiceEnabled || !context.voiceCategoryId) {
    return null;
  }

  const name = buildVoiceChannelName(context.settings.voiceNameTemplate, {
    game: match.gameName,
    creator: options.creatorLabel,
    id: match.id,
  });

  const overwrites: ChannelOverwrite[] = [
    // Der Bot zuerst - ohne diese Rechte kann er den Kanal später nicht mehr
    // anfassen, falls die Kategorie sie ihm nicht ohnehin gibt.
    { id: options.guildId, type: 0, allow: PARTICIPANT_ALLOW, deny: 0n },
    {
      id: match.creatorDiscordId,
      type: 1,
      allow: creatorAllowBits(context.settings.voiceCreatorModeration),
      deny: 0n,
    },
  ];

  const botIdentity = await context.gateway.bot.identity().catch(() => null);
  if (botIdentity) {
    overwrites.push({ id: botIdentity.id, type: 1, allow: BOT_ALLOW, deny: 0n });
  }

  try {
    const channel = await context.gateway.voice.create({
      name,
      parentId: context.voiceCategoryId,
      // `maxSquadSize` ist die Gruppengrösse des Spiels; ohne sie begrenzt der
      // Kanal auf die gesuchte Gruppe. `null`/0 = unbegrenzt.
      userLimit: match.maxSquadSize ?? null,
      overwrites,
      reason: `Spielersuche ${match.gameName} von ${options.creatorLabel}`,
    });

    log.info('Sprachkanal erstellt', { matchId: match.id, channelId: channel.id, name });
    return { channelId: channel.id, name: channel.name };
  } catch (error) {
    log.error('Sprachkanal konnte nicht erstellt werden', { error, matchId: match.id });
    return null;
  }
}

/** Gibt einem Mitglied Zugriff auf den Sprachkanal der Suche. */
export async function grantVoiceAccess(
  match: SpielersucheMatch,
  discordId: string,
  context: SpielersucheContext,
): Promise<void> {
  if (!match.voiceChannelId) {
    return;
  }
  const isCreator = discordId === match.creatorDiscordId;
  try {
    await context.gateway.voice.setOverwrite(
      match.voiceChannelId,
      {
        id: discordId,
        type: 1,
        allow: isCreator ? creatorAllowBits(context.settings.voiceCreatorModeration) : PARTICIPANT_ALLOW,
        deny: 0n,
      },
      'Teilnehmer der Spielersuche',
    );
  } catch (error) {
    // Nicht kritisch: der Kanal ist ohnehin für alle offen, die persönliche
    // Ausnahme ist nur eine Zusatzsicherung.
    log.warn('Voice-Berechtigung konnte nicht gesetzt werden', { error, matchId: match.id, discordId });
  }
}

/** Nimmt einem ausgetretenen Mitglied seine persönliche Ausnahme wieder. */
export async function revokeVoiceAccess(
  match: SpielersucheMatch,
  discordId: string,
  context: SpielersucheContext,
): Promise<void> {
  if (!match.voiceChannelId) {
    return;
  }
  try {
    await context.gateway.voice.clearOverwrite(
      match.voiceChannelId,
      discordId,
      'Teilnehmer hat die Spielersuche verlassen',
    );
  } catch (error) {
    log.warn('Voice-Berechtigung konnte nicht entfernt werden', { error, matchId: match.id, discordId });
  }
}

/**
 * Löscht den Sprachkanal einer Suche.
 *
 * `force` überspringt die Prüfung, ob noch jemand drin ist - der Aufrufer
 * kennt den Zustand (der Bot weiss aus dem Voice-Event, dass der Kanal leer
 * ist; das Dashboard weiss es nicht).
 */
export async function deleteVoiceChannel(
  matchId: string,
  context: SpielersucheContext,
  reason = 'Spielersuche beendet',
): Promise<boolean> {
  const match = await prisma.spielersucheMatch.findUnique({ where: { id: matchId } });
  if (!match?.voiceChannelId) {
    return false;
  }

  try {
    await context.gateway.voice.remove(match.voiceChannelId, reason);
  } catch (error) {
    log.warn('Sprachkanal konnte nicht gelöscht werden', { error, matchId });
    return false;
  }

  await prisma.spielersucheMatch.update({
    where: { id: matchId },
    data: { voiceChannelId: null },
  });
  log.info('Sprachkanal gelöscht', { matchId });
  return true;
}

/** Gehört dieser Sprachkanal zu einer Spielersuche? */
export async function findMatchByVoiceChannel(voiceChannelId: string): Promise<SpielersucheMatch | null> {
  return prisma.spielersucheMatch.findFirst({ where: { voiceChannelId } });
}

export type { DiscordGateway };
