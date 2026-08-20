import { prisma } from '@swisshub/database';
import type { CommunicationMessage } from '@swisshub/database';
import { buildLink } from './service';
import type { CommunicationHistoryQuery } from './schemas';

/**
 * Verlauf der gesendeten Kommunikation.
 *
 * Gelöschte Nachrichten bleiben sichtbar (als gelöscht markiert) - der Verlauf
 * ist Teil der Nachvollziehbarkeit, nicht nur eine Bequemlichkeit.
 */
export interface CommunicationHistoryEntry {
  id: string;
  type: CommunicationMessage['type'];
  title: string;
  content: string;
  bannerUrl: string | null;
  channelId: string;
  channelName: string | null;
  sentByDiscordId: string;
  sentByUsername: string;
  sentByAvatarHash: string | null;
  sentAt: Date;
  deletedAt: Date | null;
  discordUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface CommunicationHistoryResult {
  entries: CommunicationHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCommunicationHistory(
  query: CommunicationHistoryQuery,
): Promise<CommunicationHistoryResult> {
  const where = query.type === 'ALL' ? {} : { type: query.type };
  const [rows, total] = await Promise.all([
    prisma.communicationMessage.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.communicationMessage.count({ where }),
  ]);

  const entries = await Promise.all(rows.map(toEntry));
  return { entries, total, page: query.page, pageSize: query.pageSize };
}

export async function getCommunicationMessage(id: string): Promise<CommunicationHistoryEntry | null> {
  const row = await prisma.communicationMessage.findUnique({ where: { id } });
  return row ? toEntry(row) : null;
}

async function toEntry(row: CommunicationMessage): Promise<CommunicationHistoryEntry> {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    bannerUrl: row.bannerUrl,
    channelId: row.discordChannelId,
    channelName: row.discordChannelName,
    sentByDiscordId: row.sentByDiscordId,
    sentByUsername: row.sentByUsername,
    sentByAvatarHash: row.sentByAvatarHash,
    sentAt: row.sentAt,
    deletedAt: row.deletedAt,
    discordUrl: await buildLink(row),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}
