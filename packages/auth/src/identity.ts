import { identityConfig } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import type { GuildMember } from '@swisshub/discord';

const log = createLogger('auth:identity');

/**
 * Guild-Mitgliedschaft und Discord-Rollen aktuell halten.
 *
 * Rollen können sich jederzeit ändern. Deshalb gilt:
 *  - normale Seitenaufrufe dürfen den Cache (TTL) verwenden,
 *  - sicherheitskritische Aktionen erzwingen einen frischen Abruf.
 */
export interface DiscordIdentity {
  discordId: string;
  isMember: boolean;
  roleIds: string[];
  nickname: string | null;
  displayName: string | null;
  joinedGuildAt: Date | null;
  fetchedAt: Date;
  /** True, wenn die Daten aus dem Cache stammen. */
  fromCache: boolean;
}

export interface IdentityOptions {
  /** Maximales Alter der Daten in Millisekunden. */
  maxAgeMs?: number;
  /** Erzwingt einen Abruf bei Discord. */
  force?: boolean;
}

export async function getIdentity(
  discordId: string,
  options: IdentityOptions = {},
): Promise<DiscordIdentity> {
  const maxAgeMs = options.maxAgeMs ?? identityConfig.cacheTtlMs;

  if (!options.force) {
    const cached = await prisma.discordIdentityCache.findUnique({ where: { discordId } });
    if (cached && Date.now() - cached.fetchedAt.getTime() <= maxAgeMs) {
      return {
        discordId,
        isMember: cached.isMember,
        roleIds: cached.roleIds,
        nickname: cached.nickname,
        displayName: cached.nickname,
        joinedGuildAt: cached.joinedGuildAt,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
      };
    }
  }

  return refreshIdentity(discordId);
}

/** Lädt Mitgliedschaft und Rollen frisch von Discord und aktualisiert den Cache. */
export async function refreshIdentity(discordId: string): Promise<DiscordIdentity> {
  let member: GuildMember | null = null;
  try {
    member = await discord.members.get(discordId);
  } catch (error) {
    log.error('Discord-Identität konnte nicht geladen werden', { error, discordId });
    // Fail closed: ohne verlässliche Rolleninformationen gilt der Benutzer als
    // nicht berechtigt. Der Cache wird dabei bewusst nicht überschrieben.
    const cached = await prisma.discordIdentityCache.findUnique({ where: { discordId } });
    return {
      discordId,
      isMember: false,
      roleIds: [],
      nickname: cached?.nickname ?? null,
      displayName: cached?.nickname ?? null,
      joinedGuildAt: cached?.joinedGuildAt ?? null,
      fetchedAt: new Date(0),
      fromCache: false,
    };
  }

  const now = new Date();
  const data = {
    isMember: member !== null,
    roleIds: member?.roleIds ?? [],
    nickname: member?.nickname ?? null,
    joinedGuildAt: member?.joinedAt ?? null,
    fetchedAt: now,
  };

  await prisma.discordIdentityCache
    .upsert({ where: { discordId }, create: { discordId, ...data }, update: data })
    .catch((error: unknown) => log.warn('Identity-Cache konnte nicht geschrieben werden', { error }));

  if (member) {
    // Anzeigedaten des Kontos aktuell halten (Username-Änderungen auf Discord).
    await prisma.user
      .updateMany({
        where: { discordId },
        data: {
          username: member.username,
          globalName: member.globalName,
          avatarHash: member.avatarHash,
        },
      })
      .catch(() => undefined);
  }

  return {
    discordId,
    isMember: data.isMember,
    roleIds: data.roleIds,
    nickname: data.nickname,
    displayName: member?.displayName ?? null,
    joinedGuildAt: data.joinedGuildAt,
    fetchedAt: now,
    fromCache: false,
  };
}

/** Verwirft den Cache-Eintrag, z.B. nach einer Rollenänderung durch den Bot. */
export async function invalidateIdentity(discordId: string): Promise<void> {
  await prisma.discordIdentityCache
    .updateMany({ where: { discordId }, data: { fetchedAt: new Date(0) } })
    .catch(() => undefined);
}
