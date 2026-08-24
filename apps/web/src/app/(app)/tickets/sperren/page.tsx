import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { BlockManager } from '@/modules/tickets/components/block-manager';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ticketSections } from '@/server/tickets';

export const metadata: Metadata = { title: 'Ticket-Sperren' };
export const dynamic = 'force-dynamic';

/** Wer keine neuen Tickets mehr eröffnen darf. */
export default async function TicketSperrenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.blockManage);
  const sperren = await tickets.listBlocks();

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <BlockManager
        csrfToken={csrfTokenFor(context)}
        sperren={sperren.map((sperre) => ({
          id: sperre.id,
          discordId: sperre.discordId,
          username: sperre.username,
          reason: sperre.reason,
          createdAt: sperre.createdAt.toISOString(),
          expiresAt: sperre.expiresAt?.toISOString() ?? null,
          liftedAt: sperre.liftedAt?.toISOString() ?? null,
          aktiv: sperre.aktiv,
        }))}
      />
    </>
  );
}
