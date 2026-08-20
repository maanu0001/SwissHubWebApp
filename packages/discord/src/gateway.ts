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
    /** Sendet eine Nachricht und liefert ihre ID (für Verlauf, Bearbeitung, Links). */
    send(channelId: string, payload: DiscordMessagePayload): Promise<SentMessage>;
    /** Ersetzt Inhalt/Embeds/Buttons einer bereits gesendeten Nachricht. */
    edit(channelId: string, messageId: string, payload: DiscordMessagePayload): Promise<void>;
    /** Löscht eine Nachricht des Bots. */
    delete(channelId: string, messageId: string, reason?: string): Promise<void>;
    /** Fügt eine Reaktion hinzu (Unicode-Emoji). */
    react(channelId: string, messageId: string, emoji: string): Promise<void>;
    /**
     * Effektive Berechtigungen des Bots in einem Channel - inklusive
     * Channel-Overwrites. Grundlage dafür, dass Auswahllisten nur Channels
     * anbieten, in denen der Bot wirklich schreiben darf.
     */
    botPermissions(channelId: string): Promise<bigint>;
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
  /** Grosses Bild unterhalb des Embeds (z.B. Banner). */
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; icon_url?: string };
  url?: string;
}

/** Button-Stile nach Discord (1 = primary … 4 = danger). */
export const BUTTON_STYLE = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
} as const;

export interface DiscordButton {
  type: 2;
  style: (typeof BUTTON_STYLE)[keyof typeof BUTTON_STYLE];
  label: string;
  /** Eigene ID - wird beim Klick an den Bot zurückgegeben. */
  custom_id: string;
  emoji?: { name: string };
  disabled?: boolean;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export interface SentMessage {
  id: string;
  channelId: string;
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
  /**
   * Standardmässig werden sämtliche Mentions unterdrückt. Pings entstehen
   * ausschliesslich dort, wo sie bewusst freigegeben wurden.
   */
  allowedMentions?: { parse: Array<'users' | 'roles' | 'everyone'>; roles?: string[]; users?: string[] };
  components?: DiscordActionRow[];
}
