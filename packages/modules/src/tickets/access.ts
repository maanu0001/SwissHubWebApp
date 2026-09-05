import { prisma } from '@swisshub/database';
import type { Ticket, TicketCategory } from '@swisshub/database';
import { getModuleSettings } from '../module-state';
import { TICKETS_MODULE_ID, TICKET_PERMISSIONS, type TicketSettings } from './config';

/**
 * Wer darf was mit einem Ticket?
 *
 * Eine Stelle statt einer Pruefung je Route. Der Unterschied ist nicht
 * Bequemlichkeit: eine vergessene Pruefung in einer von zwanzig Routen ist
 * genau die Luecke, durch die jemand fremde Tickets liest.
 *
 * Es wirken zwei Ebenen. Die erste ist das zentrale Rechtesystem - darf
 * diese Person ueberhaupt Support machen? Die zweite ist die
 * Kategorie-Zustaendigkeit: wer nur die Rolle @Partner-Support traegt, sieht
 * Moderationstickets auch dann nicht, wenn er `support.view` hat. Ohne die
 * zweite Ebene waere jede Support-Rolle faktisch eine Vollberechtigung.
 */

/** Was die Zugriffspruefung ueber die aufrufende Person wissen muss. */
export interface TicketViewer {
  discordId: string;
  /** Discord-Rollen - Grundlage der Kategorie-Zustaendigkeit. */
  roleIds: string[];
  /** Prueft eine Berechtigung im zentralen System. */
  can(permission: string): boolean;
}

export interface TicketAccess {
  /** Ticket sichtbar? */
  view: boolean;
  /** Darf antworten - als Support oder als Ersteller. */
  reply: boolean;
  /** Darf Status, Zuweisung, Schlagwoerter aendern. */
  manage: boolean;
  /** Darf interne Notizen lesen. */
  notes: boolean;
  /** Darf schliessen. */
  close: boolean;
  /** Betrachtet als Support - entscheidet Attribution und Antwortzeiten. */
  asStaff: boolean;
}

const KEIN_ZUGRIFF: TicketAccess = {
  view: false,
  reply: false,
  manage: false,
  notes: false,
  close: false,
  asStaff: false,
};

/**
 * Ist diese Person fuer die Kategorie zustaendig?
 *
 * Hat die Kategorie eigene Support-Rollen, zaehlen nur die. Sonst greifen
 * die Standardrollen aus den Einstellungen - sonst waere eine Kategorie ohne
 * eigene Rollen fuer niemanden zustaendig und die Tickets blieben liegen.
 */
export function istZustaendig(
  viewer: TicketViewer,
  category: Pick<TicketCategory, 'supportRoleIds'> | null,
  standardRollen: string[],
): boolean {
  const rollen = category && category.supportRoleIds.length > 0 ? category.supportRoleIds : standardRollen;
  if (rollen.length === 0) {
    return false;
  }
  return rollen.some((rolle) => viewer.roleIds.includes(rolle));
}

/** Zugriff auf ein bestimmtes Ticket. */
export async function getTicketAccess(
  viewer: TicketViewer,
  ticket: Pick<Ticket, 'id' | 'creatorDiscordId' | 'categoryId' | 'status'>,
): Promise<TicketAccess> {
  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);

  // Vollzugriff - die einzige Abkuerzung, und sie ist ausdruecklich vergeben.
  if (viewer.can(TICKET_PERMISSIONS.admin)) {
    return {
      view: true,
      reply: viewer.can(TICKET_PERMISSIONS.supportReply),
      manage: true,
      notes: viewer.can(TICKET_PERMISSIONS.notesView),
      close: true,
      asStaff: true,
    };
  }

  const kategorie = ticket.categoryId
    ? await prisma.ticketCategory.findUnique({
        where: { id: ticket.categoryId },
        select: { supportRoleIds: true, sensitive: true, userCanClose: true },
      })
    : null;

  // --- Support ---------------------------------------------------------
  const istSupport =
    viewer.can(TICKET_PERMISSIONS.supportView) &&
    istZustaendig(viewer, kategorie, settings.defaultSupportRoleIds);

  if (istSupport) {
    return {
      view: true,
      reply: viewer.can(TICKET_PERMISSIONS.supportReply),
      manage:
        viewer.can(TICKET_PERMISSIONS.supportChangeStatus) || viewer.can(TICKET_PERMISSIONS.supportAssign),
      notes: viewer.can(TICKET_PERMISSIONS.notesView),
      close: viewer.can(TICKET_PERMISSIONS.supportClose),
      asStaff: true,
    };
  }

  // --- Ersteller -------------------------------------------------------
  if (ticket.creatorDiscordId === viewer.discordId) {
    const offen = ticket.status !== 'CLOSED' && ticket.status !== 'ARCHIVED';
    return {
      view: viewer.can(TICKET_PERMISSIONS.viewOwn),
      reply: offen && viewer.can(TICKET_PERMISSIONS.viewOwn),
      manage: false,
      // Ausdruecklich nie: interne Notizen sind fuer das Team.
      notes: false,
      close: offen && (kategorie?.userCanClose ?? true),
      asStaff: false,
    };
  }

  // --- Hinzugefuegte Teilnehmer ----------------------------------------
  const teilnehmer = await prisma.ticketParticipant.findFirst({
    where: { ticketId: ticket.id, discordId: viewer.discordId, removedAt: null },
    select: { id: true },
  });
  if (teilnehmer) {
    const offen = ticket.status !== 'CLOSED' && ticket.status !== 'ARCHIVED';
    return {
      view: true,
      reply: offen,
      manage: false,
      notes: false,
      close: false,
      asStaff: false,
    };
  }

  return KEIN_ZUGRIFF;
}

/**
 * Welche Kategorien darf diese Person als Support sehen?
 *
 * Grundlage jeder Liste und jeder Suche. Ohne diese Einschraenkung faende ein
 * Supporter ueber die Suche Tickets, die er einzeln nie oeffnen duerfte.
 */
export async function zustaendigeKategorien(viewer: TicketViewer): Promise<{
  alle: boolean;
  categoryIds: string[];
}> {
  if (viewer.can(TICKET_PERMISSIONS.admin)) {
    return { alle: true, categoryIds: [] };
  }
  if (!viewer.can(TICKET_PERMISSIONS.supportView)) {
    return { alle: false, categoryIds: [] };
  }

  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);
  const kategorien = await prisma.ticketCategory.findMany({
    select: { id: true, supportRoleIds: true },
  });

  return {
    alle: false,
    categoryIds: kategorien
      .filter((kategorie) => istZustaendig(viewer, kategorie, settings.defaultSupportRoleIds))
      .map((kategorie) => kategorie.id),
  };
}

/**
 * Bedingung fuer Datenbankabfragen.
 *
 * Liefert, was in ein `where` gehoert, damit eine Liste nur zeigt, was die
 * Person auch einzeln oeffnen duerfte. Bewusst hier und nicht in jeder
 * Abfrage neu.
 */
export async function ticketSichtbarkeitsFilter(viewer: TicketViewer): Promise<Record<string, unknown>> {
  const { alle, categoryIds } = await zustaendigeKategorien(viewer);
  if (alle) {
    return {};
  }

  const oder: Record<string, unknown>[] = [];

  // Eigene Tickets.
  if (viewer.can(TICKET_PERMISSIONS.viewOwn)) {
    oder.push({ creatorDiscordId: viewer.discordId });
    oder.push({
      participants: { some: { discordId: viewer.discordId, removedAt: null } },
    });
  }

  // Tickets der zustaendigen Kategorien.
  if (categoryIds.length > 0) {
    oder.push({ categoryId: { in: categoryIds } });
  }

  // Nichts sichtbar - eine Bedingung, die nie zutrifft, ist ehrlicher als
  // ein leeres `where`, das alles zeigte.
  if (oder.length === 0) {
    return { id: '__kein_zugriff__' };
  }
  return { OR: oder };
}
