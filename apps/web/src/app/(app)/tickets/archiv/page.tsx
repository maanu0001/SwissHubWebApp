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

export const metadata: Metadata = { title: 'Ticket-Archiv' };
export const dynamic = 'force-dynamic';

/**
 * Geschlossene Tickets.
 *
 * Dieselbe Sichtbarkeit wie ueberall: das Archiv ist kein Schlupfloch, durch
 * das ein Supporter Tickets fremder Kategorien lesen koennte.
 */
export default async function TicketArchivPage({
  searchParams,
}: {
  searchParams: Promise<TicketListenSuche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.archiveView);
  const suche = await searchParams;

  const [{ rows, total, page, totalPages }, kategorien] = await Promise.all([
    ladeTicketListe(context, suche, { closed: true }),
    tickets.listOpenableCategories(),
  ]);

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <TicketFilters
        action="/tickets/archiv"
        suche={suche.q}
        status={suche.status}
        prioritaet={suche.prio}
        kategorieId={suche.kategorie}
        kategorien={kategorien}
        archiv
      />
      <TicketList
        rows={rows}
        leerTitel="Nichts im Archiv"
        leerText="Geschlossene Tickets erscheinen hier."
      />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          buildHref={(ziel) => ticketListenHref('/tickets/archiv', suche, ziel)}
        />
      ) : null}
    </>
  );
}
