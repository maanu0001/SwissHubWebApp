import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { StatCard } from '@/components/shared/stat-card';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { CancelGameButton } from '@/modules/level/components/cancel-game-button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – XP-Spiele' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Wartet auf Antwort',
  RUNNING: 'Läuft',
  FINISHED: 'Beendet',
  DRAW: 'Unentschieden',
  DECLINED: 'Abgelehnt',
  TIMEOUT: 'Zeit abgelaufen',
  CANCELLED: 'Abgebrochen',
};

/** Laufende und beendete XP-Spiele. */
export default async function LevelGamesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.gamesView);
  const csrfToken = csrfTokenFor(context);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState title="Modul deaktiviert" description="Das Level-System ist derzeit deaktiviert." />
      </>
    );
  }

  const [settings, matches, boards] = await Promise.all([
    level.readLevelSettings(),
    level.listGameMatches({ limit: 50 }),
    level.getGameLeaderboards(5),
  ]);

  const canManage = can(context, level.LEVEL_PERMISSIONS.gamesManage);
  const running = matches.filter((match) => match.status === 'PENDING' || match.status === 'RUNNING');

  return (
    <>
      <PageHeader
        title="XP-Spiele"
        description="Einsätze werden beim Annehmen eingezogen und beim Abbruch zurückgegeben."
      />
      {sections}

      {!settings.gamesEnabled ? (
        <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
          Die XP-Spiele sind abgeschaltet. Bestehende Partien lassen sich noch abbrechen.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Laufende Partien" value={running.length} />
        <StatCard
          label="Auszahlung"
          value={`${Math.round(settings.gamePayoutFactor * 100)} %`}
          hint="Anteil beider Einsätze für den Gewinner"
        />
        <StatCard
          label="Einsatz"
          value={`${level.formatXp(settings.gameMinBet)}–${level.formatXp(settings.gameMaxBet)}`}
          hint="Kleinster bis grösster Einsatz"
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Letzte Partien</h3>
        <DataTable
          caption="XP-Spiele"
          rows={matches}
          getRowKey={(row) => row.id}
          emptyTitle="Noch keine Partie"
          emptyDescription="Sobald jemand ein XP-Spiel startet, erscheint es hier."
          columns={[
            {
              key: 'kind',
              header: 'Spiel',
              render: (row) => (
                <span className="text-sm font-medium">{level.GAME_LABELS[row.kind]}</span>
              ),
            },
            {
              key: 'players',
              header: 'Beteiligte',
              render: (row) => (
                <span className="font-mono text-xs text-muted-foreground">
                  {row.challengerDiscordId} vs. {row.opponentDiscordId}
                </span>
              ),
            },
            {
              key: 'bet',
              header: 'Einsatz',
              render: (row) => (
                <span className="tabular-nums">
                  {level.formatXp(row.bet)} → {level.formatXp(row.payout)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Stand',
              render: (row) => (
                <div className="space-y-1">
                  <Badge variant="secondary">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                  {row.winnerDiscordId ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      Gewinner {row.winnerDiscordId}
                    </p>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'created',
              header: 'Gestartet',
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {row.createdAt.toLocaleString('de-CH')}
                </span>
              ),
            },
            ...(canManage
              ? [
                  {
                    key: 'actions',
                    header: <span className="sr-only">Aktionen</span>,
                    className: 'w-28 text-right',
                    render: (row: (typeof matches)[number]) =>
                      row.finishedAt === null ? (
                        <CancelGameButton csrfToken={csrfToken} matchId={row.id} />
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Top-Spieler</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {boards.map((board) => (
            <div key={board.kind} className="rounded-xl border border-border bg-card/60 p-4">
              <p className="text-sm font-semibold">{level.GAME_LABELS[board.kind]}</p>
              {board.entries.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Noch kein Sieg.</p>
              ) : (
                <ol className="mt-2 space-y-1 text-xs">
                  {board.entries.map((entry, index) => (
                    <li key={entry.discordId} className="flex justify-between gap-2">
                      <span className="truncate">
                        {index + 1}. {entry.displayName ?? entry.username ?? entry.discordId}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{entry.wins}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
