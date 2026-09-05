import { prisma } from '@swisshub/database';
import type { Ticket, TicketPriority, TicketStatus } from '@swisshub/database';
import { ticketSichtbarkeitsFilter, type TicketViewer } from './access';

/** Kennzahlen der Uebersicht. */
export interface TicketOverview {
  offen: number;
  inBearbeitung: number;
  wartetAufMitglied: number;
  wartetAufSupport: number;
  heuteErstellt: number;
  nichtZugewiesen: number;
  ueberfaellig: number;
}

/**
 * Wie viele Tickets gerade offen sind.
 *
 * Fuer die Zahl neben dem Seitenleisteneintrag. Sie zaehlt, was Arbeit
 * bedeutet: alles, was weder geschlossen noch archiviert ist. Ausdruecklich
 * auch «wartet auf Mitglied» - das Ticket ist offen, nur liegt der Ball
 * gerade woanders.
 *
 * Nicht mitgezaehlt werden Tickets, die es noch gar nicht gibt (`PENDING`)
 * oder deren Anlage gescheitert ist: eine Zahl, die auf etwas zeigt, das man
 * nicht bearbeiten kann, schickt jemanden ins Leere.
 *
 * Durch dieselbe Sichtbarkeit gefiltert wie alles andere: auch eine Zahl
 * verraet etwas.
 */
export async function countOpenTickets(viewer: TicketViewer): Promise<number> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);
  return prisma.ticket.count({
    where: {
      ...sichtbar,
      status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_STAFF', 'RESOLVED'] },
    },
  });
}

/**
 * Kennzahlen - immer durch die Sichtbarkeit gefiltert.
 *
 * Auch eine Zahl verraet etwas: ein Supporter, der nicht fuer Moderation
 * zustaendig ist, soll nicht an der Zahl ablesen, wie viele Meldungen
 * eingehen.
 */
export async function getOverview(viewer: TicketViewer): Promise<TicketOverview> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);

  const zaehle = (wo: Record<string, unknown>): Promise<number> =>
    prisma.ticket.count({ where: { ...sichtbar, ...wo } });

  const [offen, inBearbeitung, wartetAufMitglied, wartetAufSupport, heuteErstellt, nichtZugewiesen] =
    await Promise.all([
      zaehle({ status: 'OPEN' }),
      zaehle({ status: 'IN_PROGRESS' }),
      zaehle({ status: 'WAITING_FOR_USER' }),
      zaehle({ status: 'WAITING_FOR_STAFF' }),
      zaehle({ createdAt: { gte: heute } }),
      zaehle({ assignedToDiscordId: null, status: { in: ['OPEN', 'WAITING_FOR_STAFF'] } }),
    ]);

  // Ueberfaellig: wartet auf Support und seit ueber 24 Stunden unberuehrt.
  const ueberfaellig = await zaehle({
    status: { in: ['OPEN', 'WAITING_FOR_STAFF'] },
    OR: [
      { lastMessageAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
      { lastMessageAt: null, createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
    ],
  });

  return {
    offen,
    inBearbeitung,
    wartetAufMitglied,
    wartetAufSupport,
    heuteErstellt,
    nichtZugewiesen,
    ueberfaellig,
  };
}

export interface TicketListQuery {
  status?: TicketStatus[];
  priority?: TicketPriority;
  categoryId?: string;
  assignedTo?: string | null;
  creatorDiscordId?: string;
  search?: string;
  /** Nur geschlossene - fuer das Archiv. */
  closed?: boolean;
  page: number;
  pageSize: number;
}

export interface TicketRow {
  ticket: Ticket;
  categoryName: string | null;
  tagNames: string[];
  messageCount: number;
}

/** Die Reihenfolge der Warteschlange. */
const DRINGLICHKEIT: Record<TicketPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/**
 * Tickets auflisten.
 *
 * Sortiert nach Dringlichkeit, dann nach dem aeltesten Wartenden. Wer am
 * laengsten auf eine Antwort wartet, steht oben - nicht das zuletzt
 * Erstellte.
 */
export async function listTickets(
  viewer: TicketViewer,
  query: TicketListQuery,
): Promise<{ rows: TicketRow[]; total: number }> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);

  const where: Record<string, unknown> = { ...sichtbar };
  if (query.status && query.status.length > 0) {
    where.status = { in: query.status };
  } else if (query.closed === true) {
    where.status = { in: ['CLOSED', 'ARCHIVED'] };
  } else if (query.closed === false) {
    where.status = { notIn: ['CLOSED', 'ARCHIVED'] };
  }
  if (query.priority) {
    where.priority = query.priority;
  }
  if (query.categoryId) {
    where.categoryId = query.categoryId;
  }
  if (query.assignedTo !== undefined) {
    where.assignedToDiscordId = query.assignedTo;
  }
  if (query.creatorDiscordId) {
    where.creatorDiscordId = query.creatorDiscordId;
  }
  if (query.search) {
    const begriff = query.search.trim();
    const alsNummer = Number.parseInt(begriff.replace(/^#/u, ''), 10);
    where.AND = [
      {
        OR: [
          { subject: { contains: begriff, mode: 'insensitive' } },
          { creatorUsername: { contains: begriff, mode: 'insensitive' } },
          { creatorDiscordId: begriff },
          ...(Number.isFinite(alsNummer) ? [{ ticketNumber: alsNummer }] : []),
        ],
      },
    ];
  }

  const [eintraege, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        category: { select: { name: true } },
        tags: { include: { tag: { select: { name: true } } } },
        _count: { select: { messages: true } },
      },
      orderBy: [{ priority: 'asc' }, { lastMessageAt: 'asc' }, { createdAt: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  const rows = eintraege
    .map((eintrag) => {
      const { category, tags, _count, ...ticket } = eintrag;
      return {
        ticket,
        categoryName: category?.name ?? null,
        tagNames: tags.map((zuweisung) => zuweisung.tag.name),
        messageCount: _count.messages,
      };
    })
    // Prisma sortiert Enums alphabetisch, nicht nach Dringlichkeit.
    .sort((a, b) => DRINGLICHKEIT[a.ticket.priority] - DRINGLICHKEIT[b.ticket.priority]);

  return { rows, total };
}

/** Ein einzelnes Ticket - ohne Zugriffspruefung, die macht der Aufrufer. */
export async function getTicket(ticketId: string) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      category: true,
      participants: { where: { removedAt: null } },
      tags: { include: { tag: true } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
}

/** Statistiken - nur echte Zahlen, nichts Geschaetztes. */
export async function getStats(viewer: TicketViewer): Promise<{
  gesamt: number;
  proStatus: Array<{ status: TicketStatus; anzahl: number }>;
  proKategorie: Array<{ name: string; anzahl: number }>;
  ersteAntwortMinuten: number | null;
  loesungsdauerStunden: number | null;
  bewertung: { schnitt: number; anzahl: number } | null;
}> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);

  const [gesamt, nachStatus, kategorien] = await Promise.all([
    prisma.ticket.count({ where: sichtbar }),
    prisma.ticket.groupBy({ by: ['status'], where: sichtbar, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['categoryId'], where: sichtbar, _count: { _all: true } }),
  ]);

  const kategorieNamen = await prisma.ticketCategory.findMany({ select: { id: true, name: true } });
  const namen = new Map(kategorieNamen.map((eintrag) => [eintrag.id, eintrag.name]));

  // Antwort- und Loesungszeiten nur aus Tickets, die den Zeitpunkt wirklich
  // tragen. Fehlende Werte mitzurechnen ergaebe eine schoenere, falsche Zahl.
  const mitAntwort = await prisma.ticket.findMany({
    where: { ...sichtbar, firstStaffResponseAt: { not: null } },
    select: { createdAt: true, firstStaffResponseAt: true },
    take: 500,
    orderBy: { createdAt: 'desc' },
  });
  const geloest = await prisma.ticket.findMany({
    where: { ...sichtbar, closedAt: { not: null } },
    select: { createdAt: true, closedAt: true },
    take: 500,
    orderBy: { closedAt: 'desc' },
  });

  const schnitt = (werte: number[]): number | null =>
    werte.length === 0 ? null : werte.reduce((a, b) => a + b, 0) / werte.length;

  const bewertungen = await prisma.ticketFeedback.aggregate({
    _avg: { rating: true },
    _count: { _all: true },
  });

  return {
    gesamt,
    proStatus: nachStatus.map((eintrag) => ({
      status: eintrag.status,
      anzahl: eintrag._count._all,
    })),
    proKategorie: kategorien
      .map((eintrag) => ({
        name: eintrag.categoryId ? (namen.get(eintrag.categoryId) ?? 'Ohne Kategorie') : 'Ohne Kategorie',
        anzahl: eintrag._count._all,
      }))
      .sort((a, b) => b.anzahl - a.anzahl),
    ersteAntwortMinuten: schnitt(
      mitAntwort.map(
        (eintrag) => (eintrag.firstStaffResponseAt!.getTime() - eintrag.createdAt.getTime()) / 60_000,
      ),
    ),
    loesungsdauerStunden: schnitt(
      geloest.map((eintrag) => (eintrag.closedAt!.getTime() - eintrag.createdAt.getTime()) / 3600_000),
    ),
    bewertung:
      bewertungen._count._all > 0
        ? { schnitt: bewertungen._avg.rating ?? 0, anzahl: bewertungen._count._all }
        : null,
  };
}
