import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { TeamAdmin } from '@/modules/tournaments/components/team-admin';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Teams' };
export const dynamic = 'force-dynamic';

/** Die Teams eines Turniers - mit Roster und Zustand. */
export default async function TurnierTeamsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { tournament, zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.registrationsView) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst die Teams dieses Turniers nicht sehen.',
    });
  }

  const teams = await prisma.tournamentTeam.findMany({
    where: { tournamentId: id },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      members: { where: { removedAt: null }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] },
      registration: { select: { id: true } },
    },
  });

  return (
    <TeamAdmin
      csrfToken={csrfTokenFor(context)}
      darfVerwalten={zugriff.teamsManage}
      teams={teams.map((team) => ({
        id: team.id,
        name: team.name,
        tag: team.tag,
        captainUsername: team.captainUsername,
        status: team.status,
        rosterOffen: tournaments.rosterOffen(tournament, team),
        angemeldet: team.registration !== null,
        mitglieder: team.members.map((mitglied) => ({
          username: mitglied.username,
          role: mitglied.role,
        })),
      }))}
    />
  );
}
