import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { RegistrationAdmin } from '@/modules/tournaments/components/registration-admin';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Anmeldungen' };
export const dynamic = 'force-dynamic';

/**
 * Die Anmeldungen eines Turniers.
 *
 * Auch die Antworten auf die Zusatzfragen stehen hier - sie sind der Grund,
 * warum es die Fragen gibt, und ohne sie müsste die Leitung sie anderswo
 * nachschlagen.
 */
export default async function TurnierAnmeldungenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { tournament, zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.registrationsView) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst die Anmeldungen dieses Turniers nicht sehen.',
    });
  }

  const anmeldungen = await prisma.tournamentRegistration.findMany({
    where: { tournamentId: id },
    orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    include: {
      team: { select: { name: true } },
      responses: { include: { field: { select: { label: true, sortOrder: true } } } },
    },
  });

  return (
    <RegistrationAdmin
      tournamentId={id}
      csrfToken={csrfTokenFor(context)}
      darfVerwalten={zugriff.registrationsManage}
      wartelisteVorhanden={
        tournament.maxParticipants > 0 &&
        anmeldungen.some((eintrag) => eintrag.status === 'WAITLISTED')
      }
      anmeldungen={anmeldungen.map((eintrag) => ({
        id: eintrag.id,
        discordId: eintrag.discordId,
        username: eintrag.username,
        teamName: eintrag.team?.name ?? null,
        status: eintrag.status,
        checkinStatus: eintrag.checkinStatus,
        waitlistPosition: eintrag.waitlistPosition,
        createdAt: eintrag.createdAt.toISOString(),
        reason: eintrag.reason,
        antworten: eintrag.responses
          .slice()
          .sort((a, b) => a.field.sortOrder - b.field.sortOrder)
          .map((antwort) => ({ label: antwort.field.label, wert: antwort.value })),
      }))}
    />
  );
}
