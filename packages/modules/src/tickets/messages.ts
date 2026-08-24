import { prisma } from '@swisshub/database';
import type { TicketMessage } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { discord } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { TICKETS_MODULE_ID, type TicketSettings } from './config';

const logger = createLogger('tickets:messages');

/** SwissHub-Rot, wie im Kommunikationsmodul. */
const ACCENT_COLOR = 0x83060a;

/** Discord nimmt hoechstens 2000 Zeichen je Nachricht. */
export const DISCORD_MAX_LAENGE = 2000;
/** Der Embed-Text ist knapper - der Rest der Karte braucht auch Platz. */
export const ANTWORT_MAX_LAENGE = 1800;

export interface TicketAuthor {
  discordId: string;
  username: string;
  avatarHash?: string | null;
  /** Support oder Mitglied? Entscheidet Darstellung und Antwortzeiten. */
  isStaff: boolean;
}

/**
 * Aus der WebApp in den Ticket-Kanal schreiben.
 *
 * Der Bot sendet, nicht die Person - technisch geht es gar nicht anders.
 * Deshalb steht immer dabei, wer geantwortet hat: eine Nachricht, die
 * aussieht als kaeme sie direkt von einer Person, waere eine Taeuschung, und
 * bei Support-Antworten faellt sie irgendwann jemandem auf die Fuesse.
 *
 * Erwaehnungen werden ausdruecklich unterbunden. Sonst genuegte ein
 * `@everyone` im Antwortfeld, um den ganzen Server zu benachrichtigen.
 */
export async function sendMessage(
  ticketId: string,
  inhalt: string,
  author: TicketAuthor,
): Promise<TicketMessage> {
  const text = inhalt.trim();
  if (text.length === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Nachricht ist leer.' });
  }
  if (text.length > ANTWORT_MAX_LAENGE) {
    // Bewusst abweisen statt still zu kuerzen: eine halbe Antwort ist
    // schlimmer als eine, die nicht abgeschickt wurde.
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Nachricht ist zu lang (${text.length} von ${ANTWORT_MAX_LAENGE} Zeichen).`,
    });
  }

  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (ticket.status === 'CLOSED' || ticket.status === 'ARCHIVED') {
    throw new AppError('CONFLICT', { userMessage: 'Dieses Ticket ist geschlossen.' });
  }

  let discordMessageId: string | null = null;

  if (ticket.discordChannelId && !ticket.channelMissing) {
    try {
      const gesendet = await discord.channels.send(ticket.discordChannelId, {
        embeds: [
          {
            description: text,
            color: ACCENT_COLOR,
            author: {
              name: author.isStaff
                ? `${author.username} · Support`
                : `${author.username} · über das Dashboard`,
              icon_url: author.avatarHash
                ? `https://cdn.discordapp.com/avatars/${author.discordId}/${author.avatarHash}.png?size=64`
                : undefined,
            },
            timestamp: new Date().toISOString(),
          },
        ],
        // Kein Erwaehnen - auch nicht, wenn im Text etwas danach aussieht.
        allowedMentions: { parse: [] },
      });
      discordMessageId = gesendet.id;
    } catch (fehler) {
      logger.warn('Ticket-Antwort konnte nicht gesendet werden', {
        ticketId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
      throw new AppError('CONFLICT', {
        userMessage: 'Die Nachricht konnte nicht an Discord übermittelt werden.',
      });
    }
  }

  return speichere(ticketId, {
    source: 'WEBAPP',
    discordMessageId,
    content: text,
    author,
  });
}

/** Eine interne Notiz - erscheint nie auf Discord. */
export async function addInternalNote(
  ticketId: string,
  inhalt: string,
  author: TicketAuthor,
): Promise<TicketMessage> {
  const text = inhalt.trim();
  if (text.length === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Notiz ist leer.' });
  }
  return speichere(ticketId, {
    source: 'INTERNAL_NOTE',
    discordMessageId: null,
    content: text.slice(0, 4000),
    author: { ...author, isStaff: true },
  });
}

/**
 * Eine Nachricht aus Discord uebernehmen.
 *
 * Der Bot hoert im Ticket-Kanal mit. Ohne diese Spiegelung zeigte die WebApp
 * nur, was ueber sie selbst lief - und das Archiv haenge daran, dass der
 * Kanal noch existiert.
 */
export async function syncDiscordMessage(input: {
  ticketId: string;
  discordMessageId: string;
  content: string;
  author: TicketAuthor;
  attachments?: Array<{ fileName: string; url: string; contentType?: string | null; sizeBytes?: number }>;
  createdAt?: Date;
}): Promise<void> {
  // Der eindeutige Schluessel entscheidet - der Bot kann dieselbe Nachricht
  // nach einem Neustart erneut sehen.
  const vorhanden = await prisma.ticketMessage.findUnique({
    where: { discordMessageId: input.discordMessageId },
    select: { id: true },
  });
  if (vorhanden) {
    return;
  }

  const nachricht = await speichere(input.ticketId, {
    source: 'DISCORD',
    discordMessageId: input.discordMessageId,
    content: input.content,
    author: input.author,
    createdAt: input.createdAt,
  });

  if (input.attachments && input.attachments.length > 0) {
    await prisma.ticketAttachment.createMany({
      data: input.attachments.map((anhang) => ({
        messageId: nachricht.id,
        fileName: anhang.fileName.slice(0, 255),
        url: anhang.url,
        contentType: anhang.contentType ?? null,
        sizeBytes: anhang.sizeBytes ?? 0,
      })),
    });
  }
}

export async function markDiscordMessageEdited(
  discordMessageId: string,
  inhalt: string,
): Promise<void> {
  await prisma.ticketMessage.updateMany({
    where: { discordMessageId },
    data: { content: inhalt, editedAt: new Date() },
  });
}

export async function markDiscordMessageDeleted(discordMessageId: string): Promise<void> {
  // Der Eintrag bleibt - sonst hinterliesse eine geloeschte Nachricht eine
  // Luecke im Verlauf, und genau die will man spaeter nachvollziehen koennen.
  await prisma.ticketMessage.updateMany({
    where: { discordMessageId },
    data: { deletedAt: new Date() },
  });
}

/**
 * Speichern und die Kennzahlen des Tickets nachziehen.
 *
 * Erste Support-Antwort, letzte Aktivitaet und der automatische Warte-Status
 * haengen alle an derselben Stelle - deshalb hier und nicht in jedem Aufrufer.
 */
async function speichere(
  ticketId: string,
  input: {
    source: TicketMessage['source'];
    discordMessageId: string | null;
    content: string;
    author: TicketAuthor;
    createdAt?: Date;
  },
): Promise<TicketMessage> {
  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const jetzt = input.createdAt ?? new Date();

  const nachricht = await prisma.ticketMessage.create({
    data: {
      ticketId,
      source: input.source,
      discordMessageId: input.discordMessageId,
      authorDiscordId: input.author.discordId,
      authorUsername: input.author.username,
      authorAvatarHash: input.author.avatarHash ?? null,
      fromStaff: input.author.isStaff,
      content: input.content,
      createdAt: jetzt,
    },
  });

  // Interne Notizen zaehlen nicht als Antwort - das Mitglied sieht sie nie,
  // und eine Notiz als "erste Antwort" zu werten schoente die Statistik.
  if (input.source === 'INTERNAL_NOTE') {
    return nachricht;
  }

  const aktualisierung: Record<string, unknown> = {
    lastMessageAt: jetzt,
    lastMessageByStaff: input.author.isStaff,
  };

  if (input.author.isStaff && ticket.firstStaffResponseAt === null) {
    aktualisierung.firstStaffResponseAt = jetzt;
  }

  if (settings.autoWaitingStatus && ticket.status !== 'CLOSED' && ticket.status !== 'ARCHIVED') {
    aktualisierung.status = input.author.isStaff ? 'WAITING_FOR_USER' : 'WAITING_FOR_STAFF';
  }

  await prisma.ticket.update({ where: { id: ticketId }, data: aktualisierung });
  return nachricht;
}

/**
 * Die Nachrichten eines Tickets.
 *
 * `interneSichtbar` entscheidet, ob Notizen dabei sind. Das ist bewusst ein
 * Parameter und keine Filterung im Aufrufer: wer die Liste holt, muss sich
 * entscheiden, und ein vergessener Filter faellt hier auf statt im Browser.
 */
export async function listMessages(
  ticketId: string,
  interneSichtbar: boolean,
): Promise<Array<TicketMessage & { attachments: Array<{ fileName: string; url: string }> }>> {
  return prisma.ticketMessage.findMany({
    where: {
      ticketId,
      ...(interneSichtbar ? {} : { source: { not: 'INTERNAL_NOTE' } }),
    },
    orderBy: { createdAt: 'asc' },
    include: { attachments: { select: { fileName: true, url: true } } },
  });
}
