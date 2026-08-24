import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { spielersuche, tournaments } from '@swisshub/modules';
import { PageToolbar } from '@/components/shared/page-header';
import { Pagination } from '@/components/shared/pagination';
import { buttonVariants } from '@/components/ui/button';
import { TournamentFilters } from '@/modules/tournaments/components/tournament-filters';
import { TournamentList } from '@/modules/tournaments/components/tournament-list';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { can } from '@swisshub/auth';
import { requirePagePermission } from '@/server/auth';
import {
  ladeTurnierListe,
  tournamentSections,
  turnierHref,
  turnierListenHref,
  type TurnierListenSuche,
} from '@/server/tournaments';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Turniere' };
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht der Turnierverwaltung.
 *
 * Zeigt, was der Betrachter sehen darf - nicht, was es gibt. Die Filterung
 * geschieht in der Abfrage, nicht in der Darstellung: eine Liste, aus der
 * Einträge nur ausgeblendet werden, ist keine Zugriffsbeschränkung.
 */
export default async function TurnierUebersichtPage({
  searchParams,
}: {
  searchParams: Promise<TurnierListenSuche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.view);
  const suche = await searchParams;

  const [{ rows, total, page, totalPages }, spiele] = await Promise.all([
    ladeTurnierListe(context, suche),
    spielersuche.listGames({ includeDisabled: true }).catch(() => []),
  ]);

  const darfAnlegen = can(context, tournaments.TOURNAMENT_PERMISSIONS.create);

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      {/* Titel und Beschreibung liefert die Kopfzeile aus der Navigation -
          hier stünden sie ein zweites Mal. */}
      <PageToolbar
        actions={
          darfAnlegen ? (
            <Link href="/turniere/neu" className={cn(buttonVariants())}>
              <Plus aria-hidden="true" />
              Turnier erstellen
            </Link>
          ) : null
        }
      />
      <TournamentFilters
        action="/turniere/uebersicht"
        suche={suche.q}
        status={suche.status}
        spielId={suche.spiel}
        spiele={spiele.map((spiel) => ({ id: spiel.id, name: spiel.name }))}
      />
      <TournamentList
        rows={rows}
        href={(id) => turnierHref(id)}
        leerTitel="Noch keine Turniere"
        leerText={
          darfAnlegen
            ? 'Lege das erste Turnier an - danach steht es hier.'
            : 'Sobald dir ein Turnier zugeteilt ist, erscheint es hier.'
        }
      />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          buildHref={(ziel) => turnierListenHref('/turniere/uebersicht', suche, ziel)}
        />
      ) : null}
    </>
  );
}
