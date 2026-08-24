import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { alsZeile, MatchAdminList } from '@/modules/tournaments/components/match-list';
import { requirePagePermission } from '@/server/auth';
import { sichtbareTurnierIds, tournamentSections } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Matches' };
export const dynamic = 'force-dynamic';

/**
 * Matches über alle laufenden Turniere.
 *
 * Zeigt zuerst, was Aufmerksamkeit braucht: strittige Resultate, laufende
 * Matches, offene Meldungen. Der Rest steht darunter.
 */
export default async function AlleMatchesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.matchesManage);
  const turnierIds = await sichtbareTurnierIds(context, { nurAktive: true });

  const matches =
    turnierIds.length > 0
      ? await tournaments.listMatches({ tournamentIds: turnierIds, limit: 300 })
      : [];

  const dringend = matches.filter(
    (match) =>
      match.status === 'DISPUTED' ||
      match.status === 'LIVE' ||
      match.status === 'AWAITING_RESULT',
  );
  const uebrige = matches.filter((match) => !dringend.includes(match));

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader
        title="Matches"
        description="Alle Matches der laufenden Turniere, für die du zuständig bist."
      />

      {dringend.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Braucht Aufmerksamkeit</h2>
          <MatchAdminList
            matches={dringend.map((match) => alsZeile(match, match.tournament.name))}
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          {dringend.length > 0 ? 'Übrige Matches' : 'Alle Matches'}
        </h2>
        <MatchAdminList
          matches={uebrige.map((match) => alsZeile(match, match.tournament.name))}
          leerTitel="Keine weiteren Matches"
          leerText="In den laufenden Turnieren ist alles entschieden oder noch nicht angesetzt."
        />
      </section>
    </>
  );
}
