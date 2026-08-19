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
  type: number;
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

/** Discord Channel Types, die für Log-/Info-Nachrichten in Frage kommen. */
export const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15]);
