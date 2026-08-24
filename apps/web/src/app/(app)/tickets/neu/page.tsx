import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { isModuleEnabled, tickets } from '@swisshub/modules';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { PageHeader } from '@/components/shared/page-header';
import { CreateTicketForm } from '@/modules/tickets/components/create-ticket-form';
import { can } from '@swisshub/auth';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Neues Ticket' };
export const dynamic = 'force-dynamic';

/** Ein Ticket ohne Umweg über Discord eröffnen. */
export default async function NeuesTicketPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.create);

  if (!(await isModuleEnabled(tickets.TICKETS_MODULE_ID))) {
    return (
      <EmptyState
        title="Das Ticket-Modul ist ausgeschaltet"
        description="Ein Mitglied der Verwaltung kann es unter Module einschalten."
      />
    );
  }

  const kategorien = await prisma.ticketCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      emoji: true,
      formFields: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          kind: true,
          label: true,
          placeholder: true,
          required: true,
          minLength: true,
          maxLength: true,
        },
      },
    },
  });

  if (kategorien.length === 0) {
    return (
      <EmptyState
        title="Es steht keine Kategorie bereit"
        description="Ohne aktive Kategorie lässt sich kein Ticket eröffnen. Das Support-Team richtet sie unter Tickets → Kategorien ein."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Neues Ticket"
        description="Das Team antwortet im Dashboard und auf Discord - beides ist derselbe Verlauf."
      />
      <Card>
        <CardContent className="pt-6">
          <CreateTicketForm
            csrfToken={csrfTokenFor(context)}
            kategorien={kategorien}
            darfFuerAndere={can(context, tickets.TICKET_PERMISSIONS.createForUser)}
          />
        </CardContent>
      </Card>
    </>
  );
}
