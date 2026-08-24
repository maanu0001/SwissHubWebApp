import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { CheckinAdmin } from '@/modules/tournaments/components/checkin-admin';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Check-in' };
export const dynamic = 'force-dynamic';

/** Wer antritt - und wer noch fehlt. */
export default async function TurnierCheckinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { tournament, zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.checkinManage && !zugriff.registrationsView) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst den Check-in dieses Turniers nicht sehen.',
    });
  }

  const [uebersicht, zeilen] = await Promise.all([
    tournaments.getCheckinOverview(id),
    prisma.tournamentRegistration.findMany({
      where: { tournamentId: id, status: 'CONFIRMED' },
      orderBy: [{ checkinStatus: 'asc' }, { createdAt: 'asc' }],
      include: { team: { select: { name: true } } },
    }),
  ]);

  return (
    <CheckinAdmin
      tournamentId={id}
      csrfToken={csrfTokenFor(context)}
      uebersicht={uebersicht}
      darfVerwalten={zugriff.checkinManage}
      autoEntfernen={tournament.autoRemoveMissedCheckin}
      offen={tournament.status === 'CHECKIN_OPEN'}
      zeilen={zeilen.map((eintrag) => ({
        id: eintrag.id,
        discordId: eintrag.discordId,
        username: eintrag.username,
        teamName: eintrag.team?.name ?? null,
        checkinStatus: eintrag.checkinStatus,
      }))}
    />
  );
}
