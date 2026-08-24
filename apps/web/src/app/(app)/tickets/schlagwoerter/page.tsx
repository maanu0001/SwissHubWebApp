import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { TagManager } from '@/modules/tickets/components/tag-manager';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ticketSections } from '@/server/tickets';

export const metadata: Metadata = { title: 'Schlagwörter' };
export const dynamic = 'force-dynamic';

/** Schlagwörter, mit denen sich Tickets einordnen lassen. */
export default async function TicketSchlagwoerterPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.supportManageTags);
  const schlagwoerter = await tickets.listTags();

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <TagManager
        csrfToken={csrfTokenFor(context)}
        schlagwoerter={schlagwoerter.map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          anzahl: tag.anzahl,
        }))}
      />
    </>
  );
}
