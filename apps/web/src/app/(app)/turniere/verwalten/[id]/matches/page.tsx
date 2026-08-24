import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { alsZeile, MatchAdminList } from '@/modules/tournaments/components/match-list';
import { requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Matches' };
export const dynamic = 'force-dynamic';

/** Alle Matches dieses Turniers. */
export default async function TurnierMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.asStaff) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst die Matches dieses Turniers nicht verwalten.',
    });
  }

  const matches = await tournaments.listMatches({ tournamentId: id, limit: 500 });

  return (
    <MatchAdminList
      matches={matches.map((match) => alsZeile(match))}
      leerTitel="Noch keine Matches"
      leerText="Sobald das Bracket steht, stehen hier die Matches."
    />
  );
}
