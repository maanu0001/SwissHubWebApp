import { prisma } from '@swisshub/database';
import type { Ticket, TicketCategory } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { discord, BUTTON_STYLE } from '@swisshub/discord';
import type { DiscordEmbedField, DiscordMessagePayload } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { TICKETS_MODULE_ID, type TicketSettings } from './config';

const logger = createLogger('tickets:discord');

/** SwissHub-Rot, wie im Kommunikationsmodul. */
const ACCENT_COLOR = 0x83060a;

/**
 * Kennungen der Knoepfe im Ticket-Kanal.
 *
 * Sie stehen an genau einer Stelle: der Bot erkennt beim Klick nur wieder,
 * was er selbst gesendet hat, und zwei Listen von Zeichenketten laufen
 * garantiert irgendwann auseinander.
 */
export const TICKET_BUTTON = {
  claim: 'tickets:claim',
  close: 'tickets:close',
} as const;

/**
 * Die Eroeffnungsnachricht eines Tickets.
 *
 * Ohne Datenbankzugriff, damit sie sich pruefen laesst. Sie enthaelt, was
 * beim Eroeffnen angegeben wurde - der Kanal soll fuer sich stehen, auch
 * wenn niemand das Dashboard oeffnet.
 */
export function eroeffnungsNachricht(input: {
  ticketNumber: number;
  subject: string;
  creatorDiscordId: string;
  kategorieName: string;
  kategorieFarbe?: number | null;
  willkommen?: string | null;
  formAnswers: Record<string, string>;
  supportRollen: string[];
  pingSupport: boolean;
}): DiscordMessagePayload {
  const felder: DiscordEmbedField[] = Object.entries(input.formAnswers)
    .slice(0, 20)
    .map(([frage, antwort]) => ({
      name: frage.slice(0, 256),
      value: antwort.slice(0, 1024) || '—',
      inline: false,
    }));

  const erwaehnungen =
    input.pingSupport && input.supportRollen.length > 0
      ? input.supportRollen.map((rolle) => `<@&${rolle}>`).join(' ')
      : '';

  return {
    content: `<@${input.creatorDiscordId}>${erwaehnungen ? ` ${erwaehnungen}` : ''}`,
    embeds: [
      {
        title: `Ticket #${String(input.ticketNumber).padStart(4, '0')} · ${input.subject}`.slice(0, 256),
        description: (input.willkommen ?? 'Das Team meldet sich, sobald jemand übernimmt.').slice(0, 4000),
        color: input.kategorieFarbe ?? ACCENT_COLOR,
        fields: felder,
        footer: { text: input.kategorieName.slice(0, 2048) },
        timestamp: new Date().toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: BUTTON_STYLE.PRIMARY,
            label: 'Übernehmen',
            custom_id: TICKET_BUTTON.claim,
            emoji: { name: '🙋' },
          },
          {
            type: 2,
            style: BUTTON_STYLE.DANGER,
            label: 'Schliessen',
            custom_id: TICKET_BUTTON.close,
            emoji: { name: '🔒' },
          },
        ],
      },
    ],
    // Ausdruecklich nur der Ersteller und, wenn gewuenscht, die
    // Support-Rollen. Ein `@everyone` im Betreff bleibt wirkungslos.
    allowedMentions: {
      parse: [],
      users: [input.creatorDiscordId],
      ...(erwaehnungen ? { roles: input.supportRollen } : {}),
    },
  };
}

/** Die Eroeffnungsnachricht in den frisch angelegten Kanal senden. */
export async function sendeEroeffnung(
  ticket: Ticket,
  kategorie: Pick<TicketCategory, 'name' | 'color' | 'welcomeMessage' | 'supportRoleIds' | 'pingSupport'>,
  settings: TicketSettings,
): Promise<void> {
  if (!ticket.discordChannelId) {
    return;
  }

  const formAnswers =
    ticket.formAnswers && typeof ticket.formAnswers === 'object' && !Array.isArray(ticket.formAnswers)
      ? (ticket.formAnswers as Record<string, string>)
      : {};

  const rollen =
    kategorie.supportRoleIds.length > 0 ? kategorie.supportRoleIds : settings.defaultSupportRoleIds;

  try {
    await discord.channels.send(
      ticket.discordChannelId,
      eroeffnungsNachricht({
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        creatorDiscordId: ticket.creatorDiscordId,
        kategorieName: kategorie.name,
        kategorieFarbe: kategorie.color,
        willkommen: kategorie.welcomeMessage,
        formAnswers,
        supportRollen: rollen,
        pingSupport: kategorie.pingSupport,
      }),
    );
  } catch (fehler) {
    // Das Ticket steht bereits - eine fehlende Eroeffnungsnachricht ist
    // aergerlich, aber kein Grund, die Erstellung scheitern zu lassen.
    logger.warn('Eröffnungsnachricht konnte nicht gesendet werden', {
      ticketId: ticket.id,
      grund: fehler instanceof Error ? fehler.message : 'unbekannt',
    });
  }
}

/**
 * Eine Systemmeldung im Ticket-Kanal.
 *
 * Abschaltbar, weil sie bei lebhaften Tickets den Verlauf zerreisst. Sie
 * scheitert nie laut: der Vorgang, den sie begleitet, ist bereits erledigt.
 */
export async function systemMeldung(ticketId: string, text: string): Promise<void> {
  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);
  if (!settings.systemMessagesOnDiscord) {
    return;
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { discordChannelId: true, channelMissing: true },
  });
  if (!ticket?.discordChannelId || ticket.channelMissing) {
    return;
  }

  await discord.channels
    .send(ticket.discordChannelId, {
      embeds: [{ description: text.slice(0, 2000), color: ACCENT_COLOR }],
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
}
