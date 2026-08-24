'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { tickets } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { ladeTicketMitZugriff } from '@/server/tickets';

/**
 * Ticket-Aktionen.
 *
 * Jede laedt das Ticket ueber `ladeTicketMitZugriff` - dieselbe Pruefung wie
 * die Seiten. Eine Ticket-ID aus dem Browser ist keine Berechtigung, und ohne
 * diese gemeinsame Stelle waere die Pruefung in jeder Aktion einzeln zu
 * wiederholen und irgendwann zu vergessen.
 */

const ticketSchema = z.object({ ticketId: z.string().cuid() });

function actor(ctx: { user: { discordId: string; username: string } }) {
  return {
    discordId: ctx.user.discordId,
    username: ctx.user.username,
    source: 'WEBAPP' as const,
  };
}

export const replyAction = defineAction(
  {
    name: 'tickets.reply',
    module: 'tickets',
    // Ausdruecklich Selbstbedienung: auch das Mitglied darf im eigenen
    // Ticket antworten. Ob es das darf, entscheidet der Zugriff unten.
    selfService: true,
    schema: ticketSchema.extend({ content: z.string().min(1).max(1800) }),
    rateLimit: 'ticketWrite',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.reply) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst hier nicht antworten.' });
    }

    await tickets.sendMessage(ticket.id, input.content, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      avatarHash: ctx.user.avatarHash ?? null,
      isStaff: zugriff.asStaff,
    });

    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const internalNoteAction = defineAction(
  {
    name: 'tickets.note',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.notesCreate,
    schema: ticketSchema.extend({ content: z.string().min(1).max(4000) }),
    rateLimit: 'ticketWrite',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    // Notizen sind fuer das Team - wer das Ticket nur als Ersteller sieht,
    // schreibt hier nichts hinein.
    if (!zugriff.asStaff) {
      throw new AppError('FORBIDDEN', { userMessage: 'Interne Notizen sind dem Team vorbehalten.' });
    }

    await tickets.addInternalNote(ticket.id, input.content, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      avatarHash: ctx.user.avatarHash ?? null,
      isStaff: true,
    });

    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const claimAction = defineAction(
  {
    name: 'tickets.claim',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportClaim,
    schema: ticketSchema,
    rateLimit: 'ticketWrite',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.asStaff) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du bist für dieses Ticket nicht zuständig.' });
    }

    const gelungen = await tickets.claimTicket(ticket.id, actor(ctx));
    if (!gelungen) {
      throw new AppError('CONFLICT', {
        userMessage: 'Dieses Ticket wurde soeben von jemand anderem übernommen.',
      });
    }

    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const changeStatusAction = defineAction(
  {
    name: 'tickets.status',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportChangeStatus,
    schema: ticketSchema.extend({
      status: z.enum([
        'OPEN',
        'IN_PROGRESS',
        'WAITING_FOR_USER',
        'WAITING_FOR_STAFF',
        'RESOLVED',
      ]),
    }),
    rateLimit: 'ticketWrite',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.manage) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst dieses Ticket nicht bearbeiten.' });
    }
    await tickets.changeStatus(ticket.id, input.status, actor(ctx));
    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const changePriorityAction = defineAction(
  {
    name: 'tickets.priority',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportChangePriority,
    schema: ticketSchema.extend({ priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']) }),
    rateLimit: 'ticketWrite',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.manage) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst dieses Ticket nicht bearbeiten.' });
    }
    await tickets.changePriority(ticket.id, input.priority, actor(ctx));
    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const closeAction = defineAction(
  {
    name: 'tickets.close',
    module: 'tickets',
    selfService: true,
    schema: ticketSchema.extend({ reason: z.string().max(500).optional() }),
    rateLimit: 'ticketWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.close) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst dieses Ticket nicht schliessen.' });
    }

    await tickets.closeTicket(ticket.id, input.reason ?? null, actor(ctx));

    // Nur die Verwaltungsaktion ins globale Protokoll - nicht jede Antwort.
    if (zugriff.asStaff) {
      await safeRecordAudit({
        action: AUDIT_ACTIONS.TICKET_CLOSED,
        module: 'tickets',
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        success: true,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        targetLabel: `Ticket #${ticket.ticketNumber}`,
        targetDiscordId: ticket.creatorDiscordId,
      });
    }

    revalidatePath(`/tickets/${ticket.id}`);
    revalidatePath('/tickets');
    return { ok: true };
  },
);

export const reopenAction = defineAction(
  {
    name: 'tickets.reopen',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportReopen,
    schema: ticketSchema,
    rateLimit: 'ticketWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.asStaff) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst dieses Ticket nicht öffnen.' });
    }
    await tickets.reopenTicket(ticket.id, actor(ctx));
    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const addParticipantAction = defineAction(
  {
    name: 'tickets.participant.add',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportAddUser,
    schema: ticketSchema.extend({
      discordId: z.string().regex(/^\d{17,20}$/u),
      username: z.string().min(1).max(64),
    }),
    rateLimit: 'ticketWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.asStaff) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst hier niemanden hinzufügen.' });
    }
    await tickets.addParticipant(
      ticket.id,
      { discordId: input.discordId, username: input.username },
      actor(ctx),
    );
    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const removeParticipantAction = defineAction(
  {
    name: 'tickets.participant.remove',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportRemoveUser,
    schema: ticketSchema.extend({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'ticketWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { ticket, zugriff } = await ladeTicketMitZugriff(ctx, input.ticketId);
    if (!zugriff.asStaff) {
      throw new AppError('FORBIDDEN', { userMessage: 'Du kannst hier niemanden entfernen.' });
    }
    await tickets.removeParticipant(ticket.id, input.discordId, actor(ctx));
    revalidatePath(`/tickets/${ticket.id}`);
    return { ok: true };
  },
);

export const createTicketAction = defineAction(
  {
    name: 'tickets.create',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.create,
    schema: z.object({
      categoryId: z.string().cuid(),
      subject: z.string().min(3).max(200),
      // Die Antworten kommen als Liste in der Reihenfolge der Felder. Was
      // sie bedeuten, entscheidet die Kategorie auf dem Server - nicht der
      // Browser: sonst koennte ein manipuliertes Formular Pflichtfelder
      // weglassen oder eigene erfinden.
      answers: z.array(z.string().max(4000)).max(10).default([]),
    }),
    rateLimit: 'ticketCreate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { resolveGuildId } = await import('@swisshub/discord');

    const kategorie = await tickets.getCategory(input.categoryId);
    if (!kategorie || !kategorie.active) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Kategorie steht nicht zur Verfügung.' });
    }

    const formAnswers: Record<string, string> = {};
    kategorie.formFields.forEach((feld, index) => {
      const wert = (input.answers[index] ?? '').trim();
      if (feld.required && wert.length === 0) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: `Bitte «${feld.label}» ausfüllen.`,
        });
      }
      if (wert.length === 0) {
        return;
      }
      if (feld.minLength !== null && wert.length < feld.minLength) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: `«${feld.label}» braucht mindestens ${feld.minLength} Zeichen.`,
        });
      }
      if (feld.maxLength !== null && wert.length > feld.maxLength) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: `«${feld.label}» darf höchstens ${feld.maxLength} Zeichen haben.`,
        });
      }
      formAnswers[feld.label] = wert;
    });

    if (kategorie.formFields.length === 0 && (input.answers[0] ?? '').trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Bitte beschreibe dein Anliegen.',
      });
    }
    if (kategorie.formFields.length === 0) {
      formAnswers['Anliegen'] = (input.answers[0] ?? '').trim().slice(0, 4000);
    }

    const ticket = await tickets.createTicket({
      guildId: await resolveGuildId(),
      categoryId: kategorie.id,
      subject: input.subject,
      creatorDiscordId: ctx.user.discordId,
      creatorUsername: ctx.user.username,
      formAnswers,
      source: 'WEBAPP',
      actor: actor(ctx),
    });

    revalidatePath('/tickets');
    return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber };
  },
);
