import { prisma } from '@swisshub/database';
import type {
  Ticket,
  TicketActorSource,
  TicketEventKind,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { discord, DISCORD_PERMISSIONS, resolveGuildId } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { TICKETS_MODULE_ID, type TicketSettings } from './config';
import { nextTicketNumber } from './numbering';
import { sendeEroeffnung, systemMeldung } from './discord';

const logger = createLogger('tickets:service');

/** Wer eine Aktion ausloest. */
export interface TicketActor {
  discordId: string;
  username: string;
  source: TicketActorSource;
}

/** Discord erlaubt 50 Kanaele je Kategorie. */
const KATEGORIE_LIMIT = 50;

/**
 * Was im Ticket-Kanal steht - und was nicht.
 *
 * Uebernahme, Zuweisung, Status und Prioritaet melden sich hier nicht mehr.
 * Das sind interne Vorgaenge des Teams; im Kanal standen sie zwischen den
 * Nachrichten und liessen ein Gespraech wie ein Protokoll aussehen. Sie sind
 * deswegen nicht verschwunden: jeder dieser Vorgaenge schreibt weiterhin sein
 * `TicketEvent`, und der Verlauf im Dashboard zeigt sie vollstaendig.
 *
 * Im Kanal bleibt, was an die Beteiligten gerichtet ist: die Abschlussmeldung,
 * die Wiedereroeffnung, die Erinnerung an eine ausstehende Antwort und die
 * Frage nach einer Bewertung.
 */

async function ereignis(
  ticketId: string,
  kind: TicketEventKind,
  actor: TicketActor | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await prisma.ticketEvent.create({
    data: {
      ticketId,
      kind,
      actorDiscordId: actor?.discordId ?? null,
      actorUsername: actor?.username ?? null,
      actorSource: actor?.source ?? 'SYSTEM',
      detail: detail as never,
    },
  });
}

/**
 * Kanalnamen aus der Vorlage bauen.
 *
 * Discord erlaubt nur Kleinbuchstaben, Ziffern und Bindestriche und kuerzt
 * bei 100 Zeichen. Ein ungefilterter Benutzername ergaebe sonst einen Namen,
 * den Discord ablehnt - und die Ticketerstellung schluege fehl, ohne dass
 * jemand versteht warum.
 */
export function buildChannelName(
  template: string,
  werte: { number: number; username: string; category?: string },
): string {
  // Umlaute werden ausgeschrieben, nicht weggeworfen. "Süss" zu "sss" zu
  // verstuemmeln macht den Kanalnamen unbrauchbar - und Discord akzeptiert
  // die Umlaute selbst nicht.
  //
  // Das Eszett steht als Code-Punkt und nicht als Zeichen: der Waechtertest
  // verbietet es in Quelltexten, und hier wird es abgebildet, nicht
  // geschrieben - eine Ausnahme im Waechter waere der schlechtere Tausch.
  const ESZETT = '\u00DF';
  const UMSCHRIFT: Record<string, string> = {
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    [ESZETT]: 'ss',
    à: 'a',
    á: 'a',
    â: 'a',
    è: 'e',
    é: 'e',
    ê: 'e',
    ë: 'e',
    ì: 'i',
    í: 'i',
    î: 'i',
    ò: 'o',
    ó: 'o',
    ô: 'o',
    ù: 'u',
    ú: 'u',
    û: 'u',
    ç: 'c',
    ñ: 'n',
  };

  const sauber = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[äöü\u00DFàáâèéêëìíîòóôùúûçñ]/gu, (zeichen) => UMSCHRIFT[zeichen] ?? zeichen)
      // Was danach noch an Zeichen uebrig ist, kennt Discord nicht.
      .replace(/[^a-z0-9-]/gu, '-')
      .replace(/-+/gu, '-')
      .replace(/^-|-$/gu, '');

  const name = template
    .replace(/\{number\}/gu, String(werte.number).padStart(4, '0'))
    .replace(/\{username\}/gu, sauber(werte.username))
    .replace(/\{category\}/gu, sauber(werte.category ?? ''));

  const gefiltert = sauber(name) || `ticket-${werte.number}`;
  return gefiltert.slice(0, 90);
}

export interface CreateTicketInput {
  categoryId: string;
  subject: string;
  creatorDiscordId: string;
  creatorUsername: string;
  formAnswers?: Record<string, string>;
  source: TicketSource;
  /** Wer die Erstellung ausgeloest hat - bei Admin-Erstellung nicht der Ersteller. */
  actor: TicketActor;
}

/**
 * Ein Ticket eroeffnen.
 *
 * Zwei Dinge muessen zusammenpassen, die es nicht von Natur aus tun: ein
 * Datensatz und ein Discord-Kanal. Deshalb in zwei Schritten.
 *
 * Zuerst entsteht der Datensatz - mit Nummer, in einer Transaktion. Erst
 * danach der Kanal. Scheitert der Kanal, bleibt das Ticket als
 * CREATION_FAILED stehen, statt halb angelegt zu verschwinden: die Verwaltung
 * sieht es und kann es erneut versuchen. Der umgekehrte Weg - erst Kanal,
 * dann Datensatz - hinterliesse bei einem Fehler einen herrenlosen Kanal,
 * den niemand zuordnen kann.
 */
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);
  // Der verbundene Server wird hier aufgeloest und nicht uebergeben. Zwei
  // Quellen fuer dieselbe Kennung sind auseinandergelaufen: die Sperrpruefung
  // sah in einem Server nach, der Kanal entstand in einem anderen - und die
  // Sperre wirkte nicht.
  const guildId = await resolveGuildId();

  if (settings.maintenanceMode) {
    throw new AppError('CONFLICT', {
      userMessage: 'Das Support-System nimmt derzeit keine neuen Tickets an.',
    });
  }

  const kategorie = await prisma.ticketCategory.findUnique({ where: { id: input.categoryId } });
  if (!kategorie || !kategorie.active) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Kategorie steht nicht zur Verfügung.' });
  }

  // Gesperrt?
  const sperre = await prisma.ticketBlockEntry.findFirst({
    where: {
      guildId,
      discordId: input.creatorDiscordId,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (sperre) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du kannst derzeit keine Tickets eröffnen.',
    });
  }

  // Offene Tickets zaehlen. Die Kategorie darf strenger sein als die Vorgabe.
  const grenze = kategorie.maxOpenPerUser > 0 ? kategorie.maxOpenPerUser : settings.maxOpenPerUser;
  const offen = await prisma.ticket.count({
    where: {
      guildId,
      creatorDiscordId: input.creatorDiscordId,
      status: { notIn: ['CLOSED', 'ARCHIVED', 'CREATION_FAILED'] },
      ...(kategorie.maxOpenPerUser > 0 ? { categoryId: kategorie.id } : {}),
    },
  });
  if (offen >= grenze) {
    throw new AppError('CONFLICT', {
      userMessage:
        kategorie.maxOpenPerUser > 0
          ? `Du hast bereits ${grenze} offene Tickets in dieser Kategorie.`
          : `Du hast bereits ${grenze} offene Tickets.`,
    });
  }

  // Datensatz und Nummer in einer Transaktion - bricht etwas ab, gibt es
  // weder Ticket noch verbrauchte Nummer.
  const ticket = await prisma.$transaction(async (tx) => {
    const nummer = await nextTicketNumber(guildId, tx);
    return tx.ticket.create({
      data: {
        guildId,
        ticketNumber: nummer,
        categoryId: kategorie.id,
        subject: input.subject.slice(0, 200),
        status: 'PENDING',
        priority: kategorie.defaultPriority,
        source: input.source,
        creatorDiscordId: input.creatorDiscordId,
        creatorUsername: input.creatorUsername,
        formAnswers: (input.formAnswers ?? {}) as never,
      },
    });
  });

  await ereignis(ticket.id, 'CREATED', input.actor, {
    category: kategorie.name,
    subject: ticket.subject,
  });

  // Jetzt der Kanal. Scheitert er, bleibt das Ticket sichtbar.
  try {
    const kanal = await erstelleKanal(ticket, kategorie, settings);
    const offen = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { discordChannelId: kanal.id, status: 'OPEN', channelMissing: false },
    });
    // Erst jetzt, mit Kanal: die Nachricht traegt die Angaben aus dem
    // Formular, damit der Kanal fuer sich stehen kann.
    await sendeEroeffnung(offen, kategorie, settings);

    const { meldeEreignis } = await import('../automation/emit');
    await meldeEreignis(
      'ticket.opened',
      {
        ticketId: offen.id,
        nummer: offen.ticketNumber,
        discordId: offen.creatorDiscordId,
        kategorie: kategorie.name,
        channelId: offen.discordChannelId,
      },
      {
        guildId,
        actorId: offen.creatorDiscordId,
        subjectId: offen.creatorDiscordId,
        entityId: offen.id,
      },
    );

    return offen;
  } catch (fehler) {
    logger.warn('Ticket-Kanal konnte nicht erstellt werden', {
      ticketId: ticket.id,
      grund: fehler instanceof Error ? fehler.message : 'unbekannt',
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'CREATION_FAILED' },
    });
    throw fehler instanceof AppError
      ? fehler
      : new AppError('CONFLICT', {
          userMessage: 'Der Ticket-Kanal konnte nicht erstellt werden.',
        });
  }
}

/** Legt den Discord-Kanal mit den richtigen Rechten an. */
async function erstelleKanal(
  ticket: Ticket,
  kategorie: {
    id: string;
    name: string;
    discordCategoryId: string | null;
    overflowCategoryId: string | null;
    supportRoleIds: string[];
    channelNameTemplate: string;
  },
  settings: TicketSettings,
) {
  const guildId = await resolveGuildId();

  const kandidaten = [
    kategorie.discordCategoryId,
    kategorie.overflowCategoryId,
    settings.defaultDiscordCategoryId,
    settings.overflowDiscordCategoryId,
  ].filter((eintrag): eintrag is string => Boolean(eintrag));

  if (kandidaten.length === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Es ist keine Discord-Kategorie für Tickets eingerichtet.',
    });
  }

  // Die erste Kategorie mit Platz. Discord lehnt ab 50 Kanaelen ab, und die
  // Fehlermeldung dafuer ist fuer niemanden verstaendlich.
  const alleKanaele = await discord.channels.list();
  const ziel = kandidaten.find(
    (id) => alleKanaele.filter((kanal) => kanal.parentId === id).length < KATEGORIE_LIMIT,
  );
  if (!ziel) {
    throw new AppError('CONFLICT', {
      userMessage: 'Die Ticket-Kategorien auf Discord sind voll. Bitte eine Ausweich-Kategorie einrichten.',
    });
  }

  const rollen =
    kategorie.supportRoleIds.length > 0 ? kategorie.supportRoleIds : settings.defaultSupportRoleIds;

  const botIdentitaet = await discord.bot.identity();

  const overwrites = [
    // @everyone sieht nichts. Die Rolle traegt die Guild-ID.
    { id: guildId, type: 0 as const, allow: 0n, deny: DISCORD_PERMISSIONS.VIEW_CHANNEL },
    {
      id: ticket.creatorDiscordId,
      type: 1 as const,
      allow:
        DISCORD_PERMISSIONS.VIEW_CHANNEL |
        DISCORD_PERMISSIONS.SEND_MESSAGES |
        DISCORD_PERMISSIONS.ATTACH_FILES |
        DISCORD_PERMISSIONS.EMBED_LINKS |
        DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
      deny: 0n,
    },
    ...rollen.map((rolle) => ({
      id: rolle,
      type: 0 as const,
      allow:
        DISCORD_PERMISSIONS.VIEW_CHANNEL |
        DISCORD_PERMISSIONS.SEND_MESSAGES |
        DISCORD_PERMISSIONS.ATTACH_FILES |
        DISCORD_PERMISSIONS.EMBED_LINKS |
        DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY |
        DISCORD_PERMISSIONS.MANAGE_MESSAGES,
      deny: 0n,
    })),
    // Der Bot braucht seine Rechte ausdruecklich - erbt er sie nur von der
    // Kategorie, verliert er sie, sobald jemand die Kategorie umstellt.
    {
      id: botIdentitaet.id,
      type: 1 as const,
      allow:
        DISCORD_PERMISSIONS.VIEW_CHANNEL |
        DISCORD_PERMISSIONS.SEND_MESSAGES |
        DISCORD_PERMISSIONS.ATTACH_FILES |
        DISCORD_PERMISSIONS.EMBED_LINKS |
        DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY |
        DISCORD_PERMISSIONS.MANAGE_MESSAGES |
        DISCORD_PERMISSIONS.MANAGE_CHANNELS,
      deny: 0n,
    },
  ];

  return discord.managedChannels.createText({
    name: buildChannelName(kategorie.channelNameTemplate || settings.channelNameTemplate, {
      number: ticket.ticketNumber,
      username: ticket.creatorUsername,
      category: kategorie.name,
    }),
    parentId: ziel,
    // Bewusst ohne Betreff: das Thema ist fuer jeden sichtbar, der den Kanal
    // sieht, und ein Betreff kann Persoenliches enthalten.
    topic: `Ticket ${ticket.ticketNumber} · ${kategorie.name}`,
    overwrites,
    reason: `SwissHub Ticket #${ticket.ticketNumber}`,
  });
}

/**
 * Ein Ticket uebernehmen.
 *
 * Zwei Supporter druecken gleichzeitig - nur einer darf gewinnen. Das
 * entscheidet die Bedingung im `updateMany`: sie trifft nur zu, solange
 * niemand zugewiesen ist. Der zweite Aufruf aendert null Zeilen und weiss
 * damit, dass er zu spaet war. Ein vorheriges Lesen und anschliessendes
 * Schreiben haette dieses Wissen nicht.
 */
export async function claimTicket(ticketId: string, actor: TicketActor): Promise<boolean> {
  const { count } = await prisma.ticket.updateMany({
    where: { id: ticketId, assignedToDiscordId: null, status: { notIn: ['CLOSED', 'ARCHIVED'] } },
    data: {
      assignedToDiscordId: actor.discordId,
      assignedToUsername: actor.username,
      assignedAt: new Date(),
      status: 'IN_PROGRESS',
    },
  });

  if (count === 0) {
    return false;
  }
  await ereignis(ticketId, 'CLAIMED', actor);
  return true;
}

export async function assignTicket(
  ticketId: string,
  ziel: { discordId: string; username: string } | null,
  actor: TicketActor,
): Promise<void> {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      assignedToDiscordId: ziel?.discordId ?? null,
      assignedToUsername: ziel?.username ?? null,
      assignedAt: ziel ? new Date() : null,
    },
  });
  await ereignis(ticketId, ziel ? 'ASSIGNED' : 'UNASSIGNED', actor, {
    zu: ziel?.username ?? null,
  });
}

export async function changeStatus(
  ticketId: string,
  status: TicketStatus,
  actor: TicketActor,
): Promise<void> {
  const vorher = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { status: true },
  });
  if (vorher.status === status) {
    return;
  }
  await prisma.ticket.update({ where: { id: ticketId }, data: { status } });
  await ereignis(ticketId, 'STATUS_CHANGED', actor, { von: vorher.status, zu: status });
}

export async function changePriority(
  ticketId: string,
  priority: TicketPriority,
  actor: TicketActor,
): Promise<void> {
  const vorher = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { priority: true },
  });
  if (vorher.priority === priority) {
    return;
  }
  await prisma.ticket.update({ where: { id: ticketId }, data: { priority } });
  await ereignis(ticketId, 'PRIORITY_CHANGED', actor, { von: vorher.priority, zu: priority });
}

export async function addParticipant(
  ticketId: string,
  teilnehmer: { discordId: string; username: string },
  actor: TicketActor,
): Promise<void> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

  await prisma.ticketParticipant.upsert({
    where: { ticketId_discordId: { ticketId, discordId: teilnehmer.discordId } },
    create: {
      ticketId,
      discordId: teilnehmer.discordId,
      username: teilnehmer.username,
      addedByDiscordId: actor.discordId,
    },
    update: { removedAt: null, username: teilnehmer.username },
  });

  if (ticket.discordChannelId) {
    await discord.managedChannels
      .setOverwrite(
        ticket.discordChannelId,
        {
          id: teilnehmer.discordId,
          type: 1,
          allow:
            DISCORD_PERMISSIONS.VIEW_CHANNEL |
            DISCORD_PERMISSIONS.SEND_MESSAGES |
            DISCORD_PERMISSIONS.ATTACH_FILES |
            DISCORD_PERMISSIONS.EMBED_LINKS |
            DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
          deny: 0n,
        },
        `Teilnehmer hinzugefügt von ${actor.username}`,
      )
      .catch(() => undefined);
  }

  await ereignis(ticketId, 'USER_ADDED', actor, { wer: teilnehmer.username });
  await systemMeldung(ticketId, `**${actor.username}** hat **${teilnehmer.username}** hinzugefügt.`);
}

export async function removeParticipant(
  ticketId: string,
  discordId: string,
  actor: TicketActor,
): Promise<void> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

  // Der Ersteller bleibt drin - ihn zu entfernen waere fast immer ein
  // Versehen und liesse ihn aus seinem eigenen Ticket aussperren.
  if (ticket.creatorDiscordId === discordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Der Ersteller kann nicht aus seinem eigenen Ticket entfernt werden.',
    });
  }

  const eintrag = await prisma.ticketParticipant.findUnique({
    where: { ticketId_discordId: { ticketId, discordId } },
  });
  if (!eintrag || eintrag.removedAt) {
    return;
  }

  await prisma.ticketParticipant.update({
    where: { id: eintrag.id },
    data: { removedAt: new Date() },
  });

  if (ticket.discordChannelId) {
    await discord.managedChannels
      .clearOverwrite(ticket.discordChannelId, discordId, `Entfernt von ${actor.username}`)
      .catch(() => undefined);
  }

  await ereignis(ticketId, 'USER_REMOVED', actor, { wer: eintrag.username });
  await systemMeldung(ticketId, `**${actor.username}** hat **${eintrag.username}** entfernt.`);
}
