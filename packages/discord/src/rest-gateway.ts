import { discordConfig } from '@swisshub/config';
import { snowflakeToDate } from '@swisshub/shared';
import { discordRequest } from './rest';
import {
  discordChannelSchema,
  discordGuildSchema,
  discordMemberSchema,
  discordRoleSchema,
  discordUserSchema,
  TEXT_CHANNEL_TYPES,
  type GuildChannel,
  type GuildMember,
  type GuildRole,
  type GuildSummary,
  type BotIdentity,
  type RawDiscordMember,
} from './types';
import type { DiscordGateway, DiscordMessagePayload } from './gateway';

/** Kurzlebiger Cache fuer selten aendernde Guild-Metadaten. */
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

const guildRoute = (): string => `/guilds/${discordConfig.guildId}`;

export function createRestGateway(): DiscordGateway {
  const members: DiscordGateway['members'] = {
    async get(discordId) {
      try {
        const raw = await discordRequest<unknown>(`${guildRoute()}/members/${discordId}`);
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
      const raw = await discordRequest<unknown[]>(`${guildRoute()}/members/search`, {
        query: { query, limit: Math.min(Math.max(limit, 1), 100) },
      });
      return parseMembers(raw);
    },

    async list(options = {}) {
      const raw = await discordRequest<unknown[]>(`${guildRoute()}/members`, {
        query: { limit: Math.min(Math.max(options.limit ?? 50, 1), 1000), after: options.after },
      });
      return parseMembers(raw);
    },

    async setRoles(discordId, roleIds, reason) {
      await discordRequest(`${guildRoute()}/members/${discordId}`, {
        method: 'PATCH',
        body: { roles: [...new Set(roleIds)] },
        auditLogReason: reason,
      });
    },
  };

  const roles: DiscordGateway['roles'] = {
    async list(options = {}) {
      return cached('roles', options.force ?? false, async () => {
        const raw = await discordRequest<unknown[]>(`${guildRoute()}/roles`);
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
      await discordRequest(`${guildRoute()}/members/${discordId}/roles/${roleId}`, {
        method: 'PUT',
        auditLogReason: reason,
      });
    },

    async remove(discordId, roleId, reason) {
      await discordRequest(`${guildRoute()}/members/${discordId}/roles/${roleId}`, {
        method: 'DELETE',
        auditLogReason: reason,
      });
    },
  };

  const channels: DiscordGateway['channels'] = {
    async list(options = {}) {
      return cached('channels', options.force ?? false, async () => {
        const raw = await discordRequest<unknown[]>(`${guildRoute()}/channels`);
        return (Array.isArray(raw) ? raw : [])
          .map((entry) => discordChannelSchema.safeParse(entry))
          .filter((result) => result.success)
          .map((result) => result.data)
          .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
          .map((channel) => ({
            id: channel.id,
            name: channel.name ?? 'unbenannt',
            type: channel.type,
          }));
      });
    },

    async send(channelId, payload: DiscordMessagePayload) {
      await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: {
          content: payload.content,
          embeds: payload.embeds,
          // Standardmaessig keine Pings ausloesen - Log-Nachrichten sollen
          // niemanden benachrichtigen.
          allowed_mentions: payload.allowedMentions ?? { parse: [] },
        },
      });
    },
  };

  const guild: DiscordGateway['guild'] = {
    async get(): Promise<GuildSummary> {
      return cached('guild', false, async () => {
        const raw = await discordRequest<unknown>(guildRoute(), {
          query: { with_counts: 'true' },
        });
        const parsed = discordGuildSchema.parse(raw);
        return {
          id: parsed.id,
          name: parsed.name,
          iconHash: parsed.icon ?? null,
          approximateMemberCount: parsed.approximate_member_count ?? null,
          ownerId: parsed.owner_id ?? null,
        };
      });
    },

    async memberCount() {
      const summary = await guild.get();
      return summary.approximateMemberCount;
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

  return { members, roles, channels, guild, bot, isMock: false };
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
