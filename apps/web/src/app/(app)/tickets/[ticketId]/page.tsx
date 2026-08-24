import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react';
import { tickets } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { resolveGuildId } from '@swisshub/discord';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge, StatusBadge } from '@/modules/tickets/components/ticket-badges';
import { TicketComposer } from '@/modules/tickets/components/ticket-composer';
import { TicketControls } from '@/modules/tickets/components/ticket-controls';
import { TicketParticipants } from '@/modules/tickets/components/ticket-participants';
import { TicketThread } from '@/modules/tickets/components/ticket-thread';
import { TicketTimeline } from '@/modules/tickets/components/ticket-timeline';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTicketMitZugriff } from '@/server/tickets';

export const metadata: Metadata = { title: 'Ticket' };
export const dynamic = 'force-dynamic';

/**
 * Ein einzelnes Ticket.
 *
 * Der Zugriff wird einmal ermittelt und steuert danach alles: welche
 * Nachrichten geladen werden, welche Knoepfe erscheinen, ob Notizen
 * ueberhaupt vorkommen. Die Aktionen pruefen ihn erneut - hier geht es
 * darum, nichts zu laden, was die Person nicht sehen darf.
 */
export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}): Promise<React.JSX.Element> {
  const { ticketId } = await params;
  const context = await requireMember();
  const csrfToken = csrfTokenFor(context);

  const { ticket, zugriff } = await ladeTicketMitZugriff(context, ticketId);
  const guildId = await resolveGuildId().catch(() => null);
  // `notes` entscheidet ueber die Abfrage, nicht ueber die Darstellung: was
  // nicht geladen wird, kann auch nicht im Seitenquelltext auftauchen.
  const nachrichten = await tickets.listMessages(ticket.id, zugriff.notes);

  const geschlossen = ticket.status === 'CLOSED' || ticket.status === 'ARCHIVED';
  const formAnswers =
    ticket.formAnswers && typeof ticket.formAnswers === 'object' && !Array.isArray(ticket.formAnswers)
      ? (ticket.formAnswers as Record<string, string>)
      : {};

  const teilnehmer = [
    { discordId: ticket.creatorDiscordId, username: ticket.creatorUsername, ersteller: true },
    ...ticket.participants
      .filter((eintrag) => eintrag.discordId !== ticket.creatorDiscordId)
      .map((eintrag) => ({
        discordId: eintrag.discordId,
        username: eintrag.username,
        ersteller: false,
      })),
  ];

  const angaben: Array<{ label: string; wert: React.ReactNode }> = [
    { label: 'Kategorie', wert: ticket.category?.name ?? 'Ohne Kategorie' },
    { label: 'Eröffnet von', wert: `@${ticket.creatorUsername}` },
    {
      label: 'Bearbeitet von',
      wert: ticket.assignedToUsername ? `@${ticket.assignedToUsername}` : 'Noch niemand',
    },
    { label: 'Eröffnet am', wert: formatDateTime(ticket.createdAt) },
    {
      label: 'Letzte Nachricht',
      wert: ticket.lastMessageAt ? formatDateTime(ticket.lastMessageAt) : '—',
    },
    ...(ticket.closedAt
      ? [{ label: 'Geschlossen am', wert: formatDateTime(ticket.closedAt) }]
      : []),
    ...(ticket.closeReason ? [{ label: 'Grund', wert: ticket.closeReason }] : []),
  ];

  return (
    <>
      <PageHeader
        title={`#${String(ticket.ticketNumber).padStart(4, '0')} · ${ticket.subject}`}
        description={ticket.category?.name ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
          </div>
        }
      />

      <Link
        href="/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Zurück zur Übersicht
      </Link>

      {ticket.channelMissing ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Der Discord-Kanal zu diesem Ticket existiert nicht mehr. Der Verlauf bleibt hier
          vollständig erhalten, neue Nachrichten erreichen Discord aber nicht.
        </p>
      ) : null}

      {ticket.status === 'CREATION_FAILED' ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Der Discord-Kanal konnte nicht angelegt werden. Das Ticket ist erfasst, aber ohne Kanal.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {Object.keys(formAnswers).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Angaben beim Eröffnen</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3">
                  {Object.entries(formAnswers).map(([frage, antwort]) => (
                    <div key={frage}>
                      <dt className="text-xs font-medium text-muted-foreground">{frage}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">{antwort}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          <TicketThread messages={nachrichten} />

          <TicketComposer
            ticketId={ticket.id}
            csrfToken={csrfToken}
            darfAntworten={zugriff.reply}
            darfNotieren={zugriff.notes}
            geschlossen={geschlossen}
          />
        </div>

        <aside className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                {angaben.map((angabe) => (
                  <div key={angabe.label} className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{angabe.label}</dt>
                    <dd className="ml-auto min-w-0 break-words text-right">{angabe.wert}</dd>
                  </div>
                ))}
              </dl>

              {ticket.discordChannelId && !ticket.channelMissing && guildId ? (
                <a
                  href={`https://discord.com/channels/${guildId}/${ticket.discordChannelId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Kanal auf Discord öffnen
                </a>
              ) : null}

              <TicketControls
                ticketId={ticket.id}
                csrfToken={csrfToken}
                status={ticket.status}
                priority={ticket.priority}
                zugewiesen={ticket.assignedToDiscordId !== null}
                darfUebernehmen={zugriff.asStaff}
                darfVerwalten={zugriff.manage}
                darfSchliessen={zugriff.close}
                darfOeffnen={zugriff.asStaff}
                alsSupport={zugriff.asStaff}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Beteiligte</CardTitle>
            </CardHeader>
            <CardContent>
              <TicketParticipants
                ticketId={ticket.id}
                csrfToken={csrfToken}
                eintraege={teilnehmer}
                darfHinzufuegen={zugriff.asStaff && !geschlossen}
                darfEntfernen={zugriff.asStaff && !geschlossen}
              />
            </CardContent>
          </Card>

          {zugriff.asStaff ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Verlauf</CardTitle>
              </CardHeader>
              <CardContent>
                <TicketTimeline ereignisse={ticket.events} />
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
