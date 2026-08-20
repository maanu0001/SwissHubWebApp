import { bumpConfigRevision, clearRevisionCaches, prisma, revisionCache } from '@swisshub/database';
import { channelKind, clearDiscordCache, discord, type ChannelKind } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import type { DiscordRoleCache } from '@swisshub/database';
import { updateGuildMetadata } from '../guild/config';

const log = createLogger('discord:sync');

const ROLES_CACHE_KEY = 'discord:roles';
const CHANNELS_CACHE_KEY = 'discord:channels';

export type SyncTrigger = 'manual' | 'startup' | 'event' | 'scheduled';

export interface SyncSummary {
  runId: string;
  roles: number;
  channels: number;
  removedRoles: number;
  removedChannels: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Discord Sync.
 *
 * Holt Guild, Rollen und Channels von Discord und spiegelt sie in die
 * Cache-Tabellen. Dadurch:
 *  - liefern Auswahllisten sofort Ergebnisse, ohne Discord bei jedem Klick zu fragen,
 *  - bleiben Namen und Hierarchie auch bei einem Discord-Ausfall sichtbar,
 *  - werden gelöschte Rollen/Channels erkannt und im Dashboard markiert.
 *
 * Mitglieder werden bewusst NICHT gespiegelt (Datensparsamkeit) - sie werden
 * bei Bedarf direkt bei Discord gesucht.
 */
export async function syncDiscord(
  options: { trigger?: SyncTrigger; triggeredBy?: string | null } = {},
): Promise<SyncSummary> {
  const trigger = options.trigger ?? 'manual';
  const started = Date.now();
  const run = await prisma.syncRun.create({
    data: { trigger, triggeredBy: options.triggeredBy ?? null },
  });

  try {
    // Discord-eigene Caches umgehen - der Sync soll den echten Zustand holen.
    clearDiscordCache();

    const [guild, roles, channels] = await Promise.all([
      discord.guild.get(),
      discord.roles.list({ force: true }),
      discord.channels.list({ force: true }),
    ]);

    const now = new Date();

    for (const role of roles) {
      const data = {
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
        permissions: role.permissions,
        syncedAt: now,
        deletedAt: null,
      };
      await prisma.discordRoleCache.upsert({
        where: { roleId: role.id },
        create: { roleId: role.id, ...data },
        update: data,
      });
    }

    for (const channel of channels) {
      const data = {
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.position,
        nsfw: channel.nsfw,
        syncedAt: now,
        deletedAt: null,
      };
      await prisma.discordChannelCache.upsert({
        where: { channelId: channel.id },
        create: { channelId: channel.id, ...data },
        update: data,
      });
    }

    // Was Discord nicht mehr kennt, wird als gelöscht markiert statt entfernt -
    // so bleiben Verweise in Einstellungen sichtbar und korrigierbar.
    const removedRoles = await prisma.discordRoleCache.updateMany({
      where: { roleId: { notIn: roles.map((role) => role.id) }, deletedAt: null },
      data: { deletedAt: now },
    });
    const removedChannels = await prisma.discordChannelCache.updateMany({
      where: { channelId: { notIn: channels.map((channel) => channel.id) }, deletedAt: null },
      data: { deletedAt: now },
    });

    await updateGuildMetadata({
      name: guild.name,
      iconHash: guild.iconHash,
      ownerId: guild.ownerId,
      memberCount: guild.approximateMemberCount,
      presenceCount: guild.approximatePresenceCount,
      lastSyncedAt: now,
    });

    const summary: SyncSummary = {
      runId: run.id,
      roles: roles.length,
      channels: channels.length,
      removedRoles: removedRoles.count,
      removedChannels: removedChannels.count,
      durationMs: Date.now() - started,
      success: true,
    };

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        roles: summary.roles,
        channels: summary.channels,
        removedRoles: summary.removedRoles,
        removedChannels: summary.removedChannels,
        success: true,
      },
    });

    await bumpConfigRevision('discord.synced', options.triggeredBy);
    clearRevisionCaches();

    log.info('Discord synchronisiert', {
      trigger,
      roles: summary.roles,
      channels: summary.channels,
      removedRoles: summary.removedRoles,
      removedChannels: summary.removedChannels,
    });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncRun
      .update({
        where: { id: run.id },
        data: { finishedAt: new Date(), success: false, error: message.slice(0, 500) },
      })
      .catch(() => undefined);
    log.error('Discord-Sync fehlgeschlagen', { trigger, error });
    return {
      runId: run.id,
      roles: 0,
      channels: 0,
      removedRoles: 0,
      removedChannels: 0,
      durationMs: Date.now() - started,
      success: false,
      error: message,
    };
  }
}

export interface CachedRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  permissions: string;
  deleted: boolean;
}

export interface CachedChannel {
  id: string;
  name: string;
  type: number;
  kind: ChannelKind | null;
  parentId: string | null;
  parentName: string | null;
  position: number;
  deleted: boolean;
}

function toRole(row: DiscordRoleCache): CachedRole {
  return {
    id: row.roleId,
    name: row.name,
    color: row.color,
    position: row.position,
    managed: row.managed,
    permissions: row.permissions,
    deleted: row.deletedAt !== null,
  };
}

/**
 * Rollen aus dem Sync-Cache - absteigend nach Position (wie in Discord).
 * Gelöschte Rollen sind standardmässig ausgeblendet, lassen sich aber für
 * Warnhinweise in den Einstellungen mitladen.
 */
export async function listCachedRoles(
  options: { includeDeleted?: boolean; force?: boolean } = {},
): Promise<CachedRole[]> {
  const rows = await revisionCache(
    ROLES_CACHE_KEY,
    async () => prisma.discordRoleCache.findMany({ orderBy: { position: 'desc' } }),
    { maxAgeMs: 60_000, force: options.force },
  );
  return rows.map(toRole).filter((role) => options.includeDeleted || !role.deleted);
}

export async function listCachedChannels(
  options: { includeDeleted?: boolean; kinds?: ChannelKind[]; force?: boolean } = {},
): Promise<CachedChannel[]> {
  const rows = await revisionCache(
    CHANNELS_CACHE_KEY,
    async () => prisma.discordChannelCache.findMany({ orderBy: { position: 'asc' } }),
    { maxAgeMs: 60_000, force: options.force },
  );

  const byId = new Map(rows.map((row) => [row.channelId, row]));
  return rows
    .map((row) => ({
      id: row.channelId,
      name: row.name,
      type: row.type,
      kind: channelKind(row.type),
      parentId: row.parentId,
      parentName: row.parentId ? (byId.get(row.parentId)?.name ?? null) : null,
      position: row.position,
      deleted: row.deletedAt !== null,
    }))
    .filter((channel) => options.includeDeleted || !channel.deleted)
    .filter((channel) => !options.kinds || (channel.kind !== null && options.kinds.includes(channel.kind)));
}

/** Einzelne Rolle aus dem Cache (auch gelöschte, für Warnhinweise). */
export async function findCachedRole(roleId: string): Promise<CachedRole | null> {
  const roles = await listCachedRoles({ includeDeleted: true });
  return roles.find((role) => role.id === roleId) ?? null;
}

export async function findCachedChannel(channelId: string): Promise<CachedChannel | null> {
  const channels = await listCachedChannels({ includeDeleted: true });
  return channels.find((channel) => channel.id === channelId) ?? null;
}

export interface SyncStatus {
  lastSyncedAt: Date | null;
  roles: number;
  channels: number;
  lastRun: {
    trigger: string;
    startedAt: Date;
    finishedAt: Date | null;
    success: boolean;
    error: string | null;
  } | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const [roles, channels, lastRun, guild] = await Promise.all([
    prisma.discordRoleCache.count({ where: { deletedAt: null } }),
    prisma.discordChannelCache.count({ where: { deletedAt: null } }),
    prisma.syncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.guildConfig.findUnique({ where: { id: 'singleton' }, select: { lastSyncedAt: true } }),
  ]);

  return {
    lastSyncedAt: guild?.lastSyncedAt ?? null,
    roles,
    channels,
    lastRun: lastRun
      ? {
          trigger: lastRun.trigger,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          success: lastRun.success,
          error: lastRun.error,
        }
      : null,
  };
}

/** Verwirft die lokalen Sync-Caches (z.B. nach einem Discord-Event). */
export function invalidateSyncCaches(): void {
  clearRevisionCaches(ROLES_CACHE_KEY);
  clearRevisionCaches(CHANNELS_CACHE_KEY);
  clearDiscordCache();
}
