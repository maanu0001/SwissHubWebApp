import type { BotGuild, BotIdentity, GuildChannel, GuildMember, GuildRole, GuildSummary } from './types';

/**
 * Zentrale Discord-Abstraktion.
 *
 * Module sprechen ausschliesslich über dieses Interface mit Discord - dadurch
 * bleibt discord.js/REST eine austauschbare Implementierungsdetail-Ebene und
 * sämtliche Aufrufe sind in Tests mockbar.
 */
export interface DiscordGateway {
  members: {
    /** Einzelnes Guild-Mitglied. `null`, wenn es den Server verlassen hat. */
    get(discordId: string): Promise<GuildMember | null>;
    /** Serverseitige Suche nach Username/Nickname. */
    search(query: string, limit?: number): Promise<GuildMember[]>;
    /** Seitenweises Listing (Paginierung über `after`). */
    list(options?: { limit?: number; after?: string }): Promise<GuildMember[]>;
    /** Setzt die vollständige Rollenliste (atomar, ein Request). */
    setRoles(discordId: string, roleIds: string[], reason?: string): Promise<void>;
  };
  roles: {
    list(options?: { force?: boolean }): Promise<GuildRole[]>;
    get(roleId: string): Promise<GuildRole | null>;
    add(discordId: string, roleId: string, reason?: string): Promise<void>;
    remove(discordId: string, roleId: string, reason?: string): Promise<void>;
  };
  channels: {
    list(options?: { force?: boolean }): Promise<GuildChannel[]>;
    send(channelId: string, payload: DiscordMessagePayload): Promise<void>;
  };
  guild: {
    get(): Promise<GuildSummary>;
    memberCount(): Promise<number | null>;
    /** Guilds, in denen der Bot Mitglied ist (automatische Server-Erkennung). */
    listBotGuilds(): Promise<BotGuild[]>;
  };
  bot: {
    identity(): Promise<BotIdentity>;
    /** Der Bot als Guild-Mitglied - Basis für die Rollenhierarchie. */
    member(): Promise<GuildMember | null>;
    /** Höchste Rollenposition des Bots in der Guild. */
    highestRolePosition(): Promise<number>;
  };
  /** True, wenn deterministische Mock-Daten geliefert werden. */
  readonly isMock: boolean;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
  footer?: { text: string };
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
  /** Standardmässig werden sämtliche Mentions unterdrückt. */
  allowedMentions?: { parse: Array<'users' | 'roles' | 'everyone'> };
}
