import type { ChannelOverwriteEntry } from './channel-permissions';
import { z } from 'zod';

/**
 * Minimale, validierte Sicht auf die Discord API.
 *
 * Antworten von Discord sind für uns nicht vertrauenswürdige Fremddaten und
 * werden deshalb mit Zod geparst, bevor sie in die Anwendung gelangen.
 */
export const discordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullish(),
  discriminator: z.string().nullish(),
  avatar: z.string().nullish(),
  bot: z.boolean().nullish(),
});

export const discordMemberSchema = z.object({
  user: discordUserSchema.optional(),
  nick: z.string().nullish(),
  avatar: z.string().nullish(),
  roles: z.array(z.string()).default([]),
  joined_at: z.string().nullish(),
  premium_since: z.string().nullish(),
  pending: z.boolean().nullish(),
  communication_disabled_until: z.string().nullish(),
});

export const discordRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().default(0),
  position: z.number().default(0),
  permissions: z.string().default('0'),
  managed: z.boolean().default(false),
  hoist: z.boolean().default(false),
});

export const discordChannelSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  type: z.number(),
  guild_id: z.string().nullish(),
  parent_id: z.string().nullish(),
  position: z.number().nullish(),
  nsfw: z.boolean().nullish(),
  user_limit: z.number().nullish(),
  bitrate: z.number().nullish(),
  // Discord liefert die Rechte-Ausnahmen beim Abruf der Kanalliste mit.
  // Sie zu verwerfen zwang jede Berechtigungsprüfung zu einer eigenen
  // Anfrage je Kanal.
  permission_overwrites: z
    .array(
      z.object({
        id: z.string(),
        type: z.number(),
        allow: z.string(),
        deny: z.string(),
      }),
    )
    .nullish(),
});

/** Guild aus Sicht des Bots (`GET /users/@me/guilds`). */
export const botGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullish(),
  owner: z.boolean().nullish(),
  permissions: z.string().nullish(),
  approximate_member_count: z.number().nullish(),
});

export const discordGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullish(),
  approximate_member_count: z.number().nullish(),
  approximate_presence_count: z.number().nullish(),
  owner_id: z.string().nullish(),
});

export type RawDiscordUser = z.infer<typeof discordUserSchema>;
export type RawDiscordMember = z.infer<typeof discordMemberSchema>;

/** Normalisiertes Guild-Mitglied, wie es die Anwendung verwendet. */
export interface GuildMember {
  discordId: string;
  username: string;
  displayName: string;
  globalName: string | null;
  nickname: string | null;
  avatarHash: string | null;
  isBot: boolean;
  roleIds: string[];
  joinedAt: Date | null;
  /** Aus der Snowflake abgeleitetes Erstellungsdatum des Accounts. */
  accountCreatedAt: Date | null;
  boosting: boolean;
  timedOutUntil: Date | null;
}

export interface GuildRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  /** Rohe Permission-Bits als String (BigInt-sicher). */
  permissions: string;
}

export interface GuildChannel {
  id: string;
  name: string;
  /** Discord Channel Type, siehe `CHANNEL_TYPES`. */
  type: number;
  /** Kategorie, in der der Channel liegt. */
  parentId: string | null;
  position: number;
  nsfw: boolean;
  /**
   * Rechte-Ausnahmen des Channels.
   *
   * Discord liefert sie beim Abruf der Kanalliste ohnehin mit. Sie hier
   * mitzuführen erspart eine eigene Anfrage je Kanal, sobald irgendwo die
   * Berechtigungen für viele Kanäle auf einmal gebraucht werden.
   */
  overwrites: ChannelOverwriteEntry[];
  /**
   * Teilnehmerlimit eines Sprachkanals; `0` bedeutet unbegrenzt.
   *
   * Nur bei Sprachkanaelen gesetzt. Der Abgleich braucht den Wert: ohne ihn
   * liesse sich nicht erkennen, dass jemand das Limit auf Discord von Hand
   * geaendert hat.
   */
  userLimit?: number;
  /** Bitrate eines Sprachkanals in bit/s. */
  bitrate?: number;
}

export interface BotGuild {
  id: string;
  name: string;
  iconHash: string | null;
  memberCount: number | null;
}

export interface GuildSummary {
  id: string;
  name: string;
  iconHash: string | null;
  approximateMemberCount: number | null;
  /** Ungefähre Anzahl aktuell online Mitglieder. */
  approximatePresenceCount: number | null;
  ownerId: string | null;
}

export interface BotIdentity {
  id: string;
  username: string;
  avatarHash: string | null;
}

/** Discord Channel Types (Auszug). */
export const CHANNEL_TYPES = {
  text: 0,
  dm: 1,
  voice: 2,
  category: 4,
  announcement: 5,
  announcementThread: 10,
  publicThread: 11,
  privateThread: 12,
  stage: 13,
  forum: 15,
  media: 16,
} as const;

/** Channel-Typen, in die der Bot Nachrichten senden kann. */
export const TEXT_CHANNEL_TYPES = new Set<number>([
  CHANNEL_TYPES.text,
  CHANNEL_TYPES.announcement,
  CHANNEL_TYPES.announcementThread,
  CHANNEL_TYPES.publicThread,
  CHANNEL_TYPES.privateThread,
  CHANNEL_TYPES.forum,
]);

/** Gruppen, die im Dashboard zur Auswahl angeboten werden. */
export type ChannelKind = 'text' | 'voice' | 'category' | 'forum';

export function channelKind(type: number): ChannelKind | null {
  if (TEXT_CHANNEL_TYPES.has(type) && type !== CHANNEL_TYPES.forum) {
    return 'text';
  }
  if (type === CHANNEL_TYPES.forum || type === CHANNEL_TYPES.media) {
    return 'forum';
  }
  if (type === CHANNEL_TYPES.voice || type === CHANNEL_TYPES.stage) {
    return 'voice';
  }
  if (type === CHANNEL_TYPES.category) {
    return 'category';
  }
  return null;
}

/** Antwort beim Senden einer Nachricht - benötigt wird nur die ID. */
export const discordMessageSchema = z.object({
  id: z.string(),
  channel_id: z.string().optional(),
});

/**
 * Channel-Overwrites für die Berechtigungsberechnung.
 * `type` 0 = Rolle, 1 = Mitglied.
 */
export const channelOverwritesSchema = z.object({
  id: z.string(),
  permission_overwrites: z
    .array(
      z.object({
        id: z.string(),
        type: z.number(),
        allow: z.string(),
        deny: z.string(),
      }),
    )
    .optional(),
});
