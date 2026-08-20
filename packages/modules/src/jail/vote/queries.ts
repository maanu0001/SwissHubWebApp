import { prisma } from '@swisshub/database';
import { messageLink } from '@swisshub/discord';
import type { VoteJailStatus } from '@swisshub/database';
import { tryResolveGuildId } from '@swisshub/discord';

/**
 * Leseseite der Abstimmungen.
 *
 * Die Listen sind bewusst schlank: was das Dashboard zeigt, kommt vollständig
 * aus der Datenbank - Discord wird dafür nicht angefragt.
 */
export interface VoteJailView {
  id: string;
  status: VoteJailStatus;
  targetDiscordId: string;
  targetUsername: string;
  targetDisplayName: string | null;
  targetAvatarHash: string | null;
  startedByDiscordId: string;
  startedByUsername: string;
  startedByAvatarHash: string | null;
  reason: string | null;
  voteCount: number;
  requiredVotes: number;
  resultingJailMinutes: number;
  resultingJailId: string | null;
  createdAt: Date;
  expiresAt: Date;
  finishedAt: Date | null;
  /** Direkter Link zur Discord-Nachricht, falls bekannt. */
  discordUrl: string | null;
}

export interface VoteJailListQuery {
  tab?: 'active' | 'past';
  limit?: number;
}

export async function listVoteJails(query: VoteJailListQuery = {}): Promise<VoteJailView[]> {
  const active = query.tab !== 'past';
  const [rows, guildId] = await Promise.all([
    prisma.voteJail.findMany({
      where: active ? { status: 'ACTIVE' } : { status: { not: 'ACTIVE' } },
      orderBy: active ? { expiresAt: 'asc' } : { createdAt: 'desc' },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    }),
    tryResolveGuildId(),
  ]);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    targetDiscordId: row.targetDiscordId,
    targetUsername: row.targetUsername,
    targetDisplayName: row.targetDisplayName,
    targetAvatarHash: row.targetAvatarHash,
    startedByDiscordId: row.startedByDiscordId,
    startedByUsername: row.startedByUsername,
    startedByAvatarHash: row.startedByAvatarHash,
    reason: row.reason,
    voteCount: row.voteCount,
    requiredVotes: row.requiredVotes,
    resultingJailMinutes: row.resultingJailMinutes,
    resultingJailId: row.resultingJailId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    finishedAt: row.finishedAt,
    discordUrl:
      guildId && row.discordChannelId && row.discordMessageId
        ? messageLink(guildId, row.discordChannelId, row.discordMessageId)
        : null,
  }));
}

export async function countActiveVoteJails(): Promise<number> {
  return prisma.voteJail.count({ where: { status: 'ACTIVE' } });
}
