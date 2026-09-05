import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Clock, Inbox, TicketIcon, UserCheck, Users } from 'lucide-react';
import { isModuleEnabled, tickets } from '@swisshub/modules';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { TicketList } from '@/modules/tickets/components/ticket-list';
import { requirePagePermission } from '@/server/auth';
import { istSupport, ticketSections, ticketViewer } from '@/server/tickets';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Tickets' };
export const dynamic = 'force-dynamic';

/**
 * Der Einstieg ins Ticket-Modul.
 *
 * Support sieht die Lage des ganzen Teams, ein gewoehnliches Mitglied seine
 * eigenen Anliegen. Bewusst dieselbe Adresse: wer hier landet, soll das
 * sehen, was ihn betrifft, statt sich durch eine Navigation zu suchen.
 */
export default async function TicketsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.viewOwn);

  if (!(await isModuleEnabled(tickets.TICKETS_MODULE_ID))) {
    return (
      <EmptyState
        title="Das Ticket-Modul ist ausgeschaltet"
        description="Ein Mitglied der Verwaltung kann es unter Module einschalten."
      />
    );
  }

  const viewer = ticketViewer(context);
  const support = istSupport(context);
  const nav = <TicketSectionNav sections={ticketSections(context)} />;

  const { rows } = await tickets.listTickets(viewer, {
    closed: false,
    ...(support ? {} : { creatorDiscordId: context.user.discordId }),
    page: 1,
    pageSize: support ? 10 : 25,
  });

  if (!support) {
    return (
      <>
        {nav}
        <TicketList
          rows={rows}
          leerTitel="Du hast aktuell keine Tickets"
          leerText="Über «Neues Ticket» oder das Support-Panel auf Discord eröffnest du ein Anliegen."
        />
      </>
    );
  }

  const kennzahlen = await tickets.getOverview(viewer);

  const karten = [
    { label: 'Offen', wert: kennzahlen.offen, icon: Inbox },
    { label: 'In Bearbeitung', wert: kennzahlen.inBearbeitung, icon: UserCheck },
    {
      label: 'Wartet auf Support',
      wert: kennzahlen.wartetAufSupport,
      icon: Clock,
      warnung: kennzahlen.wartetAufSupport > 0,
    },
    { label: 'Wartet auf Mitglied', wert: kennzahlen.wartetAufMitglied, icon: Users },
    {
      label: 'Nicht zugewiesen',
      wert: kennzahlen.nichtZugewiesen,
      icon: TicketIcon,
      warnung: kennzahlen.nichtZugewiesen > 0,
    },
    {
      label: 'Überfällig',
      wert: kennzahlen.ueberfaellig,
      icon: AlertTriangle,
      warnung: kennzahlen.ueberfaellig > 0,
    },
  ];

  return (
    <>
      {nav}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {karten.map((karte) => (
          <Card key={karte.label}>
            <CardContent className="flex items-center gap-4 pt-6">
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-xl',
                  karte.warnung ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary-bright',
                )}
                aria-hidden="true"
              >
                <karte.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-2xl font-semibold tabular-nums">{karte.wert}</p>
                <p className="truncate text-sm text-muted-foreground">{karte.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Neueste Tickets</h2>
          <Link
            href="/tickets/offen"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Alle offenen ansehen
          </Link>
        </div>
        <TicketList
          rows={rows}
          leerTitel="Keine offenen Tickets"
          leerText="Derzeit wartet nichts auf Bearbeitung."
        />
      </section>
    </>
  );
}
