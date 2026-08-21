import { prisma } from '@swisshub/database';
import type { CommunicationMessage, Prisma } from '@swisshub/database';
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
  status: CommunicationMessage['status'];
  source: CommunicationMessage['source'];
  title: string;
  content: string;
  bannerUrl: string | null;
  channelId: string;
  channelName: string | null;
  discordMessageId: string | null;
  sentByDiscordId: string;
  sentByUsername: string;
  sentByAvatarHash: string | null;
  sentAt: Date;
  deletedAt: Date | null;
  editedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  mentionType: CommunicationMessage['mentionType'];
  mentionTarget: string | null;
  eventLocation: string | null;
  eventStartsAt: Date | null;
  eventDateText: string | null;
  eventResponsibleId: string | null;
  registrationType: CommunicationMessage['registrationType'];
  registrationValue: string | null;
  discordUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface CommunicationHistoryResult {
  entries: CommunicationHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Filter des Verlaufs.
 *
 * Die Suche greift auf Titel und Text zu. Ohne Gross-/Kleinschreibung, weil
 * niemand danach sucht, wie er es geschrieben hat.
 */
function buildWhere(query: CommunicationHistoryQuery): Prisma.CommunicationMessageWhereInput {
  const where: Prisma.CommunicationMessageWhereInput = {};

  if (query.type !== 'ALL') {
    where.type = query.type;
  }
  if (query.status !== 'ALL') {
    where.status = query.status;
  }
  if (query.channelId) {
    where.discordChannelId = query.channelId;
  }
  if (query.sentBy) {
    where.sentByDiscordId = query.sentBy;
  }
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { content: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    where.sentAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      // Das Enddatum schliesst den ganzen Tag ein - sonst überrascht ein
      // Zeitraum "bis heute" damit, dass heute fehlt.
      ...(to && !Number.isNaN(to.getTime()) ? { lte: new Date(to.getTime() + 86_399_999) } : {}),
    };
  }

  return where;
}

export async function listCommunicationHistory(
  query: CommunicationHistoryQuery,
): Promise<CommunicationHistoryResult> {
  const where = buildWhere(query);
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
    status: row.status,
    source: row.source,
    title: row.title,
    content: row.content,
    bannerUrl: row.bannerUrl,
    channelId: row.discordChannelId,
    channelName: row.discordChannelName,
    discordMessageId: row.discordMessageId,
    sentByDiscordId: row.sentByDiscordId,
    sentByUsername: row.sentByUsername,
    sentByAvatarHash: row.sentByAvatarHash,
    sentAt: row.sentAt,
    deletedAt: row.deletedAt,
    editedAt: row.editedAt,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    mentionType: row.mentionType,
    mentionTarget: row.mentionTarget,
    eventLocation: row.eventLocation,
    eventStartsAt: row.eventStartsAt,
    eventDateText: row.eventDateText,
    eventResponsibleId: row.eventResponsibleId,
    registrationType: row.registrationType,
    registrationValue: row.registrationValue,
    discordUrl: await buildLink(row),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}
