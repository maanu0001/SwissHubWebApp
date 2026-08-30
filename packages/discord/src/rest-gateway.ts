import { createLogger } from '@swisshub/logger';
import { resolveGuildId } from './guild-context';
import { snowflakeToDate } from '@swisshub/shared';
import { discordRequest } from './rest';
import { DiscordApiError } from './errors';
import { computeChannelPermissions } from './channel-permissions';
import { DISCORD_PERMISSIONS, combinePermissions, toPermissionBits } from './permissions';
import {
  botGuildSchema,
  discordChannelSchema,
  discordGuildSchema,
  discordMemberSchema,
  discordRoleSchema,
  discordUserSchema,
  type BotGuild,
  type GuildChannel,
  type GuildMember,
  type GuildRole,
  type GuildSummary,
  type BotIdentity,
  CHANNEL_TYPES,
  channelOverwritesSchema,
  discordMessageSchema,
  type RawDiscordMember,
  type AuditLogEntry,
} from './types';
import type { ChannelOverwrite, DiscordGateway, DiscordMessagePayload, SentMessage } from './gateway';

const log = createLogger('discord:gateway');

/** Discord-Payload aus unserer Abstraktion - Mentions sind per Default aus. */
function toMessageBody(payload: DiscordMessagePayload): Record<string, unknown> {
  return {
    content: payload.content,
    embeds: payload.embeds,
    components: payload.components,
    // Ohne explizite Freigabe pingt keine Nachricht jemanden an.
    allowed_mentions: payload.allowedMentions ?? { parse: [] },
  };
}

/** Kurzlebiger Cache für selten ändernde Guild-Metadaten. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, force: boolean, loader: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!force && entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function clearDiscordCache(): void {
  cache.clear();
}

function normaliseMember(raw: RawDiscordMember): GuildMember | null {
  const parsedUser = raw.user ? discordUserSchema.safeParse(raw.user) : null;
  if (!parsedUser?.success) {
    return null;
  }
  const user = parsedUser.data;
  return {
    discordId: user.id,
    username: user.username,
    globalName: user.global_name ?? null,
    nickname: raw.nick ?? null,
    displayName: raw.nick ?? user.global_name ?? user.username,
    avatarHash: user.avatar ?? null,
    isBot: user.bot === true,
    roleIds: raw.roles,
    joinedAt: raw.joined_at ? new Date(raw.joined_at) : null,
    accountCreatedAt: snowflakeToDate(user.id),
    boosting: Boolean(raw.premium_since),
    timedOutUntil: raw.communication_disabled_until ? new Date(raw.communication_disabled_until) : null,
  };
}

const guildRoute = async (): Promise<string> => `/guilds/${await resolveGuildId()}`;

export function createRestGateway(): DiscordGateway {
  const members: DiscordGateway['members'] = {
    async get(discordId) {
      try {
        const raw = await discordRequest<unknown>(`${await guildRoute()}/members/${discordId}`);
        const parsed = discordMemberSchema.safeParse(raw);
        return parsed.success ? normaliseMember(parsed.data) : null;
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async search(query, limit = 25) {
      const raw = await discordRequest<unknown[]>(`${await guildRoute()}/members/search`, {
        query: { query, limit: Math.min(Math.max(limit, 1), 100) },
      });
      return parseMembers(raw);
    },

    async list(options = {}) {
      const raw = await discordRequest<unknown[]>(`${await guildRoute()}/members`, {
        query: { limit: Math.min(Math.max(options.limit ?? 50, 1), 1000), after: options.after },
      });
      return parseMembers(raw);
    },

    async setRoles(discordId, roleIds, reason) {
      await discordRequest(`${await guildRoute()}/members/${discordId}`, {
        method: 'PATCH',
        body: { roles: [...new Set(roleIds)] },
        auditLogReason: reason,
      });
    },
    async disconnectFromVoice(discordId, reason) {
      // `channel_id: null` trennt das Mitglied. Discord antwortet mit 400,
      // wenn es in keinem Sprachkanal ist - das ist kein Fehler, sondern der
      // Normalfall und wird deshalb als "nichts zu tun" gemeldet.
      try {
        await discordRequest(`${await guildRoute()}/members/${discordId}`, {
          method: 'PATCH',
          body: { channel_id: null },
          auditLogReason: reason,
        });
        return true;
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 400) {
          return false;
        }
        throw error;
      }
    },

    async moveToVoice(discordId, channelId, reason) {
      // Discord antwortet mit 400, wenn das Mitglied in keinem Sprachkanal
      // sitzt - dann gibt es nichts zu verschieben. Beim Join-to-Create ist
      // genau das der Fall, wenn jemand den Hub sofort wieder verlaesst.
      try {
        await discordRequest(`${await guildRoute()}/members/${discordId}`, {
          method: 'PATCH',
          body: { channel_id: channelId },
          auditLogReason: reason,
        });
        return true;
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 400) {
          return false;
        }
        throw error;
      }
    },

    async timeout(discordId, until, reason) {
      await discordRequest(`${await guildRoute()}/members/${discordId}`, {
        method: 'PATCH',
        // `null` hebt den Timeout auf - so verlangt es Discord.
        body: { communication_disabled_until: until ? until.toISOString() : null },
        auditLogReason: reason,
      });
    },

    async kick(discordId, reason) {
      await discordRequest(`${await guildRoute()}/members/${discordId}`, {
        method: 'DELETE',
        auditLogReason: reason,
      });
    },
  };

  const bans: DiscordGateway['bans'] = {
    async add(discordId, options = {}) {
      await discordRequest(`${await guildRoute()}/bans/${discordId}`, {
        method: 'PUT',
        body: options.deleteMessageSeconds ? { delete_message_seconds: options.deleteMessageSeconds } : {},
        auditLogReason: options.reason,
      });
    },

    async remove(discordId, reason) {
      await discordRequest(`${await guildRoute()}/bans/${discordId}`, {
        method: 'DELETE',
        auditLogReason: reason,
      });
    },

    async get(discordId) {
      // Discord antwortet mit 404, wenn kein Bann besteht. Das ist eine
      // Antwort und kein Fehler - «nicht gebannt» ist ein gueltiger Zustand.
      try {
        const raw = await discordRequest<{ user?: { id?: string }; reason?: string | null }>(
          `${await guildRoute()}/bans/${discordId}`,
        );
        return { discordId: raw.user?.id ?? discordId, reason: raw.reason ?? null };
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async list(options = {}) {
      const suche = new URLSearchParams({ limit: String(Math.min(options.limit ?? 100, 1000)) });
      if (options.after) {
        suche.set('after', options.after);
      }
      const raw = await discordRequest<unknown[]>(`${await guildRoute()}/bans?${suche.toString()}`);
      return (Array.isArray(raw) ? raw : []).flatMap((eintrag) => {
        const zeile = eintrag as { user?: { id?: string; username?: string }; reason?: string | null };
        const id = zeile.user?.id;
        return id
          ? [{ discordId: id, username: zeile.user?.username ?? 'Unbekannt', reason: zeile.reason ?? null }]
          : [];
      });
    },
  };

  const roles: DiscordGateway['roles'] = {
    async list(options = {}) {
      return cached('roles', options.force ?? false, async () => {
        const raw = await discordRequest<unknown[]>(`${await guildRoute()}/roles`);
        return (Array.isArray(raw) ? raw : [])
          .map((entry) => discordRoleSchema.safeParse(entry))
          .filter((result) => result.success)
          .map((result) => {
            const role = result.data;
            return {
              id: role.id,
              name: role.name,
              color: role.color,
              position: role.position,
              managed: role.managed,
              permissions: role.permissions,
            } satisfies GuildRole;
          });
      });
    },

    async get(roleId) {
      const all = await roles.list();
      return all.find((role) => role.id === roleId) ?? null;
    },

    async add(discordId, roleId, reason) {
      await discordRequest(`${await guildRoute()}/members/${discordId}/roles/${roleId}`, {
        method: 'PUT',
        auditLogReason: reason,
      });
    },

    async remove(discordId, roleId, reason) {
      await discordRequest(`${await guildRoute()}/members/${discordId}/roles/${roleId}`, {
        method: 'DELETE',
        auditLogReason: reason,
      });
    },
  };

  const channels: DiscordGateway['channels'] = {
    async list(options = {}) {
      return cached('channels', options.force ?? false, async () => {
        const raw = await discordRequest<unknown[]>(`${await guildRoute()}/channels`);
        return (Array.isArray(raw) ? raw : [])
          .map((entry) => discordChannelSchema.safeParse(entry))
          .filter((result) => result.success)
          .map((result) => result.data)
          .map((channel) => ({
            id: channel.id,
            name: channel.name ?? 'unbenannt',
            type: channel.type,
            parentId: channel.parent_id ?? null,
            position: channel.position ?? 0,
            nsfw: channel.nsfw ?? false,
            overwrites: channel.permission_overwrites ?? [],
          }))
          .sort((a, b) => a.position - b.position);
      });
    },

    async send(channelId, payload: DiscordMessagePayload): Promise<SentMessage> {
      const raw = await discordRequest<unknown>(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: toMessageBody(payload),
      });
      const parsed = discordMessageSchema.safeParse(raw);
      return { id: parsed.success ? parsed.data.id : '', channelId };
    },

    async edit(channelId, messageId, payload: DiscordMessagePayload) {
      await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: toMessageBody(payload),
      });
    },

    async delete(channelId, messageId, reason) {
      await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE',
        auditLogReason: reason,
      });
    },

    /**
     * Direktnachricht: erst den privaten Kanal öffnen, dann senden.
     *
     * Discord bietet keinen Weg, ohne diesen ersten Schritt an eine Person zu
     * schreiben. Der Kanal bleibt bestehen, das Öffnen ist also nur beim
     * ersten Mal ein echter Vorgang.
     *
     * Eine Ablehnung (403) heisst: die Person nimmt keine Direktnachrichten
     * von diesem Server an. Das wird als `false` gemeldet und nicht als
     * Fehler - siehe die Erklärung am Interface.
     */
    async sendDirect(discordId, payload: DiscordMessagePayload): Promise<boolean> {
      try {
        const kanal = await discordRequest<{ id?: string }>('/users/@me/channels', {
          method: 'POST',
          body: { recipient_id: discordId },
        });
        if (!kanal?.id) {
          return false;
        }
        await discordRequest(`/channels/${kanal.id}/messages`, {
          method: 'POST',
          body: toMessageBody(payload),
        });
        return true;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 403 || status === 400) {
          return false;
        }
        throw error;
      }
    },

    async react(channelId, messageId, emoji) {
      // Unicode-Emoji müssen URL-kodiert werden; @me = eigene Reaktion.
      await discordRequest(
        `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        { method: 'PUT' },
      );
    },

    /**
     * Effektive Berechtigungen des Bots im Channel.
     *
     * Reihenfolge nach Discord: @everyone-Rolle, dann Rollen-Overwrites
     * (erst alle Deny, dann alle Allow), zuletzt der Member-Overwrite.
     * `ADMINISTRATOR` sticht alles.
     */
    async botPermissions(channelId): Promise<bigint> {
      const [identity, botMember, allRoles, guildId] = await Promise.all([
        bot.identity(),
        bot.member(),
        roles.list(),
        resolveGuildId(),
      ]);
      if (!botMember) {
        return 0n;
      }

      const base = combinePermissions(
        allRoles
          .filter((role) => role.id === guildId || botMember.roleIds.includes(role.id))
          .map((role) => role.permissions),
      );
      if ((base & DISCORD_PERMISSIONS.ADMINISTRATOR) !== 0n) {
        return base;
      }

      const raw = await discordRequest<unknown>(`/channels/${channelId}`);
      const parsed = channelOverwritesSchema.safeParse(raw);
      if (!parsed.success) {
        return base;
      }

      let total = base;
      const overwrites = parsed.data.permission_overwrites ?? [];

      const everyone = overwrites.find((entry) => entry.id === guildId);
      if (everyone) {
        total = (total & ~toPermissionBits(everyone.deny)) | toPermissionBits(everyone.allow);
      }

      let allow = 0n;
      let deny = 0n;
      for (const entry of overwrites) {
        if (entry.type === 0 && entry.id !== guildId && botMember.roleIds.includes(entry.id)) {
          allow |= toPermissionBits(entry.allow);
          deny |= toPermissionBits(entry.deny);
        }
      }
      total = (total & ~deny) | allow;

      const member = overwrites.find((entry) => entry.type === 1 && entry.id === identity.id);
      if (member) {
        total = (total & ~toPermissionBits(member.deny)) | toPermissionBits(member.allow);
      }

      return total;
    },

    async botPermissionsForAll(): Promise<Map<string, bigint>> {
      const result = new Map<string, bigint>();
      try {
        const [identity, botMember, allRoles, guildId, allChannels] = await Promise.all([
          bot.identity(),
          bot.member(),
          roles.list(),
          resolveGuildId(),
          channels.list(),
        ]);
        if (!botMember) {
          return result;
        }

        const base = combinePermissions(
          allRoles
            .filter((role) => role.id === guildId || botMember.roleIds.includes(role.id))
            .map((role) => role.permissions),
        );

        for (const channel of allChannels) {
          result.set(
            channel.id,
            computeChannelPermissions({
              basePermissions: base,
              overwrites: channel.overwrites,
              botRoleIds: botMember.roleIds,
              guildId,
              botUserId: identity.id,
            }),
          );
        }
      } catch (error) {
        // Bewusst leer statt Fehler: die aufrufende Seite zeigt die Channels
        // dann ohne Angaben zu den Berechtigungen an, statt gar nicht zu laden.
        log.warn('Channel-Berechtigungen konnten nicht ermittelt werden', { error });
      }
      return result;
    },
  };

  /**
   * Sprachkanäle des Moduls Spielersuche.
   *
   * Der Kanal-Cache oben wird nach dem Anlegen und Löschen gezielt entwertet:
   * sonst würde die Auswahl im Dashboard einen gerade erstellten Kanal noch
   * eine Minute lang nicht kennen.
   */
  /**
   * Aus der Discord-Antwort einen Kanal bauen.
   *
   * Discord liefert bei `POST /channels` und `GET /channels/{id}` dieselbe
   * Struktur - deshalb eine Stelle statt zweier fast gleicher.
   */
  const alsKanal = (raw: unknown, ersatzName: string): GuildChannel => {
    const parsed = discordChannelSchema.parse(raw);
    return {
      id: parsed.id,
      name: parsed.name ?? ersatzName,
      type: parsed.type,
      parentId: parsed.parent_id ?? null,
      position: parsed.position ?? 0,
      nsfw: parsed.nsfw ?? false,
      overwrites: parsed.permission_overwrites ?? [],
      ...(parsed.user_limit !== null && parsed.user_limit !== undefined
        ? { userLimit: parsed.user_limit }
        : {}),
      ...(parsed.bitrate !== null && parsed.bitrate !== undefined ? { bitrate: parsed.bitrate } : {}),
    };
  };

  const alsUeberschreibungen = (
    overwrites: ChannelOverwrite[] | undefined,
  ): Array<{ id: string; type: number; allow: string; deny: string }> =>
    (overwrites ?? []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      allow: entry.allow.toString(),
      deny: entry.deny.toString(),
    }));

  const managedChannels: DiscordGateway['managedChannels'] = {
    async createText(input) {
      const raw = await discordRequest<unknown>(`${await guildRoute()}/channels`, {
        method: 'POST',
        body: {
          name: input.name,
          type: CHANNEL_TYPES.text,
          parent_id: input.parentId,
          topic: input.topic ?? undefined,
          permission_overwrites: alsUeberschreibungen(input.overwrites),
        },
        auditLogReason: input.reason,
      });
      cache.delete('channels');
      return alsKanal(raw, input.name);
    },

    async createVoice(input) {
      const raw = await discordRequest<unknown>(`${await guildRoute()}/channels`, {
        method: 'POST',
        body: {
          name: input.name,
          type: CHANNEL_TYPES.voice,
          parent_id: input.parentId,
          user_limit: input.userLimit ?? 0,
          ...(input.bitrate ? { bitrate: input.bitrate } : {}),
          permission_overwrites: alsUeberschreibungen(input.overwrites),
        },
        auditLogReason: input.reason,
      });
      cache.delete('channels');
      return alsKanal(raw, input.name);
    },

    async setOverwrite(channelId, overwrite, reason) {
      await discordRequest(`/channels/${channelId}/permissions/${overwrite.id}`, {
        method: 'PUT',
        body: {
          type: overwrite.type,
          allow: overwrite.allow.toString(),
          deny: overwrite.deny.toString(),
        },
        auditLogReason: reason,
      });
    },

    async clearOverwrite(channelId, targetId, reason) {
      await discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
        method: 'DELETE',
        auditLogReason: reason,
      });
    },

    async move(channelId, parentId, reason) {
      await discordRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body: { parent_id: parentId },
        auditLogReason: reason,
      });
      cache.delete('channels');
    },

    async rename(channelId, name, reason) {
      await discordRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body: { name },
        auditLogReason: reason,
      });
      cache.delete('channels');
    },

    async setTopic(channelId, topic, reason) {
      await discordRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body: { topic: topic ?? '' },
        auditLogReason: reason,
      });
      cache.delete('channels');
    },

    async updateVoice(channelId, patch, reason) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) {
        body.name = patch.name;
      }
      if (patch.userLimit !== undefined) {
        body.user_limit = patch.userLimit;
      }
      if (patch.bitrate !== undefined) {
        body.bitrate = patch.bitrate;
      }
      if (patch.parentId !== undefined) {
        body.parent_id = patch.parentId;
      }
      if (Object.keys(body).length === 0) {
        // Nichts zu tun. Ein leerer PATCH kostet trotzdem ein Rate-Limit-Fenster.
        return;
      }
      await discordRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body,
        auditLogReason: reason,
      });
      cache.delete('channels');
    },

    async remove(channelId, reason) {
      await discordRequest(`/channels/${channelId}`, { method: 'DELETE', auditLogReason: reason });
      cache.delete('channels');
    },

    async get(channelId) {
      try {
        const raw = await discordRequest<unknown>(`/channels/${channelId}`);
        return alsKanal(raw, 'unbenannt');
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  };

  // `voice` bleibt der bisherige Zugang und zeigt auf dieselben Funktionen -
  // die Module, die es heute nutzen, aendern sich dadurch nicht.
  const voice: DiscordGateway['voice'] = {
    create: managedChannels.createVoice,
    setOverwrite: managedChannels.setOverwrite,
    clearOverwrite: managedChannels.clearOverwrite,
    move: managedChannels.move,
    remove: managedChannels.remove,
    get: managedChannels.get,
  };

  const guild: DiscordGateway['guild'] = {
    async get(): Promise<GuildSummary> {
      return cached('guild', false, async () => {
        const raw = await discordRequest<unknown>(await guildRoute(), {
          query: { with_counts: 'true' },
        });
        const parsed = discordGuildSchema.parse(raw);
        return {
          id: parsed.id,
          name: parsed.name,
          iconHash: parsed.icon ?? null,
          approximateMemberCount: parsed.approximate_member_count ?? null,
          approximatePresenceCount: parsed.approximate_presence_count ?? null,
          ownerId: parsed.owner_id ?? null,
        };
      });
    },

    async memberCount() {
      const summary = await guild.get();
      return summary.approximateMemberCount;
    },

    /**
     * Guilds, in denen der Bot Mitglied ist. Grundlage der automatischen
     * Server-Erkennung im Einrichtungsassistenten.
     */
    async listBotGuilds(): Promise<BotGuild[]> {
      const raw = await discordRequest<unknown[]>('/users/@me/guilds', {
        query: { with_counts: 'true' },
      });
      return (Array.isArray(raw) ? raw : [])
        .map((entry) => botGuildSchema.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => ({
          id: result.data.id,
          name: result.data.name,
          iconHash: result.data.icon ?? null,
          memberCount: result.data.approximate_member_count ?? null,
        }));
    },

    /**
     * Audit-Log-Eintraege, neueste zuerst.
     *
     * Wird von der Analytics-Ingestion gebraucht, um einem Gateway-Ereignis
     * einen Verursacher zuzuordnen. Faellt der Abruf aus - fehlende
     * Berechtigung `VIEW_AUDIT_LOG`, Discord-Stoerung - bleibt der Verursacher
     * unbekannt; das ist der richtige Ausgang, kein Fehler.
     */
    async auditLog(options): Promise<AuditLogEntry[]> {
      const suche = new URLSearchParams({ limit: String(Math.min(options.limit ?? 10, 100)) });
      if (options.actionType !== undefined) {
        suche.set('action_type', String(options.actionType));
      }
      if (options.userId) {
        suche.set('user_id', options.userId);
      }
      if (options.after) {
        suche.set('after', options.after);
      }

      const raw = await discordRequest<{
        audit_log_entries?: unknown[];
        users?: Array<{ id?: string; username?: string; bot?: boolean }>;
      }>(`${await guildRoute()}/audit-logs?${suche.toString()}`);

      // Discord liefert die Handelnden getrennt von den Eintraegen. Neben dem
      // Namen zaehlt hier, ob es ein Bot war - in der Moderationsakte ist das
      // ein Unterschied.
      const benutzer = new Map(
        (raw.users ?? []).flatMap((eintrag) =>
          eintrag.id
            ? [[eintrag.id, { name: eintrag.username ?? null, bot: eintrag.bot ?? false }] as const]
            : [],
        ),
      );

      return (raw.audit_log_entries ?? []).flatMap((eintrag) => {
        const zeile = eintrag as {
          id?: string;
          action_type?: number;
          user_id?: string | null;
          target_id?: string | null;
          reason?: string | null;
          options?: { count?: string; channel_id?: string };
        };
        if (!zeile.id || typeof zeile.action_type !== 'number') {
          return [];
        }
        const zahl = Number(zeile.options?.count);
        return [
          {
            id: zeile.id,
            actionType: zeile.action_type,
            userId: zeile.user_id ?? null,
            username: zeile.user_id ? (benutzer.get(zeile.user_id)?.name ?? null) : null,
            bot: zeile.user_id ? (benutzer.get(zeile.user_id)?.bot ?? null) : null,
            targetId: zeile.target_id ?? null,
            reason: zeile.reason ?? null,
            count: Number.isFinite(zahl) ? zahl : null,
            channelId: zeile.options?.channel_id ?? null,
            createdAt: snowflakeToDate(zeile.id) ?? new Date(0),
          },
        ];
      });
    },
  };

  const bot: DiscordGateway['bot'] = {
    async identity(): Promise<BotIdentity> {
      return cached('bot:identity', false, async () => {
        const raw = await discordRequest<unknown>('/users/@me');
        const parsed = discordUserSchema.parse(raw);
        return { id: parsed.id, username: parsed.username, avatarHash: parsed.avatar ?? null };
      });
    },

    async member() {
      const identity = await bot.identity();
      return members.get(identity.id);
    },

    async messageContentAllowed() {
      return cached('bot:message-content', false, async () => {
        // Die Anwendung traegt die Freischaltung in ihren Flags: Bit 18 fuer
        // die unbegrenzte, Bit 19 fuer die auf 100 Server begrenzte Fassung.
        // Beide bedeuten dasselbe fuer uns - der Inhalt kommt an.
        const raw = await discordRequest<{ flags?: number }>('/applications/@me');
        const flags = typeof raw?.flags === 'number' ? raw.flags : 0;
        const UNBEGRENZT = 1 << 18;
        const BEGRENZT = 1 << 19;
        return (flags & UNBEGRENZT) !== 0 || (flags & BEGRENZT) !== 0;
      });
    },

    async highestRolePosition() {
      const [botMember, allRoles] = await Promise.all([bot.member(), roles.list()]);
      if (!botMember) {
        return 0;
      }
      const positions = botMember.roleIds
        .map((roleId) => allRoles.find((role) => role.id === roleId)?.position ?? 0)
        .concat(0);
      return Math.max(...positions);
    },
  };

  return { members, bans, roles, channels, managedChannels, voice, guild, bot, isMock: false };
}

function parseMembers(raw: unknown): GuildMember[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => discordMemberSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => normaliseMember(result.data))
    .filter((member): member is GuildMember => member !== null);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: number }).status === 404
  );
}

export { normaliseMember, type GuildChannel, type GuildRole };
