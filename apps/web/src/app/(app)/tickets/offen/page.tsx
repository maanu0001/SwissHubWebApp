import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { Pagination } from '@/components/shared/pagination';
import { TicketFilters } from '@/modules/tickets/components/ticket-filters';
import { TicketList } from '@/modules/tickets/components/ticket-list';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import {
  ladeTicketListe,
  ticketListenHref,
  ticketSections,
  type TicketListenSuche,
} from '@/server/tickets';

export const metadata: Metadata = { title: 'Offene Tickets' };
export const dynamic = 'force-dynamic';

/** Die Warteschlange: alles, was noch nicht abgeschlossen ist. */
export default async function OffeneTicketsPage({
  searchParams,
}: {
  searchParams: Promise<TicketListenSuche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.supportView);
  const suche = await searchParams;

  const [{ rows, total, page, totalPages }, kategorien] = await Promise.all([
    ladeTicketListe(context, suche, { closed: false }),
    tickets.listOpenableCategories(),
  ]);

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <TicketFilters
        action="/tickets/offen"
        suche={suche.q}
        status={suche.status}
        prioritaet={suche.prio}
        kategorieId={suche.kategorie}
        kategorien={kategorien}
      />
      <TicketList
        rows={rows}
        leerTitel="Keine Tickets gefunden"
        leerText="Mit diesen Filtern wartet nichts auf Bearbeitung."
      />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          buildHref={(ziel) => ticketListenHref('/tickets/offen', suche, ziel)}
        />
      ) : null}
    </>
  );
}
