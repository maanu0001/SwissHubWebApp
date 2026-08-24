import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Radio } from 'lucide-react';
import { tournaments } from '@swisshub/modules';
import { formatDayTime } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import { ControlCenter } from '@/modules/tournaments/components/control-center';
import { MatchStatusBadge } from '@/modules/tournaments/components/tournament-badges';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff, turnierHref } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Leitstand' };
export const dynamic = 'force-dynamic';

/**
 * Der Leitstand eines Turniers.
 *
 * Was gerade los ist und was als Nächstes dran ist - mehr nicht. Alles, was
 * Detailarbeit braucht, liegt auf den Reitern daneben.
 */
export default async function TurnierLeitstandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { tournament, zugriff } = await ladeTurnierMitZugriff(context, id);

  // Der Startcheck der Phase, die als Nächstes ansteht. Vor dem Start zählt
  // etwas anderes als vor der Veröffentlichung.
  const phase: tournaments.PreflightPhase | null =
    tournament.status === 'DRAFT'
      ? 'PUBLISH'
      : tournament.status === 'CHECKIN_OPEN' || tournament.status === 'CHECKIN_CLOSED'
        ? 'CHECKIN_CLOSE'
        : tournament.status === 'READY'
          ? 'START'
          : null;

  const [zustand, startcheck, offeneMatches, einsprueche] = await Promise.all([
    tournaments.getLiveZustand(id),
    phase ? tournaments.preflight(id, phase) : Promise.resolve([]),
    tournaments.listMatches({
      tournamentId: id,
      status: ['LIVE', 'AWAITING_RESULT', 'DISPUTED'],
      limit: 10,
    }),
    zugriff.disputesManage
      ? tournaments.listDisputes({ tournamentId: id, offen: true })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <ControlCenter
        tournamentId={id}
        csrfToken={csrfTokenFor(context)}
        anfangsZustand={zustand}
        startcheck={startcheck}
        darfSteuern={zugriff.publish}
      />

      {einsprueche.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
            Offene Einsprüche
          </h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-destructive/40">
            {einsprueche.map((einspruch) => (
              <li key={einspruch.id}>
                <Link
                  href={`/turniere/matches/${einspruch.match.id}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-card/70"
                >
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                    #{einspruch.match.matchNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{einspruch.reason}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Radio className="size-4" aria-hidden="true" />
          Was gerade läuft
        </h2>
        {offeneMatches.length === 0 ? (
          <EmptyState
            title="Kein Match in Bewegung"
            description="Sobald ein Match läuft oder auf ein Resultat wartet, steht es hier."
          />
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {offeneMatches.map((match) => (
              <li key={match.id}>
                <Link
                  href={`/turniere/matches/${match.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-card/70"
                >
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                    #{match.matchNumber}
                  </span>
                  <span className="min-w-0 flex-1 basis-48 truncate">
                    {tournaments.teilnehmerLabel(match.participantA) ?? 'Noch offen'}
                    {' – '}
                    {tournaments.teilnehmerLabel(match.participantB) ?? 'Noch offen'}
                  </span>
                  {match.scheduledAt ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDayTime(match.scheduledAt)}
                    </span>
                  ) : null}
                  <MatchStatusBadge status={match.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          <Link href={turnierHref(id, 'matches')} className="text-primary underline underline-offset-2">
            Alle Matches dieses Turniers
          </Link>
        </p>
      </section>
    </div>
  );
}
