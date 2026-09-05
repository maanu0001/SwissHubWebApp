import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { BracketAdmin, GruppenTabellen, RundenPlanung } from '@/modules/tournaments/components/bracket-admin';
import { BracketView } from '@/modules/tournaments/components/bracket-view';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Bracket' };
export const dynamic = 'force-dynamic';

/** Setzliste, Bracket und - bei Gruppen - die Tabellen. */
export default async function TurnierBracketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { tournament, zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.bracketManage && !zugriff.asStaff) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst das Bracket dieses Turniers nicht sehen.',
    });
  }

  const [bracket, antretende, tabellen] = await Promise.all([
    tournaments.getBracket(id),
    tournaments.listAntretende(id),
    tournament.format === 'GROUPS_THEN_ELIMINATION'
      ? tournaments.getGruppenTabellen(id)
      : Promise.resolve([]),
  ]);

  const hatBracket = bracket.some((abschnitt) => abschnitt.matches.length > 0);

  // Für die Endrunde müssen die Gruppenspiele durch sein. Die eigentliche
  // Prüfung macht der Server; hier entscheidet es nur, ob der Knopf erscheint.
  const gruppenAbschnitt = bracket.find((abschnitt) => abschnitt.kind === 'GROUPS');
  const gruppenFertig =
    gruppenAbschnitt !== undefined &&
    gruppenAbschnitt.matches.length > 0 &&
    gruppenAbschnitt.matches.every((match) => match.status === 'COMPLETED' || match.status === 'FORFEIT');

  const swissAbschnitt = bracket.find((abschnitt) => abschnitt.kind === 'SWISS');
  const swissRundeFertig =
    swissAbschnitt !== undefined &&
    swissAbschnitt.matches.length > 0 &&
    swissAbschnitt.matches.every((match) => match.status === 'COMPLETED' || match.status === 'FORFEIT');

  return (
    <div className="space-y-8">
      <BracketAdmin
        tournamentId={id}
        csrfToken={csrfTokenFor(context)}
        darfVerwalten={zugriff.bracketManage}
        hatBracket={hatBracket}
        manuelleSetzung={tournament.seeding === 'MANUAL'}
        format={tournament.format}
        gruppenFertig={gruppenFertig}
        swissOffen={swissRundeFertig}
        antretende={antretende
          .filter((eintrag) => eintrag.participant !== null)
          .map((eintrag) => ({
            participantId: eintrag.participant!.id,
            label: eintrag.team?.name ?? eintrag.username,
            seed: eintrag.participant!.seed,
          }))
          .sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999))}
      />

      {zugriff.matchesManage && hatBracket ? (
        <RundenPlanung
          tournamentId={id}
          csrfToken={csrfTokenFor(context)}
          runden={bracket.flatMap((abschnitt) => {
            const runden = [...new Set(abschnitt.matches.map((match) => match.round))].sort((a, b) => a - b);
            return runden.map((runde) => {
              const matches = abschnitt.matches.filter((match) => match.round === runde);
              return {
                stageId: abschnitt.id,
                stageName: abschnitt.name,
                round: runde,
                matches: matches.length,
                offen: matches.filter((match) => match.status !== 'COMPLETED' && match.status !== 'FORFEIT')
                  .length,
              };
            });
          })}
        />
      ) : null}

      {tabellen.length > 0 ? (
        <GruppenTabellen
          tabellen={tabellen.map((tabelle) => ({
            groupId: tabelle.groupId,
            name: tabelle.name,
            zeilen: tabelle.zeilen.map((zeile) => ({
              label: zeile.participant.label,
              gespielt: zeile.gespielt,
              siege: zeile.siege,
              unentschieden: zeile.unentschieden,
              niederlagen: zeile.niederlagen,
              punkte: zeile.punkte,
              differenz: zeile.differenz,
            })),
          }))}
        />
      ) : null}

      {hatBracket ? (
        <BracketView
          abschnitte={bracket.map((abschnitt) => ({
            id: abschnitt.id,
            name: abschnitt.name,
            kind: abschnitt.kind,
            roundCount: abschnitt.roundCount,
            groups: abschnitt.groups,
            matches: abschnitt.matches,
          }))}
          matchHref={(matchId) => `/turniere/matches/${matchId}`}
        />
      ) : null}
    </div>
  );
}
