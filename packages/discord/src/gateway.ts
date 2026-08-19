import type { GuildChannel, GuildMember, GuildRole, GuildSummary, BotIdentity } from './types';

/**
 * Zentrale Discord-Abstraktion.
 *
 * Module sprechen ausschliesslich ueber dieses Interface mit Discord - dadurch
 * bleibt discord.js/REST eine austauschbare Implementierungsdetail-Ebene und
 * saemtliche Aufrufe sind in Tests mockbar.
 */
export interface DiscordGateway {
  members: {
    /** Einzelnes Guild-Mitglied. `null`, wenn es den Server verlassen hat. */
    get(discordId: string): Promise<GuildMember | null>;
    /** Serverseitige Suche nach Username/Nickname. */
    search(query: string, limit?: number): Promise<GuildMember[]>;
    /** Seitenweises Listing (Paginierung ueber `after`). */
    list(options?: { limit?: number; after?: string }): Promise<GuildMember[]>;
    /** Setzt die vollstaendige Rollenliste (atomar, ein Request). */
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
  };
  bot: {
    identity(): Promise<BotIdentity>;
    /** Der Bot als Guild-Mitglied - Basis fuer die Rollenhierarchie. */
    member(): Promise<GuildMember | null>;
    /** Hoechste Rollenposition des Bots in der Guild. */
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
  /** Standardmaessig werden saemtliche Mentions unterdrueckt. */
  allowedMentions?: { parse: Array<'users' | 'roles' | 'everyone'> };
}
