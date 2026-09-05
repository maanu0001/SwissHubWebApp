import Link from 'next/link';
import { formatDateTime } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import { PriorityBadge, StatusBadge } from './ticket-badges';

export interface TicketListRow {
  ticket: {
    id: string;
    ticketNumber: number;
    subject: string;
    status: string;
    priority: string;
    creatorUsername: string;
    assignedToUsername: string | null;
    lastMessageAt: Date | null;
    createdAt: Date;
  };
  categoryName: string | null;
  tagNames: string[];
  messageCount: number;
}

/**
 * Eine Ticketliste.
 *
 * Bewusst eine einzige Darstellung fuer Uebersicht, offene Tickets, eigene
 * Tickets und Archiv. Vier Listen, die dasselbe zeigen und sich langsam
 * auseinanderentwickeln, sind der uebliche Weg dorthin, dass eine davon eine
 * Angabe vergisst.
 */
export function TicketList({
  rows,
  leerTitel = 'Keine Tickets',
  leerText,
}: {
  rows: TicketListRow[];
  leerTitel?: string;
  leerText?: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title={leerTitel} description={leerText} />;
  }

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
      {rows.map(({ ticket, categoryName, tagNames, messageCount }) => (
        <li key={ticket.id}>
          <Link
            href={`/tickets/${ticket.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-card/70 sm:px-5"
          >
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
              #{String(ticket.ticketNumber).padStart(4, '0')}
            </span>
            <span className="min-w-0 flex-1 basis-48">
              <span className="block truncate font-medium">{ticket.subject}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {categoryName ? `${categoryName} · ` : ''}@{ticket.creatorUsername}
                {ticket.assignedToUsername ? ` · bearbeitet von @${ticket.assignedToUsername}` : ''}
                {messageCount > 0
                  ? ` · ${messageCount} ${messageCount === 1 ? 'Nachricht' : 'Nachrichten'}`
                  : ''}
              </span>
            </span>
            {/* Bewusst schrumpfbar: bei schmalem Fenster sollen die Abzeichen
                umbrechen statt am Rand abgeschnitten zu werden. */}
            <span className="flex flex-wrap items-center gap-1.5">
              {tagNames.slice(0, 2).map((name) => (
                <span
                  key={name}
                  className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {name}
                </span>
              ))}
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </span>
            <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:w-32">
              {formatDateTime(ticket.lastMessageAt ?? ticket.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
