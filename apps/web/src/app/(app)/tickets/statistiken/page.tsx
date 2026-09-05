import type { Metadata } from 'next';
import { Clock, Star, Ticket as TicketIcon, Timer } from 'lucide-react';
import { tickets } from '@swisshub/modules';
import { formatDuration } from '@swisshub/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { StatusBadge } from '@/modules/tickets/components/ticket-badges';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { ticketSections, ticketViewer } from '@/server/tickets';

export const metadata: Metadata = { title: 'Ticket-Statistiken' };
export const dynamic = 'force-dynamic';

/**
 * Kennzahlen des Supports.
 *
 * Es stehen nur Zahlen da, die sich aus echten Daten ergeben. Wo nichts
 * gemessen wurde, steht ein Strich - eine erfundene Durchschnittszeit waere
 * schlimmer als gar keine, weil man sich auf sie verliesse.
 */
export default async function TicketStatistikenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.statsView);
  const zahlen = await tickets.getStats(ticketViewer(context));

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tickets insgesamt" value={zahlen.gesamt} icon={<TicketIcon />} />
        <StatCard
          label="Erste Antwort"
          value={
            zahlen.ersteAntwortMinuten === null ? '—' : formatDuration(zahlen.ersteAntwortMinuten * 60_000)
          }
          hint={
            zahlen.ersteAntwortMinuten === null
              ? 'Noch keine Antwortzeit gemessen'
              : 'Durchschnitt der letzten 500 Tickets'
          }
          icon={<Clock />}
        />
        <StatCard
          label="Bis zum Abschluss"
          value={
            zahlen.loesungsdauerStunden === null
              ? '—'
              : formatDuration(zahlen.loesungsdauerStunden * 3_600_000)
          }
          hint={
            zahlen.loesungsdauerStunden === null
              ? 'Noch kein Ticket abgeschlossen'
              : 'Durchschnitt der letzten 500 abgeschlossenen'
          }
          icon={<Timer />}
        />
        <StatCard
          label="Bewertung"
          value={zahlen.bewertung ? zahlen.bewertung.schnitt.toFixed(1) : '—'}
          hint={
            zahlen.bewertung
              ? `${zahlen.bewertung.anzahl} ${zahlen.bewertung.anzahl === 1 ? 'Rückmeldung' : 'Rückmeldungen'}`
              : 'Noch keine Rückmeldungen'
          }
          icon={<Star />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nach Status</CardTitle>
          </CardHeader>
          <CardContent>
            {zahlen.proStatus.length === 0 ? (
              <EmptyState title="Noch keine Tickets" />
            ) : (
              <ul className="space-y-2">
                {zahlen.proStatus.map((eintrag) => (
                  <li key={eintrag.status} className="flex items-center justify-between gap-3">
                    <StatusBadge status={eintrag.status} />
                    <span className="tabular-nums text-sm">{eintrag.anzahl}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nach Kategorie</CardTitle>
          </CardHeader>
          <CardContent>
            {zahlen.proKategorie.length === 0 ? (
              <EmptyState title="Noch keine Tickets" />
            ) : (
              <ul className="space-y-2">
                {zahlen.proKategorie.map((eintrag) => {
                  const anteil = zahlen.gesamt > 0 ? Math.round((eintrag.anzahl / zahlen.gesamt) * 100) : 0;
                  return (
                    <li key={eintrag.name} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">{eintrag.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {eintrag.anzahl} · {anteil}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${anteil}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
