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
    /**
     * Trennt ein Mitglied aus seinem Sprachkanal.
     *
     * Liefert `true`, wenn getrennt wurde, und `false`, wenn das Mitglied gar
     * nicht in einem Sprachkanal war. Ein fehlgeschlagener Versuch wirft -
     * die Aufrufer behandeln das bewusst als nicht kritisch.
     */
    disconnectFromVoice(discordId: string, reason?: string): Promise<boolean>;
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
    /**
     * Berechtigungen des Bots in **allen** Channels auf einmal.
     *
     * Discord liefert die Rechte-Ausnahmen beim Abruf der Kanalliste mit; die
     * Rechnung passiert danach lokal. Der Aufwand wächst dadurch nicht mehr
     * mit der Zahl der Channels - `botPermissions` je Channel aufzurufen liess
     * Seiten mit vielen Channels minutenlang laden.
     *
     * Ist Discord nicht erreichbar, ist die Antwort leer statt fehlerhaft:
     * die aufrufende Seite soll sich trotzdem öffnen lassen.
     */
    botPermissionsForAll(): Promise<Map<string, bigint>>;
  };
  /**
   * Kanäle, die diese Anwendung selbst anlegt und verwaltet.
   *
   * Bewusst getrennt von `channels`: dort geht es um bestehende Channels und
   * Nachrichten, hier um den Lebenszyklus eigener Kanäle.
   *
   * Anders als `voice` ist dieser Bereich nicht auf Sprachkanäle festgelegt -
   * Ticket-Kanäle sind Textkanäle, brauchen aber denselben Lebenszyklus.
   * `voice` bleibt bestehen und zeigt auf dieselben Funktionen; die Module,
   * die es heute nutzen, ändern sich dadurch nicht.
   */
  managedChannels: {
    /** Legt einen Textkanal in einer Kategorie an. */
    createText(input: CreateTextChannelInput): Promise<GuildChannel>;
    /** Legt einen Sprachkanal in einer Kategorie an. */
    createVoice(input: CreateVoiceChannelInput): Promise<GuildChannel>;
    /** Setzt eine Berechtigungsausnahme für ein Mitglied oder eine Rolle. */
    setOverwrite(channelId: string, overwrite: ChannelOverwrite, reason?: string): Promise<void>;
    /** Entfernt eine Berechtigungsausnahme wieder. */
    clearOverwrite(channelId: string, targetId: string, reason?: string): Promise<void>;
    /** Verschiebt einen Kanal in eine andere Kategorie. */
    move(channelId: string, parentId: string, reason?: string): Promise<void>;
    /** Benennt einen Kanal um. */
    rename(channelId: string, name: string, reason?: string): Promise<void>;
    /** Setzt das Kanalthema; `null` entfernt es. */
    setTopic(channelId: string, topic: string | null, reason?: string): Promise<void>;
    /** Löscht einen Kanal. */
    remove(channelId: string, reason?: string): Promise<void>;
    /** Einzelner Channel; `null`, wenn es ihn nicht mehr gibt. */
    get(channelId: string): Promise<GuildChannel | null>;
  };
  /**
   * Sprachkanäle - der bisherige Zugang, unverändert.
   *
   * Zeigt auf dieselben Funktionen wie `managedChannels`. Neuer Code nimmt
   * besser `managedChannels`, weil dort auch Textkanäle liegen.
   */
  voice: {
    /** Legt einen Sprachkanal in einer Kategorie an. */
    create(input: CreateVoiceChannelInput): Promise<GuildChannel>;
    /** Setzt eine Berechtigungsausnahme für ein Mitglied oder eine Rolle. */
    setOverwrite(channelId: string, overwrite: ChannelOverwrite, reason?: string): Promise<void>;
    /** Entfernt eine Berechtigungsausnahme wieder. */
    clearOverwrite(channelId: string, targetId: string, reason?: string): Promise<void>;
    /** Verschiebt einen Kanal in eine andere Kategorie. */
    move(channelId: string, parentId: string, reason?: string): Promise<void>;
    /** Löscht einen Sprachkanal. */
    remove(channelId: string, reason?: string): Promise<void>;
    /** Einzelner Channel; `null`, wenn es ihn nicht mehr gibt. */
    get(channelId: string): Promise<GuildChannel | null>;
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
    /**
     * Darf der Bot Nachrichteninhalte über das Gateway empfangen?
     *
     * Das privilegierte Intent «Message Content» wird im Discord Developer
     * Portal freigeschaltet. Ohne es liefert Discord leere Inhalte - und
     * discord.js verweigert den Login, wenn ein Bot das Intent anfordert,
     * das er nicht hat. Deshalb wird vor dem Verbinden gefragt statt
     * hinterher gescheitert.
     */
    messageContentAllowed(): Promise<boolean>;
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

/**
 * Button-Stile nach Discord (1 = primary … 4 = danger, 5 = Link).
 *
 * Ein Link-Button löst keine Interaktion aus: Discord öffnet die Adresse
 * direkt. Er trägt deshalb `url` statt `custom_id`.
 */
export const BUTTON_STYLE = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

export interface DiscordActionButton {
  type: 2;
  style: 1 | 2 | 3 | 4;
  label: string;
  /** Eigene ID - wird beim Klick an den Bot zurückgegeben. */
  custom_id: string;
  emoji?: { name: string };
  disabled?: boolean;
}

export interface DiscordLinkButton {
  type: 2;
  style: 5;
  label: string;
  url: string;
  emoji?: { name: string };
  disabled?: boolean;
}

export type DiscordButton = DiscordActionButton | DiscordLinkButton;

export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export interface CreateTextChannelInput {
  name: string;
  /** Kategorie, in der der Kanal entsteht. */
  parentId: string;
  /** Kanalthema. Enthält bewusst keine sensiblen Angaben - es ist sichtbar. */
  topic?: string | null;
  overwrites?: ChannelOverwrite[];
  reason?: string;
}

export interface CreateVoiceChannelInput {
  name: string;
  /** Kategorie, in der der Kanal entsteht. */
  parentId: string;
  /** Teilnehmerlimit; `null` = unbegrenzt. */
  userLimit?: number | null;
  overwrites?: ChannelOverwrite[];
  reason?: string;
}

/**
 * Berechtigungsausnahme eines Channels.
 *
 * `allow`/`deny` sind Discord-Berechtigungsbits. Was weder erlaubt noch
 * verboten ist, erbt der Kanal von der Kategorie - genau wie auf Discord.
 */
export interface ChannelOverwrite {
  id: string;
  /** 0 = Rolle, 1 = Mitglied (Discord-Konvention). */
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
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
