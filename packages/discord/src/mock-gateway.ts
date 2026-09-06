import { snowflakeToDate } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { DISCORD_PERMISSIONS } from './permissions';
import type { DiscordGateway } from './gateway';
import type { GuildChannel, GuildMember, GuildRole } from './types';

const log = createLogger('discord:mock');

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
    // Die Rolle traegt, was `MOCK_BOT_PERMISSIONS` verspricht. Stuende hier
    // `'0'`, saehe der Mock den Bot je nach Frage einmal als allmaechtig und
    // einmal als rechtlos - und ein Test, der prueft, was der Bot
    // weitergeben kann, bekaeme die falsche Antwort.
    permissions: MOCK_BOT_PERMISSIONS.toString(),
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

/**
 * Die Kanaele des Mocks.
 *
 * Als Konstante und nicht im Rumpf von `list()`, weil `channelsOf()` sie
 * ebenfalls braucht - fuer eine zweite Guild mit denselben Namen und
 * anderen Kennungen.
 */
const MOCK_CHANNELS: GuildChannel[] = [
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

export function createMockGateway(): DiscordGateway {
  const state = new Map(MOCK_MEMBERS.map((member) => [member.discordId, { ...member }]));
  /** Banns im Mock. Wie bei Discord unabhaengig von der Mitgliedschaft. */
  const banns = new Map<string, { discordId: string; username: string; reason: string | null }>();
  const sentMessages = new Map<string, { channelId: string }>();
  let messageCounter = 0;
  // Vom Mock erstellte Sprachkanäle - damit `voice.get` nach dem Anlegen
  // dasselbe liefert wie Discord.
  // Vom Mock verwaltete Kanaele - Sprach- wie Textkanaele.
  const eigeneKanaele = new Map<string, GuildChannel>();
  let kanalZaehler = 0;
  log.warn('Discord Mock-Modus aktiv - es werden KEINE echten Discord-Aktionen ausgeführt');

  const managedChannels: DiscordGateway['managedChannels'] = {
    async createText(input) {
      kanalZaehler += 1;
      const channel = {
        id: `${900000000000000000n + BigInt(kanalZaehler)}`,
        name: input.name,
        type: 0,
        parentId: input.parentId,
        position: kanalZaehler,
        nsfw: false,
        overwrites: (input.overwrites ?? []).map((entry) => ({
          id: entry.id,
          type: entry.type,
          allow: entry.allow.toString(),
          deny: entry.deny.toString(),
        })),
      };
      eigeneKanaele.set(channel.id, channel);
      log.info('Mock: Textkanal erstellt', { name: input.name, id: channel.id });
      return channel;
    },
    async createVoice(input) {
      kanalZaehler += 1;
      const channel = {
        id: `${900000000000000000n + BigInt(kanalZaehler)}`,
        name: input.name,
        type: 2,
        parentId: input.parentId,
        position: kanalZaehler,
        nsfw: false,
        // Wie beim Textkanal: die Ausnahmen der Erstellung merken. Ohne sie
        // saehe jeder Leser einen Kanal ohne Rechte - und ein Test, der
        // prueft, was der Besitzer im eigenen Talk darf, saehe nichts.
        overwrites: (input.overwrites ?? []).map((entry) => ({
          id: entry.id,
          type: entry.type,
          allow: entry.allow.toString(),
          deny: entry.deny.toString(),
        })),
      };
      eigeneKanaele.set(channel.id, channel);
      log.info('Mock: Sprachkanal erstellt', { name: input.name, id: channel.id });
      return channel;
    },
    async setOverwrite(channelId, overwrite) {
      // Der Mock merkt sich die Ausnahme wirklich. Täte er das nicht, sähe
      // jeder Abgleich die Rechte als fehlend an und "reparierte" endlos.
      const channel = eigeneKanaele.get(channelId);
      if (channel) {
        const uebrige = channel.overwrites.filter((entry) => entry.id !== overwrite.id);
        channel.overwrites = [
          ...uebrige,
          {
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.toString(),
            deny: overwrite.deny.toString(),
          },
        ];
      }
      log.debug('Mock: Channel-Berechtigung gesetzt', { channelId, target: overwrite.id });
    },
    async clearOverwrite(channelId, targetId) {
      const channel = eigeneKanaele.get(channelId);
      if (channel) {
        channel.overwrites = channel.overwrites.filter((entry) => entry.id !== targetId);
      }
      log.debug('Mock: Channel-Berechtigung entfernt', { channelId, targetId });
    },
    async move(channelId, parentId) {
      const channel = eigeneKanaele.get(channelId);
      if (channel) {
        channel.parentId = parentId;
      }
      log.debug('Mock: Kanal verschoben', { channelId, parentId });
    },
    async rename(channelId, name) {
      const channel = eigeneKanaele.get(channelId);
      if (channel) {
        channel.name = name;
      }
      log.debug('Mock: Kanal umbenannt', { channelId, name });
    },
    async setTopic(channelId, topic) {
      log.debug('Mock: Kanalthema gesetzt', { channelId, gesetzt: topic !== null });
    },
    async updateVoice(channelId, patch) {
      const channel = eigeneKanaele.get(channelId);
      if (channel) {
        if (patch.name !== undefined) {
          channel.name = patch.name;
        }
        if (patch.userLimit !== undefined) {
          channel.userLimit = patch.userLimit;
        }
        if (patch.bitrate !== undefined) {
          channel.bitrate = patch.bitrate;
        }
        if (patch.parentId !== undefined) {
          channel.parentId = patch.parentId;
        }
      }
      log.debug('Mock: Sprachkanal geändert', { channelId, ...patch });
    },
    async remove(channelId) {
      eigeneKanaele.delete(channelId);
      log.info('Mock: Kanal gelöscht', { channelId });
    },
    async get(channelId) {
      return eigeneKanaele.get(channelId) ?? null;
    },
  };

  // `voice` bleibt der bisherige Zugang und zeigt auf dieselben Funktionen.
  // Bewusst ein stabiles Objekt und kein Getter: ein Getter lieferte bei
  // jedem Zugriff ein neues Objekt, und ein Test, der hier einen Spion setzt,
  // patchte damit etwas, das niemand mehr liest.
  const voice: DiscordGateway['voice'] = {
    create: managedChannels.createVoice,
    setOverwrite: managedChannels.setOverwrite,
    clearOverwrite: managedChannels.clearOverwrite,
    move: managedChannels.move,
    remove: managedChannels.remove,
    get: managedChannels.get,
  };

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
      async moveToVoice(discordId, channelId) {
        log.debug('Mock: Mitglied in Sprachkanal verschoben', { discordId, channelId });
        return true;
      },
      async timeout(discordId, until) {
        const member = state.get(discordId);
        if (member) {
          member.timedOutUntil = until;
        }
        log.debug('Mock: Timeout gesetzt', { discordId, until: until?.toISOString() ?? null });
      },
      async kick(discordId) {
        state.delete(discordId);
        log.debug('Mock: Mitglied entfernt', { discordId });
      },
    },
    bans: {
      async add(discordId, options = {}) {
        const member = state.get(discordId);
        banns.set(discordId, {
          discordId,
          username: member?.username ?? 'Unbekannt',
          reason: options.reason ?? null,
        });
        // Ein Bann entfernt das Mitglied auch vom Server.
        state.delete(discordId);
        log.debug('Mock: Mitglied gebannt', { discordId });
      },
      async remove(discordId) {
        banns.delete(discordId);
        log.debug('Mock: Bann aufgehoben', { discordId });
      },
      async get(discordId) {
        const eintrag = banns.get(discordId);
        return eintrag ? { discordId, reason: eintrag.reason } : null;
      },
      async list(options = {}) {
        return [...banns.values()].slice(0, options.limit ?? 100);
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
        return MOCK_CHANNELS.map((kanal) => ({ ...kanal }));
      },
      async send(channelId, payload) {
        messageCounter += 1;
        const id = `${800000000000000000n + BigInt(messageCounter)}`;
        sentMessages.set(id, { channelId });
        log.info('Mock: Discord-Nachricht', { channelId, title: payload.embeds?.[0]?.title });
        return { id, channelId };
      },
      async sendDirect(discordId, payload) {
        log.info('Mock: Direktnachricht', { discordId, title: payload.embeds?.[0]?.title });
        return true;
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
    managedChannels,
    voice,
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
          // Eine zweite Guild, damit sich eine Uebertragung ueberhaupt
          // nachstellen laesst - mit einer einzigen gaebe es kein Ziel.
          { id: '000000000000000001', name: 'SwissHub Zweitserver (Mock)', iconHash: null, memberCount: 3 },
        ];
      },
      async rolesOf(guildId: string) {
        // Der Mock kennt nur seine eigenen Rollen. Fuer eine fremde Guild
        // liefert er dieselben mit anderen Kennungen - so laesst sich eine
        // Zuordnung nach Namen pruefen, ohne dass die IDs zufaellig passen.
        const eigene = MOCK_ROLES.map((rolle) => ({ ...rolle }));
        if (guildId === '000000000000000000') {
          return eigene;
        }
        return eigene.map((rolle) => ({ ...rolle, id: `9${rolle.id.slice(1)}` }));
      },
      async channelsOf(guildId: string) {
        const eigene = MOCK_CHANNELS.map((kanal) => ({ ...kanal }));
        if (guildId === '000000000000000000') {
          return eigene;
        }
        return eigene.map((kanal) => ({ ...kanal, id: `9${kanal.id.slice(1)}` }));
      },
      async summaryOf(guildId: string) {
        const alle = [
          { id: '000000000000000000', name: 'SwissHub (Mock)' },
          { id: '000000000000000001', name: 'SwissHub Zweitserver (Mock)' },
        ];
        const treffer = alle.find((eintrag) => eintrag.id === guildId);
        return treffer
          ? {
              id: treffer.id,
              name: treffer.name,
              iconHash: null,
              approximateMemberCount: state.size,
              approximatePresenceCount: 0,
              ownerId: '100000000000000001',
            }
          : null;
      },
      async auditLog() {
        // Der Mock kennt kein Audit Log. Eine leere Liste ist die richtige
        // Antwort: sie fuehrt dazu, dass kein Verursacher zugeordnet wird -
        // genau das soll geschehen, wenn nichts belegbar ist.
        return [];
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
      async messageContentAllowed() {
        return true;
      },
    },
    isMock: true,
  };
}
