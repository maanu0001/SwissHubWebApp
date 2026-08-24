import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import {
  StaffAdmin,
  type StaffRolle,
} from '@/modules/tournaments/components/staff-admin';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turnierleitung' };
export const dynamic = 'force-dynamic';

/** Wer dieses Turnier betreut - und in welcher Rolle. */
export default async function TurnierLeitungPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.asStaff) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst die Leitung dieses Turniers nicht sehen.',
    });
  }

  const staff = await tournaments.listStaff(id);

  return (
    <StaffAdmin
      tournamentId={id}
      csrfToken={csrfTokenFor(context)}
      darfVerwalten={zugriff.staffManage}
      staff={staff.map((eintrag) => ({
        discordId: eintrag.discordId,
        username: eintrag.username,
        role: eintrag.role as StaffRolle,
      }))}
    />
  );
}
