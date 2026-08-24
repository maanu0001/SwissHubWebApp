import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { tickets } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import type { TicketPriority, TicketStatus } from '@swisshub/database';

/**
 * Der Betrachter, wie ihn die Zugriffspruefung erwartet.
 *
 * Bewusst eine Uebersetzung und keine zweite Regel: `can` und die Rollen
 * kommen aus dem bestehenden Sitzungskontext, entschieden wird im Modul.
 */
export function ticketViewer(context: AuthContext): tickets.TicketViewer {
  return {
    discordId: context.user.discordId,
    roleIds: context.roleIds,
    can: (permission: string) => can(context, permission),
  };
}

/**
 * Ein Ticket laden und den Zugriff pruefen.
 *
 * Jede Seite und jede Aktion geht hier durch. Eine Ticket-ID aus der Adresse
 * sagt nichts darueber aus, ob sie jemanden etwas angeht - und ohne diese
 * Stelle waere die Pruefung zwanzigmal einzeln zu wiederholen.
 */
export async function ladeTicketMitZugriff(
  context: AuthContext,
  ticketId: string,
): Promise<{
  ticket: NonNullable<Awaited<ReturnType<typeof tickets.getTicket>>>;
  zugriff: tickets.TicketAccess;
}> {
  const ticket = await tickets.getTicket(ticketId);
  if (!ticket) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Ticket existiert nicht.' });
  }

  const zugriff = await tickets.getTicketAccess(ticketViewer(context), ticket);
  if (!zugriff.view) {
    // Bewusst dieselbe Meldung wie bei einem nicht vorhandenen Ticket: sonst
    // liesse sich an der Antwort ablesen, welche Ticketnummern existieren.
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Ticket existiert nicht.' });
  }

  return { ticket, zugriff };
}

export interface TicketSection {
  href: string;
  label: string;
}

/** Unterseiten des Ticket-Moduls. */
export function ticketSections(context: AuthContext): TicketSection[] {
  const p = tickets.TICKET_PERMISSIONS;
  const sections: TicketSection[] = [];

  if (can(context, p.supportView) || can(context, p.admin)) {
    sections.push(
      { href: '/tickets', label: 'Übersicht' },
      { href: '/tickets/offen', label: 'Offene Tickets' },
      { href: '/tickets/meine', label: 'Meine Tickets' },
    );
  } else {
    sections.push({ href: '/tickets', label: 'Meine Tickets' });
  }

  if (can(context, p.create)) {
    sections.push({ href: '/tickets/neu', label: 'Neues Ticket' });
  }

  if (can(context, p.archiveView)) {
    sections.push({ href: '/tickets/archiv', label: 'Archiv' });
  }
  if (can(context, p.supportManageTags)) {
    sections.push({ href: '/tickets/schlagwoerter', label: 'Schlagwörter' });
  }
  if (can(context, p.templatesManage)) {
    sections.push({ href: '/tickets/vorlagen', label: 'Vorlagen' });
  }
  if (can(context, p.categoriesManage)) {
    sections.push({ href: '/tickets/kategorien', label: 'Kategorien' });
  }
  if (can(context, p.panelsManage)) {
    sections.push({ href: '/tickets/panels', label: 'Panels' });
  }
  if (can(context, p.blockManage)) {
    sections.push({ href: '/tickets/sperren', label: 'Sperren' });
  }
  if (can(context, p.statsView)) {
    sections.push({ href: '/tickets/statistiken', label: 'Statistiken' });
  }
  if (can(context, p.settingsManage)) {
    sections.push({ href: '/modules/tickets', label: 'Einstellungen' });
  }
  return sections;
}

/** Ist diese Person Support - entscheidet, welche Ansicht sie sieht. */
export function istSupport(context: AuthContext): boolean {
  return (
    can(context, tickets.TICKET_PERMISSIONS.supportView) ||
    can(context, tickets.TICKET_PERMISSIONS.admin)
  );
}

const ERLAUBTE_STATUS: TicketStatus[] = [
  'PENDING',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'WAITING_FOR_STAFF',
  'RESOLVED',
  'CLOSED',
  'ARCHIVED',
  'CREATION_FAILED',
];

const ERLAUBTE_PRIORITAETEN: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Wie viele Tickets eine Listenseite zeigt. */
export const TICKETS_JE_SEITE = 25;

export interface TicketListenSuche {
  q?: string;
  status?: string;
  prio?: string;
  kategorie?: string;
  page?: string;
}

/**
 * Eine Ticketliste aus den Adressparametern.
 *
 * Die Filter kommen aus der Adresse und sind damit beliebig manipulierbar.
 * Deshalb geht auch dieser Weg durch `listTickets` und dessen
 * Sichtbarkeitsfilter: ein erfundener Kategorie-Parameter zeigt nichts, was
 * die Person nicht ohnehin sehen duerfte.
 */
export async function ladeTicketListe(
  context: AuthContext,
  suche: TicketListenSuche,
  basis: { closed?: boolean; assignedTo?: string | null; creatorDiscordId?: string } = {},
): Promise<{
  rows: Awaited<ReturnType<typeof tickets.listTickets>>['rows'];
  total: number;
  page: number;
  totalPages: number;
}> {
  const gewuenschteSeite = Number.parseInt(suche.page ?? '1', 10);
  const page = Number.isFinite(gewuenschteSeite) && gewuenschteSeite > 0 ? gewuenschteSeite : 1;

  // Bewusst gegen eine feste Liste gepruefte Werte statt eines Casts: die
  // Parameter stammen aus der Adresse, und ein erfundener Status erreichte
  // sonst Prisma und liesse die Seite mit einem Fehler stehen.
  const status = ERLAUBTE_STATUS.includes(suche.status as TicketStatus)
    ? [suche.status as TicketStatus]
    : undefined;
  const prioritaet = ERLAUBTE_PRIORITAETEN.includes(suche.prio as TicketPriority)
    ? (suche.prio as TicketPriority)
    : undefined;

  const { rows, total } = await tickets.listTickets(ticketViewer(context), {
    ...basis,
    ...(status ? { status } : {}),
    ...(prioritaet ? { priority: prioritaet } : {}),
    ...(suche.kategorie ? { categoryId: suche.kategorie } : {}),
    ...(suche.q ? { search: suche.q } : {}),
    page,
    pageSize: TICKETS_JE_SEITE,
  });

  return {
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / TICKETS_JE_SEITE)),
  };
}

/** Adresse mit denselben Filtern, aber anderer Seitenzahl. */
export function ticketListenHref(
  basis: string,
  suche: TicketListenSuche,
  seite: number,
): string {
  const parameter = new URLSearchParams();
  if (suche.q) {
    parameter.set('q', suche.q);
  }
  if (suche.status) {
    parameter.set('status', suche.status);
  }
  if (suche.prio) {
    parameter.set('prio', suche.prio);
  }
  if (suche.kategorie) {
    parameter.set('kategorie', suche.kategorie);
  }
  if (seite > 1) {
    parameter.set('page', String(seite));
  }
  const angehaengt = parameter.toString();
  return angehaengt.length > 0 ? `${basis}?${angehaengt}` : basis;
}
