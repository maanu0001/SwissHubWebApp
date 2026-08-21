import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Ticket, Timer, Trophy, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import {
  RaffleStatusBadge,
  formatDateTime,
  formatNumber,
  formatXp,
} from '@/modules/level/components/raffle-shared';
import { requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – XP-Glücksrad' };
export const dynamic = 'force-dynamic';

/** Übersicht der Verlosungen. */
export default async function RaffleOverviewPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.raffleView);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState title="Modul deaktiviert" description="Das Level-System ist derzeit deaktiviert." />
      </>
    );
  }

  const [overview, list] = await Promise.all([
    level.raffle.getRaffleOverview(),
    level.raffle.listRaffles({ limit: 50 }),
  ]);
  const canCreate = can(context, level.LEVEL_PERMISSIONS.raffleCreate);

  return (
    <>
      <PageHeader
        title="XP-Glücksrad"
        description="Verlosungen, bei denen Mitglieder eigene XP als Einsatz verwenden."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/level/gluecksrad/neu">
                <Plus aria-hidden="true" />
                Neue Verlosung
              </Link>
            </Button>
          ) : null
        }
      />
      {sections}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aktive Verlosung"
          value={overview.active ? overview.active.title : '—'}
          hint={overview.active ? <RaffleStatusBadge status={overview.active.status} /> : 'Zurzeit läuft keine'}
          icon={<Ticket aria-hidden="true" />}
        />
        <StatCard
          label="Teilnehmende"
          value={formatNumber(overview.active?.entryCount ?? 0)}
          hint="In der aktiven Verlosung"
          icon={<Users aria-hidden="true" />}
        />
        <StatCard
          label="XP im Topf"
          value={formatXp(overview.active?.potXp ?? 0)}
          hint="Summe aller Einsätze"
          icon={<Trophy aria-hidden="true" />}
        />
        <StatCard
          label="Nächste Ziehung"
          value={overview.nextDrawAt ? formatDateTime(overview.nextDrawAt) : '—'}
          hint={`${formatNumber(overview.totalRaffles)} Verlosungen insgesamt`}
          icon={<Timer aria-hidden="true" />}
        />
      </div>

      {list.rows.length === 0 ? (
        <EmptyState
          title="Noch keine Verlosung"
          description={
            canCreate
              ? 'Lege eine Verlosung an, um Mitgliedern XP als Einsatz anzubieten.'
              : 'Sobald eine Verlosung angelegt wurde, erscheint sie hier.'
          }
        />
      ) : (
        <DataTable
          rows={list.rows}
          getRowKey={(row) => row.id}
          columns={[
            {
              key: 'title',
              header: 'Verlosung',
              render: (row) => (
                <div className="min-w-0">
                  <Link href={`/level/gluecksrad/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{row.prizeDescription}</p>
                </div>
              ),
            },
            { key: 'status', header: 'Status', render: (row) => <RaffleStatusBadge status={row.status} /> },
            {
              key: 'model',
              header: 'Einsatz',
              render: (row) => (
                <span className="text-sm text-muted-foreground">
                  {row.entryModel === 'FIXED' ? 'Festbetrag' : 'Anteil'}
                </span>
              ),
            },
            {
              key: 'entries',
              header: 'Teilnehmende',
              render: (row) => <span className="tabular-nums">{formatNumber(row.entryCount)}</span>,
            },
            {
              key: 'pot',
              header: 'XP-Topf',
              render: (row) => <span className="tabular-nums">{formatXp(row.potXp)}</span>,
            },
            {
              key: 'winner',
              header: 'Gewinner',
              render: (row) =>
                row.winnerDiscordId ? (
                  <span className="text-sm">{row.winnerDisplayName ?? row.winnerDiscordId}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                ),
            },
            {
              key: 'ends',
              header: 'Teilnahme bis',
              render: (row) => (
                <span className="text-sm text-muted-foreground">{formatDateTime(row.entryEndsAt)}</span>
              ),
            },
          ]}
        />
      )}

      {list.rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Der XP-Topf zeigt die Summe aller Einsätze. Er wird nicht automatisch an die gewinnende
          Person ausgezahlt – der Gewinn wird je Verlosung eigens festgelegt.
        </p>
      ) : null}
    </>
  );
}
