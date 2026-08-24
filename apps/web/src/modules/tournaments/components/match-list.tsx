import Link from 'next/link';
import { formatDayTime } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import { MatchStatusBadge } from './tournament-badges';

export interface MatchZeile {
  id: string;
  matchNumber: number;
  round: number;
  status: string;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  scheduledAt: Date | null;
  stageName: string;
  groupName: string | null;
  turnierName?: string;
  a: string;
  b: string;
}

/** Matches als Liste - dieselbe Zeile im Turnier wie in der Gesamtübersicht. */
export function MatchAdminList({
  matches,
  leerTitel = 'Keine Matches',
  leerText,
}: {
  matches: MatchZeile[];
  leerTitel?: string;
  leerText?: string;
}): React.JSX.Element {
  if (matches.length === 0) {
    return <EmptyState title={leerTitel} description={leerText} />;
  }

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
      {matches.map((match) => (
        <li key={match.id}>
          <Link
            href={`/turniere/matches/${match.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
              #{match.matchNumber}
            </span>

            <span className="min-w-0 flex-1 basis-56">
              <span className="block truncate">
                {match.a} – {match.b}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {match.turnierName ? `${match.turnierName} · ` : ''}
                {match.groupName ?? match.stageName}, Runde {match.round}
                {match.bestOf > 1 ? ` · BO${match.bestOf}` : ''}
                {match.scheduledAt ? ` · ${formatDayTime(match.scheduledAt)}` : ''}
              </span>
            </span>

            {match.status === 'COMPLETED' || match.status === 'FORFEIT' ? (
              <span className="shrink-0 tabular-nums">
                {match.scoreA}:{match.scoreB}
              </span>
            ) : null}

            <MatchStatusBadge status={match.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

type ListenMatch = {
  id: string;
  matchNumber: number;
  round: number;
  status: string;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  scheduledAt: Date | null;
  stage: { name: string };
  group: { name: string } | null;
  participantA: { username: string | null; team: { name: string } | null } | null;
  participantB: { username: string | null; team: { name: string } | null } | null;
};

/** Ein Match aus der Abfrage in eine Zeile übersetzen. */
export function alsZeile(match: ListenMatch, turnierName?: string): MatchZeile {
  const name = (
    teilnehmer: { username: string | null; team: { name: string } | null } | null,
  ): string => teilnehmer?.team?.name ?? teilnehmer?.username ?? 'Noch offen';

  return {
    id: match.id,
    matchNumber: match.matchNumber,
    round: match.round,
    status: match.status,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    bestOf: match.bestOf,
    scheduledAt: match.scheduledAt,
    stageName: match.stage.name,
    groupName: match.group?.name ?? null,
    ...(turnierName ? { turnierName } : {}),
    a: name(match.participantA),
    b: name(match.participantB),
  };
}
