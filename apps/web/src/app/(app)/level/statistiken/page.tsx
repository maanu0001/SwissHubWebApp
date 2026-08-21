import type { Metadata } from 'next';
import { isModuleEnabled, level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { DataTable } from '@/components/shared/data-table';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Statistiken' };
export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<string, string> = {
  MESSAGE: 'Nachrichten',
  VOICE: 'Voice',
  GAME_WIN: 'Spiel gewonnen',
  GAME_LOSS: 'Spiel verloren',
  GAME_STAKE: 'Einsätze',
  GAME_REFUND: 'Einsätze zurück',
  ADMIN: 'Von Hand',
  DECAY: 'Inaktivität',
  BOOST: 'Boost',
  MIGRATION: 'Altdaten',
  SYSTEM: 'System',
};

/**
 * Auswertungen über XP, Level und Herkunft.
 *
 * Erst durch das Journal überhaupt möglich - der alte Bot speicherte nur den
 * jeweils aktuellen Stand.
 */
export default async function LevelStatsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.statsView);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState title="Modul deaktiviert" description="Das Level-System ist derzeit deaktiviert." />
      </>
    );
  }

  const settings = await level.readLevelSettings();
  const [stats, trend, journal, raffleStats] = await Promise.all([
    level.getGlobalStats({ maxLevelTotalXp: settings.maxLevelTotalXp }),
    level.getXpTrend(30),
    level.listXpTransactions({ limit: 25 }),
    level.raffle.getRaffleStats(),
  ]);

  const maxDay = Math.max(1, ...trend.map((point) => point.gained));
  const maxLevelMembers = Math.max(1, ...stats.levelDistribution.map((entry) => entry.members));

  return (
    <>
      <PageHeader
        title="Statistiken"
        description="Woher die XP auf dem Server kommt und wie sie sich über die Level verteilt."
      />
      {sections}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Mitglieder mit XP" value={level.formatXp(stats.active)} />
        <StatCard label="XP insgesamt" value={level.formatXp(stats.totalXp)} />
        <StatCard label="XP im Schnitt" value={level.formatXp(stats.averageXp)} />
        <StatCard label="Höchstes Level" value={stats.highestLevel} />
      </div>

      {raffleStats.totalRaffles > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">XP-Verlosungen</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Verlosungen"
              value={raffleStats.totalRaffles.toString()}
              hint={`${raffleStats.completedRaffles} abgeschlossen`}
            />
            <StatCard
              label="Teilnahmen"
              value={raffleStats.totalEntries.toString()}
              hint={`${raffleStats.uniqueParticipants} verschiedene Mitglieder`}
            />
            <StatCard
              label="Eingesetzte XP"
              value={level.formatXp(raffleStats.totalEntryXp)}
              hint={`im Schnitt ${level.formatXp(raffleStats.averageEntryXp)} je Teilnahme`}
            />
            <StatCard
              label="Einsatzmodelle"
              value={`${raffleStats.fixedRaffles} / ${raffleStats.percentageRaffles}`}
              hint="Festbetrag / Anteil"
            />
          </div>
          {raffleStats.refundedXp > 0 ? (
            <p className="text-xs text-muted-foreground">
              {level.formatXp(raffleStats.refundedXp)} wurden zurückgezahlt – aus abgebrochenen Verlosungen
              und entfernten Teilnahmen.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Ausgewertet wird nur, was seit der Einführung stattgefunden hat.
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">XP der letzten 30 Tage</h3>
        {trend.length === 0 ? (
          <p className="text-sm text-muted-foreground">Es gibt noch keine Buchungen.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <ul className="flex h-40 items-end gap-1" aria-label="XP je Tag">
              {trend.map((point) => (
                <li
                  key={point.day}
                  className="flex-1"
                  title={`${point.day}: +${point.gained} XP, −${point.lost} XP`}
                >
                  <div
                    className="rounded-t bg-primary/70"
                    style={{ height: `${Math.max(2, Math.round((point.gained / maxDay) * 100))}%` }}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {trend[0]?.day} bis {trend.at(-1)?.day} · höchster Tag {level.formatXp(maxDay)} XP
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Verteilung über die Level</h3>
        {stats.levelDistribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">Es gibt noch keine Level.</p>
        ) : (
          <div className="space-y-1.5 rounded-xl border border-border bg-card/60 p-4">
            {stats.levelDistribution.map((entry) => (
              <div key={entry.level} className="flex items-center gap-3 text-xs">
                <span className="w-14 shrink-0 tabular-nums text-muted-foreground">Level {entry.level}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.round((entry.members / maxLevelMembers) * 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right tabular-nums">{entry.members}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Letzte Buchungen</h3>
        <DataTable
          caption="XP-Journal"
          rows={journal.entries}
          getRowKey={(row) => row.id}
          emptyTitle="Noch keine Buchungen"
          columns={[
            {
              key: 'created',
              header: 'Zeitpunkt',
              render: (row) => (
                <span className="text-xs text-muted-foreground">{row.createdAt.toLocaleString('de-CH')}</span>
              ),
            },
            {
              key: 'member',
              header: 'Mitglied',
              render: (row) => <span className="font-mono text-xs">{row.discordId}</span>,
            },
            {
              key: 'source',
              header: 'Quelle',
              render: (row) => <span className="text-sm">{SOURCE_LABELS[row.source] ?? row.source}</span>,
            },
            {
              key: 'delta',
              header: 'Änderung',
              render: (row) => (
                <span
                  className={row.delta >= 0 ? 'tabular-nums text-success' : 'tabular-nums text-destructive'}
                >
                  {row.delta >= 0 ? '+' : '−'}
                  {level.formatXp(Math.abs(row.delta))}
                </span>
              ),
            },
            {
              key: 'result',
              header: 'Neuer Stand',
              render: (row) => (
                <span className="tabular-nums text-sm">
                  {level.formatXp(row.xpAfter)} · Level {row.levelAfter}
                </span>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
