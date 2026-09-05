import type { Metadata } from 'next';
import Link from 'next/link';
import { Mic, Radio } from 'lucide-react';
import { prisma } from '@swisshub/database';
import { formatDayTime } from '@swisshub/shared';
import { tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { MatchStatusBadge, StreamStatusBadge } from '@/modules/tournaments/components/tournament-badges';
import { requirePagePermission } from '@/server/auth';
import { sichtbareTurnierIds, tournamentSections } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Livestream' };
export const dynamic = 'force-dynamic';

/**
 * Der Stream-Zeitplan über alle laufenden Turniere.
 *
 * Nur Matches, die tatsächlich gestreamt werden - eine Liste aller Matches
 * wäre kein Zeitplan, sondern das Bracket in anderer Form. Stream und Caster
 * werden auf der Matchseite gesetzt, wo auch der Rest des Matches steht.
 */
export default async function LivestreamSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.streamManage);
  const turnierIds = await sichtbareTurnierIds(context, { nurAktive: true });

  const matches =
    turnierIds.length > 0
      ? await prisma.tournamentMatch.findMany({
          where: {
            tournamentId: { in: turnierIds },
            streamStatus: { in: ['PLANNED', 'LIVE', 'FINISHED'] },
          },
          orderBy: [{ streamStatus: 'asc' }, { scheduledAt: 'asc' }, { matchNumber: 'asc' }],
          take: 200,
          include: {
            tournament: { select: { name: true } },
            stage: { select: { name: true } },
            casters: true,
            participantA: { select: { username: true, team: { select: { name: true } } } },
            participantB: { select: { username: true, team: { select: { name: true } } } },
          },
        })
      : [];

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader
        title="Livestream"
        description="Was gestreamt wird - und wer castet. Gesetzt wird es auf der Matchseite."
      />

      {matches.length === 0 ? (
        <EmptyState
          title="Nichts geplant"
          description="Sobald ein Match für den Stream vorgesehen ist, steht es hier."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {matches.map((match) => (
            <li key={match.id}>
              <Link
                href={`/turniere/matches/${match.id}`}
                className="block space-y-1 px-4 py-3 transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Radio
                    className={
                      match.streamStatus === 'LIVE'
                        ? 'size-4 shrink-0 text-destructive'
                        : 'size-4 shrink-0 text-muted-foreground'
                    }
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 basis-56 truncate font-medium">
                    {match.participantA?.team?.name ?? match.participantA?.username ?? 'Noch offen'}
                    {' – '}
                    {match.participantB?.team?.name ?? match.participantB?.username ?? 'Noch offen'}
                  </span>
                  <StreamStatusBadge status={match.streamStatus} />
                  <MatchStatusBadge status={match.status} />
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {match.tournament.name} · {match.stage.name} · #{match.matchNumber}
                  </span>
                  {match.scheduledAt ? <span>{formatDayTime(match.scheduledAt)}</span> : null}
                  {match.casters.length > 0 ? (
                    <span className="flex items-center gap-1">
                      <Mic className="size-3.5" aria-hidden="true" />
                      {match.casters.map((caster) => caster.username).join(', ')}
                    </span>
                  ) : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
