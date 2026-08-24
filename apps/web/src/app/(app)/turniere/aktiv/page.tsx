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

export const metadata: Metadata = { title: 'Aktive Turniere' };
export const dynamic = 'force-dynamic';

/** Was gerade läuft - vom offenen Anmeldefenster bis zur Pause. */
export default async function AktiveTurnierePage({
  searchParams,
}: {
  searchParams: Promise<TurnierListenSuche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.manage);
  const suche = await searchParams;

  const [{ rows, total, page, totalPages }, spiele] = await Promise.all([
    ladeTurnierListe(context, suche, { aktiv: true }),
    spielersuche.listGames({ includeDisabled: true }).catch(() => []),
  ]);

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader
        title="Aktive Turniere"
        description="Anmeldung, Check-in oder Spielbetrieb läuft."
      />
      <TournamentFilters
        action="/turniere/aktiv"
        suche={suche.q}
        status={suche.status}
        spielId={suche.spiel}
        spiele={spiele.map((spiel) => ({ id: spiel.id, name: spiel.name }))}
      />
      <TournamentList
        rows={rows}
        href={(id) => turnierHref(id)}
        leerTitel="Gerade läuft nichts"
        leerText="Kein Turnier ist derzeit in einer aktiven Phase."
      />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          buildHref={(ziel) => turnierListenHref('/turniere/aktiv', suche, ziel)}
        />
      ) : null}
    </>
  );
}
