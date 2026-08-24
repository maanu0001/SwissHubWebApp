import type { Metadata } from 'next';
import { AlertTriangle, Gamepad2, Swords, Trophy, UserCheck, Users } from 'lucide-react';
import { tournaments } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { StatCard } from '@/components/shared/stat-card';
import { TournamentSectionNav } from '@/modules/tournaments/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { tournamentSections } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turnier-Statistiken' };
export const dynamic = 'force-dynamic';

/**
 * Kennzahlen über alle Turniere.
 *
 * Nur echte Zahlen. Wo nichts gemessen wurde, steht ein Strich - eine
 * erfundene Quote wäre schlimmer als gar keine, weil man sich auf sie
 * verliesse.
 */
export default async function TurnierStatistikenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.statsView);
  const stats = await tournaments.getTournamentStats();

  return (
    <>
      <TournamentSectionNav sections={tournamentSections(context)} />
      <PageHeader title="Statistiken" description="Kennzahlen über alle Turniere dieses Servers." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Turniere"
          value={stats.gesamt}
          hint={`${stats.aktiv} aktiv · ${stats.abgeschlossen} abgeschlossen`}
          icon={<Trophy className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="Teilnehmer"
          value={stats.teilnehmerGesamt}
          hint={`${stats.teamsGesamt} Teams`}
          icon={<Users className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="Matches"
          value={stats.matchesGesamt}
          hint={`${stats.forfeits} Forfait · ${stats.noShows} nicht angetreten`}
          icon={<Swords className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="Einsprüche"
          value={stats.einspruecheGesamt}
          hint={`${stats.einspruecheOffen} offen`}
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          tone={stats.einspruecheOffen > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Check-in-Quote"
          value={stats.checkinQuote === null ? '–' : `${stats.checkinQuote}%`}
          hint={
            stats.checkinQuote === null
              ? 'Noch kein Check-in verlangt'
              : 'Eingecheckt unter den Bestätigten'
          }
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="Abschlussquote"
          value={stats.abschlussQuote === null ? '–' : `${stats.abschlussQuote}%`}
          hint={
            stats.abschlussQuote === null
              ? 'Noch kein Turnier gestartet'
              : 'Abgeschlossen unter den gestarteten'
          }
          icon={<Trophy className="size-4" aria-hidden="true" />}
        />
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gamepad2 className="size-4" aria-hidden="true" />
          Meistgespielt
        </h2>
        {stats.beliebtesteSpiele.length === 0 ? (
          <EmptyState title="Noch keine Turniere" />
        ) : (
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {stats.beliebtesteSpiele.map((spiel, index) => (
              <li key={spiel.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{spiel.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {spiel.anzahl} {spiel.anzahl === 1 ? 'Turnier' : 'Turniere'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
