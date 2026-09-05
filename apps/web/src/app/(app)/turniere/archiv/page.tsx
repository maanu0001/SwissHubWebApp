import type { Metadata } from 'next';
import { spielersuche, tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { Pagination } from '@/components/shared/pagination';
import { TournamentFilters } from '@/modules/tournaments/components/tournament-filters';
import { TournamentList } from '@/modules/tournaments/components/tournament-list';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import {
  ladeTurnierListe,
  tournamentSections,
  turnierHref,
  turnierListenHref,
  type TurnierListenSuche,
} from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turnier-Archiv' };
export const dynamic = 'force-dynamic';

/** Was vorbei ist - abgeschlossen, abgesagt oder archiviert. */
export default async function TurnierArchivPage({
  searchParams,
}: {
  searchParams: Promise<TurnierListenSuche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.archiveView);
  const suche = await searchParams;

  const [{ rows, total, page, totalPages }, spiele] = await Promise.all([
    ladeTurnierListe(context, suche, { archiv: true }),
    spielersuche.listGames({ includeDisabled: true }).catch(() => []),
  ]);

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader title="Archiv" description="Abgeschlossene, abgesagte und archivierte Turniere." />
      <TournamentFilters
        action="/turniere/archiv"
        suche={suche.q}
        status={suche.status}
        spielId={suche.spiel}
        spiele={spiele.map((spiel) => ({ id: spiel.id, name: spiel.name }))}
        archiv
      />
      <TournamentList
        rows={rows}
        href={(id) => turnierHref(id)}
        leerTitel="Noch nichts im Archiv"
        leerText="Sobald ein Turnier abgeschlossen ist, steht es hier."
      />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          buildHref={(ziel) => turnierListenHref('/turniere/archiv', suche, ziel)}
        />
      ) : null}
    </>
  );
}
