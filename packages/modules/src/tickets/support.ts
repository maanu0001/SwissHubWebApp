import { prisma } from '@swisshub/database';
import type { TicketBlockEntry, TicketTag, TicketTemplate } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { resolveGuildId } from '@swisshub/discord';
import type { TicketActor } from './service';

/**
 * Werkzeuge des Support-Alltags: Schlagwoerter, Antwortvorlagen, Sperren und
 * die Rueckmeldung nach dem Schliessen.
 *
 * Bewusst in einer Datei: es sind vier kleine Bereiche, die alle dasselbe
 * Muster haben - lesen, schreiben, ein Ereignis vermerken. Vier Dateien mit
 * je dreissig Zeilen machten die Ablage uebersichtlicher und den Ueberblick
 * schlechter.
 */

// --- Schlagwoerter -------------------------------------------------------

export async function listTags(): Promise<Array<TicketTag & { anzahl: number }>> {
  const eintraege = await prisma.ticketTag.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { assignments: true } } },
  });
  return eintraege.map(({ _count, ...tag }) => ({ ...tag, anzahl: _count.assignments }));
}

export async function createTag(name: string, color: string | null): Promise<TicketTag> {
  const guildId = await resolveGuildId();
  const sauber = name.trim().slice(0, 40);
  if (sauber.length === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Schlagwort braucht einen Namen.' });
  }

  const vorhanden = await prisma.ticketTag.findUnique({
    where: { guildId_name: { guildId, name: sauber } },
  });
  if (vorhanden) {
    throw new AppError('CONFLICT', { userMessage: `«${sauber}» gibt es bereits.` });
  }

  return prisma.ticketTag.create({ data: { guildId, name: sauber, color } });
}

/**
 * Ein Schlagwort entfernen.
 *
 * Die Zuordnungen verschwinden mit (Kaskade im Datenmodell). Anders als bei
 * einer Kategorie ist das unbedenklich: ein Schlagwort ordnet ein, es
 * entscheidet nichts ueber Sichtbarkeit.
 */
export async function deleteTag(tagId: string): Promise<void> {
  await prisma.ticketTag.delete({ where: { id: tagId } });
}

export async function setTicketTags(
  ticketId: string,
  tagIds: string[],
  actor: TicketActor,
): Promise<void> {
  const vorher = await prisma.ticketTagAssignment.findMany({
    where: { ticketId },
    include: { tag: { select: { id: true, name: true } } },
  });
  const vorherIds = new Set(vorher.map((eintrag) => eintrag.tagId));
  const nachherIds = new Set(tagIds);

  const entfernt = vorher.filter((eintrag) => !nachherIds.has(eintrag.tagId));
  const hinzugefuegt = tagIds.filter((tagId) => !vorherIds.has(tagId));

  if (entfernt.length === 0 && hinzugefuegt.length === 0) {
    return;
  }

  await prisma.$transaction([
    prisma.ticketTagAssignment.deleteMany({
      where: { ticketId, tagId: { in: entfernt.map((eintrag) => eintrag.tagId) } },
    }),
    prisma.ticketTagAssignment.createMany({
      data: hinzugefuegt.map((tagId) => ({
        ticketId,
        tagId,
        addedByDiscordId: actor.discordId,
      })),
      skipDuplicates: true,
    }),
  ]);

  const namen = await prisma.ticketTag.findMany({
    where: { id: { in: hinzugefuegt } },
    select: { name: true },
  });

  for (const tag of namen) {
    await prisma.ticketEvent.create({
      data: {
        ticketId,
        kind: 'TAG_ADDED',
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        actorSource: actor.source,
        detail: { wer: tag.name } as never,
      },
    });
  }
  for (const eintrag of entfernt) {
    await prisma.ticketEvent.create({
      data: {
        ticketId,
        kind: 'TAG_REMOVED',
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        actorSource: actor.source,
        detail: { wer: eintrag.tag.name } as never,
      },
    });
  }
}

// --- Antwortvorlagen -----------------------------------------------------

export async function listTemplates(categoryId?: string | null): Promise<TicketTemplate[]> {
  return prisma.ticketTemplate.findMany({
    // Eine Vorlage ohne Kategorie gilt ueberall. Beim Antworten sollen beide
    // erscheinen - die allgemeinen und die zur Kategorie passenden.
    where: categoryId ? { OR: [{ categoryId }, { categoryId: null }] } : {},
    orderBy: { title: 'asc' },
  });
}

export async function createTemplate(input: {
  title: string;
  content: string;
  categoryId: string | null;
}): Promise<TicketTemplate> {
  const guildId = await resolveGuildId();
  return prisma.ticketTemplate.create({
    data: {
      guildId,
      title: input.title.trim().slice(0, 100),
      content: input.content.trim().slice(0, 1800),
      categoryId: input.categoryId,
    },
  });
}

export async function updateTemplate(
  templateId: string,
  input: { title: string; content: string; categoryId: string | null },
): Promise<TicketTemplate> {
  return prisma.ticketTemplate.update({
    where: { id: templateId },
    data: {
      title: input.title.trim().slice(0, 100),
      content: input.content.trim().slice(0, 1800),
      categoryId: input.categoryId,
    },
  });
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await prisma.ticketTemplate.delete({ where: { id: templateId } });
}

// --- Sperren -------------------------------------------------------------

export interface TicketBlockAnsicht extends TicketBlockEntry {
  aktiv: boolean;
}

export async function listBlocks(): Promise<TicketBlockAnsicht[]> {
  const eintraege = await prisma.ticketBlockEntry.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const jetzt = new Date();
  return eintraege.map((eintrag) => ({
    ...eintrag,
    aktiv:
      eintrag.liftedAt === null && (eintrag.expiresAt === null || eintrag.expiresAt > jetzt),
  }));
}

/**
 * Ein Mitglied vom Ticketsystem ausschliessen.
 *
 * Bestehende Tickets bleiben bearbeitbar - eine Sperre verhindert das
 * Eroeffnen neuer, sie schneidet niemanden mitten im Gespraech ab.
 */
export async function blockMember(
  input: { discordId: string; username: string | null; reason: string; expiresAt: Date | null },
  actor: TicketActor,
): Promise<TicketBlockEntry> {
  const guildId = await resolveGuildId();

  const laufend = await prisma.ticketBlockEntry.findFirst({
    where: {
      guildId,
      discordId: input.discordId,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (laufend) {
    throw new AppError('CONFLICT', { userMessage: 'Dieses Mitglied ist bereits gesperrt.' });
  }

  return prisma.ticketBlockEntry.create({
    data: {
      guildId,
      discordId: input.discordId,
      username: input.username,
      reason: input.reason.trim().slice(0, 500),
      expiresAt: input.expiresAt,
      blockedByDiscordId: actor.discordId,
    },
  });
}

export async function liftBlock(blockId: string): Promise<void> {
  await prisma.ticketBlockEntry.update({
    where: { id: blockId },
    data: { liftedAt: new Date() },
  });
}

// --- Rueckmeldung --------------------------------------------------------

/** Kennung des Bewertungsknopfes; der Stern haengt hinten dran. */
export const FEEDBACK_BUTTON_PREFIX = 'tickets:feedback:';

/**
 * Eine Bewertung festhalten.
 *
 * Nur der Ersteller, nur zu einem geschlossenen Ticket, nur einmal. Die
 * Statistik zeigt echte Zahlen oder gar keine - eine Bewertung, die jeder
 * abgeben koennte, waere keine.
 */
export async function recordFeedback(input: {
  ticketId: string;
  discordId: string;
  rating: number;
  comment?: string | null;
}): Promise<void> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte 1 bis 5 Sterne wählen.' });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, creatorDiscordId: true, closedAt: true },
  });
  if (!ticket) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Ticket existiert nicht.' });
  }
  if (ticket.creatorDiscordId !== input.discordId) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Nur wer das Ticket eröffnet hat, kann es bewerten.',
    });
  }
  if (!ticket.closedAt) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dieses Ticket läuft noch - bewerten kannst du es nach dem Abschluss.',
    });
  }

  const vorhanden = await prisma.ticketFeedback.findUnique({
    where: { ticketId: input.ticketId },
  });
  if (vorhanden) {
    throw new AppError('CONFLICT', { userMessage: 'Du hast dieses Ticket bereits bewertet.' });
  }

  await prisma.ticketFeedback.create({
    data: {
      ticketId: input.ticketId,
      rating: input.rating,
      comment: input.comment?.trim().slice(0, 500) || null,
      givenByDiscordId: input.discordId,
    },
  });
}

/** Hat dieses Ticket schon eine Bewertung? */
export async function getFeedback(ticketId: string) {
  return prisma.ticketFeedback.findUnique({ where: { ticketId } });
}

/**
 * Nach dem Schliessen um eine Bewertung bitten.
 *
 * Nur wenn die Einstellung es vorsieht und der Kanal noch steht. Die Frage
 * geht in den Ticket-Kanal, nicht als Direktnachricht: dort hat das Mitglied
 * das Gespraech vor Augen, und der Bot braucht keine offenen DMs.
 */
export async function frageNachBewertung(ticketId: string, ticketNumber: number): Promise<void> {
  const { discord, BUTTON_STYLE } = await import('@swisshub/discord');
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { discordChannelId: true, channelMissing: true, creatorDiscordId: true },
  });
  if (!ticket?.discordChannelId || ticket.channelMissing) {
    return;
  }

  await discord.channels
    .send(ticket.discordChannelId, {
      content: `<@${ticket.creatorDiscordId}>`,
      embeds: [
        {
          title: `Wie war der Support zu Ticket #${String(ticketNumber).padStart(4, '0')}?`,
          description: 'Eine Rückmeldung hilft dem Team. Ein Klick genügt.',
          color: 0x83060a,
        },
      ],
      components: [
        {
          type: 1,
          components: [1, 2, 3, 4, 5].map((sterne) => ({
            type: 2 as const,
            style: BUTTON_STYLE.SECONDARY,
            label: '★'.repeat(sterne),
            custom_id: `${FEEDBACK_BUTTON_PREFIX}${sterne}`,
          })),
        },
      ],
      allowedMentions: { parse: [], users: [ticket.creatorDiscordId] },
    })
    .catch(() => undefined);
}
