import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { PrizeAdmin } from '@/modules/tournaments/components/prize-admin';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Preise' };
export const dynamic = 'force-dynamic';

/** Was es zu gewinnen gibt - und wer es bekommen hat. */
export default async function TurnierPreisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.asStaff) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst die Preise dieses Turniers nicht verwalten.',
    });
  }

  const preise = await tournaments.listPrizes(id);

  return (
    <PrizeAdmin
      tournamentId={id}
      csrfToken={csrfTokenFor(context)}
      darfVerwalten={zugriff.prizesManage}
      preise={preise.map((preis) => ({
        id: preis.id,
        placement: preis.placement,
        title: preis.title,
        description: preis.description,
        value: preis.value,
        sponsorName: preis.sponsorName,
        sponsorUrl: preis.sponsorUrl,
        status: preis.status,
        gewinner: preis.gewinner ? (preis.gewinner.team?.name ?? preis.gewinner.username ?? null) : null,
      }))}
    />
  );
}
