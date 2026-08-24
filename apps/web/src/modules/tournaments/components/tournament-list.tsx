import Link from 'next/link';
import { CalendarDays, Gamepad2, Swords, Users } from 'lucide-react';
import { formatDayTime } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import { FORMAT_LABEL, TournamentStatusBadge } from './tournament-badges';

export interface TurnierZeile {
  tournament: {
    id: string;
    slug: string;
    name: string;
    gameName: string;
    game: { id: string; name: string } | null;
    status: string;
    format: string;
    mode: string;
    maxParticipants: number;
    startsAt: Date | null;
  };
  anmeldungen: number;
  matches: number;
}

/**
 * Die Turnierliste der Verwaltung.
 *
 * Bewusst Karten statt einer Tabelle: ein Turnier hat Status, Spiel, Datum und
 * zwei Zahlen - das passt in eine Zeile, aber auf dem Handy nicht in eine
 * Tabellenzeile. Verlinkt wird auf den Leitstand, nicht auf die öffentliche
 * Seite: wer hier ist, will arbeiten.
 */
export function TournamentList({
  rows,
  href,
  leerTitel = 'Keine Turniere gefunden',
  leerText,
}: {
  rows: TurnierZeile[];
  href: (tournamentId: string) => string;
  leerTitel?: string;
  leerText?: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title={leerTitel} description={leerText} />;
  }

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
      {rows.map(({ tournament, anmeldungen, matches }) => (
        <li key={tournament.id}>
          <Link
            href={href(tournament.id)}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 basis-64">
              <span className="block truncate font-medium">{tournament.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Gamepad2 className="size-3.5 shrink-0" aria-hidden="true" />
                  {tournament.game?.name ?? tournament.gameName}
                </span>
                <span>{FORMAT_LABEL[tournament.format] ?? tournament.format}</span>
                {tournament.startsAt ? (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                    {formatDayTime(tournament.startsAt)}
                  </span>
                ) : null}
              </span>
            </span>

            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
              {tournament.maxParticipants > 0
                ? `${anmeldungen}/${tournament.maxParticipants}`
                : anmeldungen}
            </span>

            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Swords className="size-3.5 shrink-0" aria-hidden="true" />
              {matches}
            </span>

            <TournamentStatusBadge status={tournament.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
