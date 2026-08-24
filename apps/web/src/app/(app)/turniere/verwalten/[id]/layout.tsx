import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { buttonVariants } from '@/components/ui/button';
import { DuplicateButton } from '@/modules/tournaments/components/duplicate-button';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { TournamentStatusBadge } from '@/modules/tournaments/components/tournament-badges';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff, turnierHref } from '@/server/tournaments';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Der Rahmen eines einzelnen Turniers.
 *
 * Prüft den Zugriff einmal für alle Unterseiten und baut daraus die Reiter:
 * wer keinen Check-in verwalten darf, sieht den Reiter nicht - und die Seite
 * dahinter prüft trotzdem noch einmal. Ein fehlender Reiter ist keine Sperre,
 * er ist Aufräumen.
 */
export default async function TurnierVerwaltungLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { tournament, zugriff } = await ladeTurnierMitZugriff(context, id);

  const reiter: Array<{ href: string; label: string }> = [
    { href: turnierHref(id), label: 'Leitstand' },
  ];
  if (zugriff.registrationsView) {
    reiter.push({ href: turnierHref(id, 'anmeldungen'), label: 'Anmeldungen' });
  }
  if (zugriff.registrationsView && tournament.mode === 'TEAM') {
    reiter.push({ href: turnierHref(id, 'teams'), label: 'Teams' });
  }
  if (zugriff.checkinManage) {
    reiter.push({ href: turnierHref(id, 'checkin'), label: 'Check-in' });
  }
  if (zugriff.bracketManage) {
    reiter.push({ href: turnierHref(id, 'bracket'), label: 'Bracket' });
  }
  if (zugriff.matchesManage) {
    reiter.push({ href: turnierHref(id, 'matches'), label: 'Matches' });
  }
  if (zugriff.prizesManage) {
    reiter.push({ href: turnierHref(id, 'preise'), label: 'Preise' });
  }
  if (zugriff.staffManage) {
    reiter.push({ href: turnierHref(id, 'leitung'), label: 'Leitung' });
  }
  if (zugriff.manage) {
    reiter.push({ href: turnierHref(id, 'bearbeiten'), label: 'Bearbeiten' });
  }
  reiter.push({ href: turnierHref(id, 'verlauf'), label: 'Verlauf' });

  return (
    <>
      <PageHeader
        title={tournament.name}
        description={`${tournament.game?.name ?? tournament.gameName} · ${tournament.slug}`}
        actions={
          <div className="flex items-center gap-2">
            <TournamentStatusBadge status={tournament.status} />
            {zugriff.manage ? (
              <DuplicateButton
                tournamentId={id}
                csrfToken={csrfTokenFor(context)}
                vorlage={tournament.name}
              />
            ) : null}
            <Link
              href={`/turniere/${tournament.slug}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <ExternalLink aria-hidden="true" />
              Öffentliche Seite
            </Link>
          </div>
        }
      />
      <TournamentSectionNav sections={reiter} />
      {children}
    </>
  );
}
