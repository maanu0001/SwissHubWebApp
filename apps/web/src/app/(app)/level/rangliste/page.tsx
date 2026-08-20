import type { Metadata } from 'next';
import { isModuleEnabled, level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Pagination } from '@/components/shared/pagination';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Rangliste' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const MEDALS = ['🥇', '🥈', '🥉'];

/** Rangliste des Servers - dieselbe Reihenfolge wie `/leaderboard`. */
export default async function LevelLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.leaderboardView);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState title="Modul deaktiviert" description="Das Level-System ist derzeit deaktiviert." />
      </>
    );
  }

  const params = await searchParams;
  const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1);
  const settings = await level.readLevelSettings();
  const board = await level.getLeaderboard({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    maxLevelTotalXp: settings.maxLevelTotalXp,
  });

  const totalPages = Math.max(1, Math.ceil(board.total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Rangliste"
        description="Nach XP sortiert. Bei Gleichstand zählt, wer den Stand zuerst erreicht hat."
      />
      {sections}

      <DataTable
        caption="Rangliste nach XP"
        rows={board.entries}
        getRowKey={(row) => row.discordId}
        emptyTitle="Noch keine Rangliste"
        emptyDescription="Sobald jemand XP sammelt, erscheint er hier."
        columns={[
          {
            key: 'rank',
            header: 'Platz',
            className: 'w-20',
            render: (row) => (
              <span className="tabular-nums">{MEDALS[row.rank - 1] ?? `${row.rank}.`}</span>
            ),
          },
          {
            key: 'member',
            header: 'Mitglied',
            render: (row) => (
              <div className="flex items-center gap-2">
                <DiscordAvatar
                  discordId={row.discordId}
                  avatarHash={row.avatarHash}
                  name={row.displayName ?? row.username ?? row.discordId}
                  size={28}
                />
                <span className="truncate text-sm font-medium">
                  {row.displayName ?? row.username ?? row.discordId}
                </span>
              </div>
            ),
          },
          {
            key: 'level',
            header: 'Level',
            render: (row) => <Badge variant="secondary">{row.level}</Badge>,
          },
          {
            key: 'xp',
            header: 'XP',
            render: (row) => (
              <span className="tabular-nums font-medium">{level.formatXp(row.xp)}</span>
            ),
          },
          {
            key: 'activity',
            header: 'Woher',
            render: (row) => (
              <span className="text-xs text-muted-foreground">
                {level.formatXp(row.messages)} Nachrichten · {level.formatXp(row.voiceMinutes)} Min Voice
              </span>
            ),
          },
        ]}
      />

      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={board.total}
          buildHref={(target) => `/level/rangliste?page=${target}`}
        />
      ) : null}
    </>
  );
}
