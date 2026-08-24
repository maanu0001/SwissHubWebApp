import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { TournamentBlockManager } from '@/modules/tournaments/components/block-manager';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { tournamentSections } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turniersperren' };
export const dynamic = 'force-dynamic';

/** Wer sich zu keinem Turnier mehr anmelden darf. */
export default async function TurnierSperrenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.blockManage);
  const sperren = await tournaments.listBlocks();

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader
        title="Turniersperren"
        description="Eine Sperre verhindert neue Anmeldungen. Laufende Turniere bleiben unberührt."
      />
      <TournamentBlockManager
        csrfToken={csrfTokenFor(context)}
        sperren={sperren.map((sperre) => ({
          id: sperre.id,
          discordId: sperre.discordId,
          username: sperre.username,
          reason: sperre.reason,
          createdAt: sperre.createdAt.toISOString(),
          expiresAt: sperre.expiresAt?.toISOString() ?? null,
          liftedAt: sperre.liftedAt?.toISOString() ?? null,
          aktiv: sperre.aktiv,
        }))}
      />
    </>
  );
}
