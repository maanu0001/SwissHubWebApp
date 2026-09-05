import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { Pagination } from '@/components/shared/pagination';
import { TicketFilters } from '@/modules/tickets/components/ticket-filters';
import { TicketList } from '@/modules/tickets/components/ticket-list';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { ladeTicketListe, ticketListenHref, ticketSections, type TicketListenSuche } from '@/server/tickets';

export const metadata: Metadata = { title: 'Meine Tickets' };
export const dynamic = 'force-dynamic';

/**
 * Was diese Person selbst bearbeitet.
 *
 * Bewusst die Zuweisung und nicht die Erstellung: fuer Support ist «meine»
 * das, wofuer man geradesteht.
 */
export default async function MeineTicketsPage({
  searchParams,
}: {
  searchParams: Promise<TicketListenSuche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.supportView);
  const suche = await searchParams;

  const [{ rows, total, page, totalPages }, kategorien] = await Promise.all([
    ladeTicketListe(context, suche, { closed: false, assignedTo: context.user.discordId }),
    tickets.listOpenableCategories(),
  ]);

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <TicketFilters
        action="/tickets/meine"
        suche={suche.q}
        status={suche.status}
        prioritaet={suche.prio}
        kategorieId={suche.kategorie}
        kategorien={kategorien}
      />
      <TicketList
        rows={rows}
        leerTitel="Du bearbeitest gerade nichts"
        leerText="Übernimm ein Ticket aus der Warteschlange, dann erscheint es hier."
      />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          buildHref={(ziel) => ticketListenHref('/tickets/meine', suche, ziel)}
        />
      ) : null}
    </>
  );
}
