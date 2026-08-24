import type { Metadata } from 'next';
import { spielersuche, tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { LEERE_WERTE, TournamentForm } from '@/modules/tournaments/components/tournament-form';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { tournamentSections } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turnier erstellen' };
export const dynamic = 'force-dynamic';

/**
 * Ein neues Turnier anlegen.
 *
 * Es entsteht als Entwurf: sichtbar nur für die Leitung, ohne Anmeldung und
 * ohne Discord-Ankündigung. Erst das Veröffentlichen macht daraus eine
 * Ausschreibung - und das prüft vorher, ob alles Nötige gesetzt ist.
 */
export default async function TurnierNeuPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.create);

  const [spiele, optionen] = await Promise.all([
    spielersuche.listGames({ includeDisabled: false }).catch(() => []),
    loadDiscordOptions(),
  ]);

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader
        title="Turnier erstellen"
        description="Grunddaten, Format und Zeitplan. Vieles lässt sich später ändern."
      />
      <TournamentForm
        csrfToken={csrfTokenFor(context)}
        werte={LEERE_WERTE}
        spiele={spiele.map((spiel) => ({ id: spiel.id, name: spiel.name }))}
        roles={optionen.roles}
        channels={optionen.channels}
      />
    </>
  );
}
