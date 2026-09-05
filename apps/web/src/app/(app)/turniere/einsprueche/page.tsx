import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDateTime } from '@swisshub/shared';
import { tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { sichtbareTurnierIds, tournamentSections } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Einsprüche' };
export const dynamic = 'force-dynamic';

/**
 * Offene Einsprüche über alle Turniere.
 *
 * Entschieden wird auf der Matchseite - dort steht der Zusammenhang, ohne den
 * eine Entscheidung nicht zu treffen ist. Diese Liste ist der Weg dorthin,
 * die älteste zuerst.
 */
export default async function EinspruecheSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.disputesManage);
  const turnierIds = await sichtbareTurnierIds(context);

  const einsprueche =
    turnierIds.length > 0 ? await tournaments.listDisputes({ tournamentIds: turnierIds, offen: true }) : [];

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader title="Einsprüche" description="Strittige Resultate, die auf eine Entscheidung warten." />

      {einsprueche.length === 0 ? (
        <EmptyState title="Nichts offen" description="Zurzeit ist kein Resultat strittig." />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {einsprueche.map((einspruch) => (
            <li key={einspruch.id}>
              <Link
                href={`/turniere/matches/${einspruch.match.id}`}
                className="block space-y-1 px-4 py-3 transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    #{einspruch.match.matchNumber}
                  </span>
                  <span className="font-medium">
                    {einspruch.match.participantA?.team?.name ??
                      einspruch.match.participantA?.username ??
                      'Noch offen'}
                    {' – '}
                    {einspruch.match.participantB?.team?.name ??
                      einspruch.match.participantB?.username ??
                      'Noch offen'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {einspruch.tournament.name} · {formatDateTime(einspruch.createdAt)}
                  </span>
                </p>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {einspruch.openedByUsername}: {einspruch.reason}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
