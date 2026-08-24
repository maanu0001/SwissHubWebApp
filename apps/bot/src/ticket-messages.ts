import { Events, type Client, type Message, type PartialMessage } from 'discord.js';
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { tickets } from '@swisshub/modules';
import { buildActor } from './commands/context';

const log = createLogger('bot:ticket-messages');

/**
 * Nachrichten aus Ticket-Kanaelen uebernehmen.
 *
 * Ohne diese Spiegelung zeigte das Dashboard nur, was ueber es selbst lief,
 * und das Transcript haenge daran, dass der Kanal noch existiert - also
 * genau daran, was beim Aufraeumen als Erstes verschwindet.
 *
 * Der Bot hoert in allen Kanaelen mit, uebernimmt aber nur, was zu einem
 * Ticket gehoert. Die Zuordnung entscheidet die Datenbank, nicht der
 * Kanalname.
 */
export function registerTicketMessageSync(client: Client, inhalteVerfuegbar: boolean): void {
  if (!inhalteVerfuegbar) {
    // Ohne das Intent kaeme jede Nachricht mit leerem Inhalt an. Ein Verlauf
    // aus lauter leeren Zeilen waere schlimmer als keiner: er saehe
    // vollstaendig aus.
    log.warn(
      'Message-Content-Intent nicht freigeschaltet - Nachrichten aus Ticket-Kanälen werden nicht übernommen. Im Discord Developer Portal unter Bot → Privileged Gateway Intents aktivieren.',
    );
    return;
  }

  client.on(Events.MessageCreate, (nachricht) => {
    void uebernehme(nachricht).catch((fehler: unknown) =>
      log.warn('Ticket-Nachricht konnte nicht übernommen werden', { fehler }),
    );
  });

  client.on(Events.MessageUpdate, (_alt, neu) => {
    void (async () => {
      if (!neu.id || typeof neu.content !== 'string') {
        return;
      }
      await tickets.markDiscordMessageEdited(neu.id, neu.content).catch(() => undefined);
    })();
  });

  client.on(Events.MessageDelete, (nachricht: Message | PartialMessage) => {
    void tickets.markDiscordMessageDeleted(nachricht.id).catch(() => undefined);
  });
}

async function uebernehme(nachricht: Message): Promise<void> {
  if (!nachricht.guildId || !nachricht.channelId) {
    return;
  }
  // Was der Bot selbst gesendet hat, steht bereits im Verlauf - die Antwort
  // aus dem Dashboard sonst doppelt.
  if (nachricht.author.bot) {
    return;
  }

  // `discordChannelId` ist eindeutig indiziert - die Frage «gehört dieser
  // Kanal zu einem Ticket?» kostet damit einen Indexzugriff je Nachricht und
  // nicht einen Tabellendurchlauf.
  const ticket = await prisma.ticket.findUnique({
    where: { discordChannelId: nachricht.channelId },
    select: { id: true, status: true },
  });
  if (!ticket) {
    return;
  }

  const zugriff = await istSupport(nachricht);

  await tickets.syncDiscordMessage({
    ticketId: ticket.id,
    discordMessageId: nachricht.id,
    content: nachricht.content,
    createdAt: nachricht.createdAt,
    author: {
      discordId: nachricht.author.id,
      username: nachricht.author.username,
      avatarHash: nachricht.author.avatar,
      isStaff: zugriff,
    },
    attachments: [...nachricht.attachments.values()].map((anhang) => ({
      fileName: anhang.name,
      url: anhang.url,
      contentType: anhang.contentType,
      sizeBytes: anhang.size,
    })),
  });
}

/**
 * Zaehlt diese Nachricht als Support-Antwort?
 *
 * Entscheidend fuer die Antwortzeiten und den Warte-Status. Gefragt wird
 * dasselbe Rechtesystem wie ueberall - nicht, ob jemand eine bestimmte Rolle
 * traegt.
 */
async function istSupport(nachricht: Message): Promise<boolean> {
  try {
    const actor = await buildActor(nachricht.author, nachricht.member);
    return actor.can(tickets.TICKET_PERMISSIONS.supportView);
  } catch {
    return false;
  }
}
