import Link from 'next/link';
import { formatDayTime } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import { MatchStatusBadge } from './tournament-badges';

export interface BracketTeilnehmer {
  id: string;
  username: string | null;
  seed: number | null;
  team: { id: string; name: string; tag: string | null; logoUrl: string | null } | null;
}

export interface BracketMatch {
  id: string;
  matchNumber: number;
  round: number;
  position: number;
  status: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  bestOf: number;
  scheduledAt: Date | null;
  participantA: BracketTeilnehmer | null;
  participantB: BracketTeilnehmer | null;
}

export interface BracketAbschnitt {
  id: string;
  name: string;
  kind: string;
  roundCount: number;
  groups: Array<{ id: string; name: string }>;
  matches: BracketMatch[];
}

/** Wie ein Teilnehmer heisst. */
export function teilnehmerName(teilnehmer: BracketTeilnehmer | null): string {
  if (!teilnehmer) {
    return 'Noch offen';
  }
  return teilnehmer.team?.name ?? teilnehmer.username ?? 'Unbekannt';
}

/** Der Name einer Runde - «Finale» sagt mehr als «Runde 4». */
export function rundenName(runde: number, gesamt: number, abschnitt: string): string {
  if (abschnitt === 'GRAND_FINAL') {
    return 'Grosses Finale';
  }
  const verbleibend = gesamt - runde;
  if (verbleibend === 0) {
    return 'Finale';
  }
  if (verbleibend === 1) {
    return 'Halbfinale';
  }
  if (verbleibend === 2) {
    return 'Viertelfinale';
  }
  return `Runde ${runde}`;
}

/**
 * Das Bracket.
 *
 * Auf dem Desktop nebeneinander, auf dem Handy untereinander - dieselbe
 * Darstellung, nur anders umgebrochen. Eine breite Tabelle, die man seitwaerts
 * schiebt, ist auf dem Handy unbrauchbar.
 *
 * Darunter steht dieselbe Information als gewoehnliche Liste. Das ist nicht
 * doppelt gemoppelt: ein Bracket ist eine raeumliche Darstellung, und wer es
 * sich vorlesen laesst, bekommt aus nebeneinanderstehenden Kaesten nichts.
 */
export function BracketView({
  abschnitte,
  matchHref,
}: {
  abschnitte: BracketAbschnitt[];
  /** Adresse der Matchseite; ohne sie sind die Matches nicht anklickbar. */
  matchHref?: (matchId: string) => string;
}): React.JSX.Element {
  const mitMatches = abschnitte.filter((abschnitt) => abschnitt.matches.length > 0);

  if (mitMatches.length === 0) {
    return (
      <EmptyState
        title="Noch kein Bracket"
        description="Sobald die Setzliste steht, erscheint hier der Turnierbaum."
      />
    );
  }

  return (
    <div className="space-y-8">
      {mitMatches.map((abschnitt) => (
        <section key={abschnitt.id} className="space-y-3">
          <h3 className="text-sm font-semibold">{abschnitt.name}</h3>

          {abschnitt.kind === 'GROUPS' || abschnitt.kind === 'ROUND_ROBIN' || abschnitt.kind === 'SWISS' ? (
            <MatchListe abschnitt={abschnitt} matchHref={matchHref} />
          ) : (
            <>
              {/* Der Baum - ab Tablet nebeneinander. */}
              <div
                className="hidden overflow-x-auto pb-2 md:block"
                // Ein Bracket kann breiter sein als das Fenster. Es scrollt in
                // seinem eigenen Kasten, damit die Seite es nicht tut.
                role="group"
                aria-label={`${abschnitt.name} als Turnierbaum`}
              >
                <div className="flex min-w-max gap-6">
                  {runden(abschnitt).map((runde) => (
                    <div key={runde} className="flex w-60 shrink-0 flex-col justify-around gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {rundenName(runde, abschnitt.roundCount, abschnitt.kind)}
                      </p>
                      {abschnitt.matches
                        .filter((match) => match.round === runde)
                        .map((match) => (
                          <MatchKarte key={match.id} match={match} matchHref={matchHref} />
                        ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* Handy: untereinander, Runde für Runde. */}
              <div className="space-y-4 md:hidden">
                {runden(abschnitt).map((runde) => (
                  <div key={runde} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {rundenName(runde, abschnitt.roundCount, abschnitt.kind)}
                    </p>
                    {abschnitt.matches
                      .filter((match) => match.round === runde)
                      .map((match) => (
                        <MatchKarte key={match.id} match={match} matchHref={matchHref} />
                      ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function runden(abschnitt: BracketAbschnitt): number[] {
  return [...new Set(abschnitt.matches.map((match) => match.round))].sort((a, b) => a - b);
}

function MatchKarte({
  match,
  matchHref,
}: {
  match: BracketMatch;
  matchHref?: (matchId: string) => string;
}): React.JSX.Element {
  const inhalt = (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 transition-colors',
        match.status === 'LIVE'
          ? 'border-primary/60 bg-primary/5'
          : match.status === 'DISPUTED'
            ? 'border-destructive/50 bg-destructive/5'
            : 'border-border',
        matchHref ? 'hover:border-primary/50 hover:bg-card/70' : '',
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">#{match.matchNumber}</span>
        <span className="text-[11px] text-muted-foreground">
          {match.bestOf > 1 ? `BO${match.bestOf}` : ''}
          {match.scheduledAt ? ` · ${formatDayTime(match.scheduledAt)}` : ''}
        </span>
      </div>

      <Seite
        teilnehmer={match.participantA}
        score={match.scoreA}
        gewonnen={match.winnerId !== null && match.winnerId === match.participantA?.id}
        entschieden={match.status === 'COMPLETED' || match.status === 'FORFEIT'}
      />
      <Seite
        teilnehmer={match.participantB}
        score={match.scoreB}
        gewonnen={match.winnerId !== null && match.winnerId === match.participantB?.id}
        entschieden={match.status === 'COMPLETED' || match.status === 'FORFEIT'}
      />
    </div>
  );

  if (!matchHref) {
    return inhalt;
  }
  return (
    <Link
      href={matchHref(match.id)}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Match ${match.matchNumber}: ${teilnehmerName(match.participantA)} gegen ${teilnehmerName(match.participantB)}`}
    >
      {inhalt}
    </Link>
  );
}

function Seite({
  teilnehmer,
  score,
  gewonnen,
  entschieden,
}: {
  teilnehmer: BracketTeilnehmer | null;
  score: number;
  gewonnen: boolean;
  entschieden: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {teilnehmer?.seed ? (
        <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
          {teilnehmer.seed}
        </span>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          teilnehmer === null ? 'text-muted-foreground' : '',
          gewonnen ? 'font-semibold' : '',
        )}
      >
        {teilnehmerName(teilnehmer)}
      </span>
      {entschieden ? (
        <span
          className={cn(
            'shrink-0 tabular-nums text-sm',
            gewonnen ? 'font-semibold' : 'text-muted-foreground',
          )}
        >
          {score}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Dieselben Matches als Liste.
 *
 * Fuer Gruppen und das Schweizer System die einzig sinnvolle Darstellung -
 * dort gibt es keinen Baum. Und fuer alle anderen die zugaengliche Fassung:
 * ein Screenreader liest hier eine Reihenfolge, wo im Baum nur Kaesten
 * nebeneinanderstehen.
 */
export function MatchListe({
  abschnitt,
  matchHref,
}: {
  abschnitt: BracketAbschnitt;
  matchHref?: (matchId: string) => string;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      {runden(abschnitt).map((runde) => (
        <div key={runde} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {abschnitt.kind === 'GROUPS' || abschnitt.kind === 'SWISS' || abschnitt.kind === 'ROUND_ROBIN'
              ? `Runde ${runde}`
              : rundenName(runde, abschnitt.roundCount, abschnitt.kind)}
          </p>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {abschnitt.matches
              .filter((match) => match.round === runde)
              .map((match) => {
                const zeile = (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                      #{match.matchNumber}
                    </span>
                    <span className="min-w-0 flex-1 basis-48 truncate text-sm">
                      <span className={cn(match.winnerId === match.participantA?.id ? 'font-semibold' : '')}>
                        {teilnehmerName(match.participantA)}
                      </span>
                      {' – '}
                      <span className={cn(match.winnerId === match.participantB?.id ? 'font-semibold' : '')}>
                        {teilnehmerName(match.participantB)}
                      </span>
                    </span>
                    {match.status === 'COMPLETED' || match.status === 'FORFEIT' ? (
                      <span className="shrink-0 tabular-nums text-sm">
                        {match.scoreA}:{match.scoreB}
                      </span>
                    ) : null}
                    <MatchStatusBadge status={match.status} />
                  </span>
                );

                return (
                  <li key={match.id}>
                    {matchHref ? (
                      <Link href={matchHref(match.id)} className="block transition-colors hover:bg-card/70">
                        {zeile}
                      </Link>
                    ) : (
                      zeile
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Die zugaengliche Fassung des ganzen Brackets.
 *
 * Bewusst sichtbar und nicht nur fuer Screenreader versteckt: eine
 * Matchliste ist auch mit den Augen manchmal die schnellere Antwort auf «wann
 * spielen wir?».
 */
export function BracketListe({
  abschnitte,
  matchHref,
}: {
  abschnitte: BracketAbschnitt[];
  matchHref?: (matchId: string) => string;
}): React.JSX.Element {
  const mitMatches = abschnitte.filter((abschnitt) => abschnitt.matches.length > 0);

  if (mitMatches.length === 0) {
    return <EmptyState title="Noch keine Matches" />;
  }

  return (
    <div className="space-y-6">
      {mitMatches.map((abschnitt) => (
        <section key={abschnitt.id} className="space-y-3">
          <h3 className="text-sm font-semibold">{abschnitt.name}</h3>
          <MatchListe abschnitt={abschnitt} matchHref={matchHref} />
        </section>
      ))}
    </div>
  );
}
