import { prisma } from '@swisshub/database';
import type { Ticket } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { discord, DISCORD_PERMISSIONS, resolveGuildId } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { TICKETS_MODULE_ID, type TicketSettings } from './config';
import type { TicketActor } from './service';
import { systemMeldung } from './discord';

const logger = createLogger('tickets:lifecycle');

const AUFBEWAHRUNG_MS: Record<TicketSettings['closeBehaviour'], number | null> = {
  DELETE_IMMEDIATELY: 0,
  KEEP_24H: 24 * 3600_000,
  KEEP_7D: 7 * 24 * 3600_000,
  KEEP_FOREVER: null,
};

/**
 * Ein Ticket schliessen.
 *
 * Der Kanal wird standardmaessig NICHT sofort geloescht, sondern nur
 * stummgeschaltet. Sofortiges Loeschen nimmt dem Mitglied jede Moeglichkeit,
 * die Antwort nochmals zu lesen - und dem Team jede Moeglichkeit, einen
 * Fehlgriff zu bemerken, bevor die Spuren weg sind. Wann geloescht wird,
 * entscheidet die Einstellung; der Aufraeumer holt es spaeter nach.
 */
export async function closeTicket(
  ticketId: string,
  reason: string | null,
  actor: TicketActor,
): Promise<Ticket> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (ticket.closedAt) {
    return ticket;
  }

  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);
  const aufbewahrung = AUFBEWAHRUNG_MS[settings.closeBehaviour];

  const geschlossen = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closedByDiscordId: actor.discordId,
      closeReason: reason?.slice(0, 500) ?? null,
      channelPurgeAt:
        aufbewahrung === null ? null : new Date(Date.now() + aufbewahrung),
    },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId,
      kind: 'CLOSED',
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      actorSource: actor.source,
      detail: { grund: reason ?? null } as never,
    },
  });

  // Zuerst die Meldung, dann die Sperre: nach dem Stummschalten koennte der
  // Bot je nach Rechtelage selbst nicht mehr schreiben.
  const abschluss = ticket.categoryId
    ? await prisma.ticketCategory.findUnique({
        where: { id: ticket.categoryId },
        select: { closeMessage: true },
      })
    : null;
  await systemMeldung(
    ticketId,
    [
      `**${actor.username}** hat dieses Ticket geschlossen.`,
      reason ? `Grund: ${reason}` : null,
      abschluss?.closeMessage ?? null,
    ]
      .filter((zeile): zeile is string => Boolean(zeile))
      .join('\n\n'),
  );

  // Kanal stummschalten statt loeschen.
  if (ticket.discordChannelId) {
    await sperreKanal(ticket).catch((fehler: unknown) => {
      logger.warn('Ticket-Kanal konnte nicht gesperrt werden', {
        ticketId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    });
  }

  return geschlossen;
}

/** Nach dem Schliessen darf gelesen, aber nicht mehr geschrieben werden. */
async function sperreKanal(ticket: Ticket): Promise<void> {
  if (!ticket.discordChannelId) {
    return;
  }
  const nurLesen = {
    allow: DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
    deny: DISCORD_PERMISSIONS.SEND_MESSAGES,
  };

  await discord.managedChannels.setOverwrite(
    ticket.discordChannelId,
    { id: ticket.creatorDiscordId, type: 1, ...nurLesen },
    'Ticket geschlossen',
  );

  const teilnehmer = await prisma.ticketParticipant.findMany({
    where: { ticketId: ticket.id, removedAt: null },
  });
  for (const eintrag of teilnehmer) {
    await discord.managedChannels
      .setOverwrite(
        ticket.discordChannelId,
        { id: eintrag.discordId, type: 1, ...nurLesen },
        'Ticket geschlossen',
      )
      .catch(() => undefined);
  }
}

/**
 * Ein geschlossenes Ticket wieder oeffnen.
 *
 * Existiert der Kanal noch, bekommt er seine Rechte zurueck. Ist er weg,
 * entsteht ein neuer - aber nur auf ausdruecklichen Wunsch: einen Kanal
 * beilaeufig neu anzulegen waere fuer alle Beteiligten ueberraschend.
 */
export async function reopenTicket(
  ticketId: string,
  actor: TicketActor,
  options: { neuerKanalWennNoetig?: boolean } = {},
): Promise<Ticket> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (!ticket.closedAt) {
    return ticket;
  }

  let kanalId = ticket.discordChannelId;

  if (kanalId) {
    const vorhanden = await discord.managedChannels.get(kanalId).catch(() => null);
    if (!vorhanden) {
      kanalId = null;
    }
  }

  if (kanalId) {
    await stelleSchreibrechteWiederHer(ticket, kanalId).catch(() => undefined);
  } else if (!options.neuerKanalWennNoetig) {
    // Ohne ausdrücklichen Wunsch entsteht kein neuer Kanal: das Ticket lebt
    // in der Datenbank weiter, und ein beiläufig neu angelegter Kanal wäre
    // für alle Beteiligten überraschend.
    throw new AppError('CONFLICT', {
      userMessage:
        'Der Discord-Kanal existiert nicht mehr. Das Ticket bleibt im Archiv erhalten.',
    });
  }

  const geoeffnet = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: ticket.assignedToDiscordId ? 'IN_PROGRESS' : 'OPEN',
      closedAt: null,
      closeReason: null,
      closedByDiscordId: null,
      reopenedAt: new Date(),
      channelPurgeAt: null,
      channelMissing: kanalId === null,
      discordChannelId: kanalId,
    },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId,
      kind: 'REOPENED',
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      actorSource: actor.source,
      detail: {} as never,
    },
  });

  await systemMeldung(ticketId, `**${actor.username}** hat dieses Ticket wieder geöffnet.`);

  return geoeffnet;
}

async function stelleSchreibrechteWiederHer(ticket: Ticket, kanalId: string): Promise<void> {
  const schreiben = {
    allow:
      DISCORD_PERMISSIONS.VIEW_CHANNEL |
      DISCORD_PERMISSIONS.SEND_MESSAGES |
      DISCORD_PERMISSIONS.ATTACH_FILES |
      DISCORD_PERMISSIONS.EMBED_LINKS |
      DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
    deny: 0n,
  };

  await discord.managedChannels.setOverwrite(
    kanalId,
    { id: ticket.creatorDiscordId, type: 1, ...schreiben },
    'Ticket wieder geöffnet',
  );

  const teilnehmer = await prisma.ticketParticipant.findMany({
    where: { ticketId: ticket.id, removedAt: null },
  });
  for (const eintrag of teilnehmer) {
    await discord.managedChannels
      .setOverwrite(kanalId, { id: eintrag.discordId, type: 1, ...schreiben }, 'Ticket wieder geöffnet')
      .catch(() => undefined);
  }
}

/**
 * Faellige Kanaele aufraeumen.
 *
 * Laeuft im bestehenden Job-Runner. Das Ticket selbst bleibt vollstaendig -
 * geloescht wird nur der Discord-Kanal, dessen Inhalt zu diesem Zeitpunkt
 * bereits als Transcript gesichert ist.
 */
export async function purgeDueChannels(jetzt = new Date()): Promise<number> {
  const faellig = await prisma.ticket.findMany({
    where: {
      channelPurgeAt: { not: null, lte: jetzt },
      discordChannelId: { not: null },
    },
    select: { id: true, discordChannelId: true, ticketNumber: true },
  });

  let entfernt = 0;
  for (const ticket of faellig) {
    try {
      await discord.managedChannels.remove(
        ticket.discordChannelId!,
        `Ticket #${ticket.ticketNumber} abgeschlossen`,
      );
      entfernt += 1;
    } catch (fehler) {
      logger.warn('Ticket-Kanal konnte nicht entfernt werden', {
        ticketId: ticket.id,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    }
    // Auch bei einem Fehler die Markierung loesen - der Kanal ist entweder
    // weg oder von Hand geloescht worden; erneut zu versuchen brachte nichts.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { discordChannelId: null, channelPurgeAt: null, channelMissing: true, status: 'ARCHIVED', archivedAt: new Date() },
    });
  }

  if (entfernt > 0) {
    logger.info('Ticket-Kanäle aufgeräumt', { anzahl: entfernt });
  }
  return entfernt;
}

/**
 * Discord und Datenbank abgleichen.
 *
 * Ein Kanal kann von Hand geloescht worden sein. Das Ticket bleibt dann
 * vollstaendig erhalten - nur die Markierung sagt, dass der Kanal fehlt,
 * damit die Oberflaeche nicht auf etwas zeigt, das es nicht mehr gibt.
 */
export async function reconcileChannels(): Promise<{ fehlend: number }> {
  await resolveGuildId();
  const offene = await prisma.ticket.findMany({
    where: {
      discordChannelId: { not: null },
      channelMissing: false,
      status: { notIn: ['ARCHIVED'] },
    },
    select: { id: true, discordChannelId: true },
  });

  let fehlend = 0;
  for (const ticket of offene) {
    const kanal = await discord.managedChannels.get(ticket.discordChannelId!).catch(() => null);
    if (kanal) {
      continue;
    }
    fehlend += 1;
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { channelMissing: true },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, kind: 'CHANNEL_MISSING', actorSource: 'SYSTEM' },
    });
  }

  if (fehlend > 0) {
    logger.info('Fehlende Ticket-Kanäle erkannt', { anzahl: fehlend });
  }
  return { fehlend };
}
