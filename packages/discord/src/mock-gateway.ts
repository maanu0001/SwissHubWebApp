import { snowflakeToDate } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { DISCORD_PERMISSIONS } from './permissions';
import type { DiscordGateway } from './gateway';
import type { GuildChannel, GuildMember, GuildRole } from './types';

const log = createLogger('discord:mock');

/**
 * Deterministische Mock-Daten für die UI-Entwicklung ohne Discord-Zugang.
 *
 * Wird ausschliesslich aktiviert, wenn `DEV_MOCK_DISCORD=true` UND
 * `NODE_ENV !== 'production'` gilt (siehe `discordMocksEnabled()`), damit dieser
 * Modus niemals versehentlich in Produktion landet.
 */
const MOCK_ROLES: GuildRole[] = [
  {
    id: '900000000000000001',
    name: 'Owner',
    color: 0x83060a,
    position: 100,
    managed: false,
    permissions: '8',
  },
  {
    id: '900000000000000002',
    name: 'Administrator',
    color: 0xd13438,
    position: 90,
    managed: false,
    permissions: '8',
  },
  {
    id: '900000000000000003',
    name: 'Moderator',
    color: 0x3b82f6,
    position: 70,
    managed: false,
    permissions: '0',
  },
  {
    id: '900000000000000004',
    name: 'Supporter',
    color: 0x22c55e,
    position: 50,
    managed: false,
    permissions: '0',
  },
  {
    id: '900000000000000005',
    name: 'SwissHub Bot',
    color: 0x94a3b8,
    position: 80,
    managed: true,
    permissions: '0',
  },
  { id: '900000000000000006', name: 'Jail', color: 0x475569, position: 10, managed: false, permissions: '0' },
  {
    id: '900000000000000007',
    name: 'Server Booster',
    color: 0xec4899,
    position: 40,
    managed: true,
    permissions: '0',
  },
  {
    id: '900000000000000008',
    name: 'Member',
    color: 0x64748b,
    position: 5,
    managed: false,
    permissions: '0',
  },
];

const BOT_ID = '800000000000000001';

const MOCK_MEMBERS: GuildMember[] = [
  buildMember('100000000000000001', 'manuel', 'Manuel', ['900000000000000001', '900000000000000008']),
  buildMember('100000000000000002', 'nina.mod', 'Nina', ['900000000000000003', '900000000000000008']),
  buildMember('100000000000000003', 'lars.supporter', 'Lars', ['900000000000000004', '900000000000000008']),
  buildMember('100000000000000004', 'spammer99', 'Spammer', ['900000000000000008']),
  buildMember('100000000000000005', 'alpenfuchs', 'Alpenfuchs', ['900000000000000008', '900000000000000007']),
  buildMember('100000000000000006', 'roeschti', 'Roeschti', ['900000000000000008']),
  { ...buildMember(BOT_ID, 'swisshub-bot', 'SwissHub Bot', ['900000000000000005']), isBot: true },
];

function buildMember(id: string, username: string, displayName: string, roleIds: string[]): GuildMember {
  return {
    discordId: id,
    username,
    globalName: displayName,
    nickname: null,
    displayName,
    avatarHash: null,
    isBot: false,
    roleIds,
    joinedAt: new Date('2024-01-15T12:00:00.000Z'),
    accountCreatedAt: snowflakeToDate(id),
    boosting: roleIds.includes('900000000000000007'),
    timedOutUntil: null,
  };
}

/** Der Mock-Bot darf alles, was die Module brauchen. */
const MOCK_BOT_PERMISSIONS =
  DISCORD_PERMISSIONS.VIEW_CHANNEL |
  DISCORD_PERMISSIONS.SEND_MESSAGES |
  DISCORD_PERMISSIONS.EMBED_LINKS |
  DISCORD_PERMISSIONS.ADD_REACTIONS |
  DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY |
  DISCORD_PERMISSIONS.MANAGE_ROLES |
  DISCORD_PERMISSIONS.MANAGE_CHANNELS |
  DISCORD_PERMISSIONS.CONNECT |
  DISCORD_PERMISSIONS.MOVE_MEMBERS;

export function createMockGateway(): DiscordGateway {
  const state = new Map(MOCK_MEMBERS.map((member) => [member.discordId, { ...member }]));
  const sentMessages = new Map<string, { channelId: string }>();
  let messageCounter = 0;
  // Vom Mock erstellte Sprachkanäle - damit `voice.get` nach dem Anlegen
  // dasselbe liefert wie Discord.
  const voiceChannels = new Map<string, GuildChannel>();
  let voiceCounter = 0;
  log.warn('Discord Mock-Modus aktiv - es werden KEINE echten Discord-Aktionen ausgeführt');

  return {
    members: {
      async get(discordId) {
        return state.get(discordId) ? { ...state.get(discordId)! } : null;
      },
      async search(query, limit = 25) {
        const needle = query.toLowerCase();
        return [...state.values()]
          .filter(
            (member) =>
              member.username.toLowerCase().includes(needle) ||
              member.displayName.toLowerCase().includes(needle) ||
              member.discordId === query,
          )
          .slice(0, limit)
          .map((member) => ({ ...member }));
      },
      async list(options = {}) {
        return [...state.values()].slice(0, options.limit ?? 50).map((member) => ({ ...member }));
      },
      async setRoles(discordId, roleIds) {
        const member = state.get(discordId);
        if (member) {
          member.roleIds = [...new Set(roleIds)];
        }
      },
      async disconnectFromVoice(discordId) {
        // Im Mock ist niemand in einem Sprachkanal - der Aufruf ist folgenlos.
        return state.has(discordId) ? false : false;
      },
    },
    roles: {
      async list() {
        return MOCK_ROLES.map((role) => ({ ...role }));
      },
      async get(roleId) {
        return MOCK_ROLES.find((role) => role.id === roleId) ?? null;
      },
      async add(discordId, roleId) {
        const member = state.get(discordId);
        if (member && !member.roleIds.includes(roleId)) {
          member.roleIds = [...member.roleIds, roleId];
        }
      },
      async remove(discordId, roleId) {
        const member = state.get(discordId);
        if (member) {
          member.roleIds = member.roleIds.filter((id) => id !== roleId);
        }
      },
    },
    channels: {
      async list() {
        return [
          {
            id: '700000000000000010',
            name: 'Moderation',
            type: 4,
            parentId: null,
            position: 0,
            nsfw: false,
            overwrites: [],
          },
          {
            id: '700000000000000001',
            name: 'moderation-log',
            type: 0,
            parentId: '700000000000000010',
            position: 1,
            nsfw: false,
            overwrites: [],
          },
          {
            id: '700000000000000002',
            name: 'jail',
            type: 0,
            parentId: '700000000000000010',
            position: 2,
            nsfw: false,
            overwrites: [],
          },
          {
            id: '700000000000000003',
            name: 'allgemein',
            type: 0,
            parentId: null,
            position: 3,
            nsfw: false,
            overwrites: [],
          },
          {
            id: '700000000000000004',
            name: 'Lounge',
            type: 2,
            parentId: null,
            position: 4,
            nsfw: false,
            overwrites: [],
          },
        ];
      },
      async send(channelId, payload) {
        messageCounter += 1;
        const id = `${800000000000000000n + BigInt(messageCounter)}`;
        sentMessages.set(id, { channelId });
        log.info('Mock: Discord-Nachricht', { channelId, title: payload.embeds?.[0]?.title });
        return { id, channelId };
      },
      async edit(channelId, messageId, payload) {
        log.info('Mock: Nachricht bearbeitet', { channelId, messageId, title: payload.embeds?.[0]?.title });
      },
      async delete(channelId, messageId) {
        sentMessages.delete(messageId);
        log.info('Mock: Nachricht gelöscht', { channelId, messageId });
      },
      async react(channelId, messageId, emoji) {
        log.info('Mock: Reaktion hinzugefügt', { channelId, messageId, emoji });
      },
      async botPermissionsForAll() {
        const result = new Map<string, bigint>();
        for (const channel of await this.list()) {
          result.set(channel.id, MOCK_BOT_PERMISSIONS);
        }
        return result;
      },
      async botPermissions() {
        return MOCK_BOT_PERMISSIONS;
      },
    },
    voice: {
      async create(input) {
        voiceCounter += 1;
        const channel = {
          id: `${900000000000000000n + BigInt(voiceCounter)}`,
          name: input.name,
          type: 2,
          parentId: input.parentId,
          position: voiceCounter,
          nsfw: false,
          overwrites: [],
        };
        voiceChannels.set(channel.id, channel);
        log.info('Mock: Sprachkanal erstellt', { name: input.name, id: channel.id });
        return channel;
      },
      async setOverwrite(channelId, overwrite) {
        log.debug('Mock: Channel-Berechtigung gesetzt', { channelId, target: overwrite.id });
      },
      async clearOverwrite(channelId, targetId) {
        log.debug('Mock: Channel-Berechtigung entfernt', { channelId, targetId });
      },
      async remove(channelId) {
        voiceChannels.delete(channelId);
        log.info('Mock: Sprachkanal gelöscht', { channelId });
      },
      async get(channelId) {
        return voiceChannels.get(channelId) ?? null;
      },
    },
    guild: {
      async get() {
        return {
          id: '000000000000000000',
          name: 'SwissHub (Mock)',
          iconHash: null,
          approximateMemberCount: state.size,
          approximatePresenceCount: Math.max(1, Math.round(state.size / 2)),
          ownerId: '100000000000000001',
        };
      },
      async memberCount() {
        return state.size;
      },
      async listBotGuilds() {
        return [
          { id: '000000000000000000', name: 'SwissHub (Mock)', iconHash: null, memberCount: state.size },
        ];
      },
    },
    bot: {
      async identity() {
        return { id: BOT_ID, username: 'swisshub-bot', avatarHash: null };
      },
      async member() {
        return state.get(BOT_ID) ?? null;
      },
      async highestRolePosition() {
        return 80;
      },
    },
    isMock: true,
  };
}
