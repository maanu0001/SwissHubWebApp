import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Pagination } from '@/components/shared/pagination';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { AdjustXpDialog } from '@/modules/level/components/adjust-xp-dialog';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Mitglieder' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/** Mitgliederliste mit XP-Stand, Rang und Handbuchung. */
export default async function LevelMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.membersView);
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

  const params = await searchParams;
  const query = params.q?.trim() ?? '';
  const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1);
  const sort =
    params.sort === 'activity' || params.sort === 'messages' || params.sort === 'voice'
      ? params.sort
      : 'xp';

  const settings = await level.readLevelSettings();
  const result = await level.listLevelMembers({
    query,
    page,
    pageSize: PAGE_SIZE,
    sort,
    decayRules: level.decayRulesFrom(settings),
  });

  const canManage = can(context, level.LEVEL_PERMISSIONS.membersManage);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const buildHref = (target: number): string => {
    const search = new URLSearchParams();
    if (query) {
      search.set('q', query);
    }
    if (sort !== 'xp') {
      search.set('sort', sort);
    }
    search.set('page', String(target));
    return `/level/mitglieder?${search.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Mitglieder"
        description="XP-Stand, Level und Aktivität. Änderungen von Hand landen im Journal."
      />
      {sections}

      <form className="flex flex-wrap items-end gap-2" action="/level/mitglieder" method="get">
        <div className="min-w-56 flex-1">
          <Input name="q" defaultValue={query} placeholder="Name oder Discord-ID" aria-label="Suche" />
        </div>
        <input type="hidden" name="sort" value={sort} />
        <Button type="submit" variant="outline">
          Suchen
        </Button>
      </form>

      <DataTable
        caption="Mitglieder mit XP"
        rows={result.entries}
        getRowKey={(row) => row.discordId}
        emptyTitle="Keine Mitglieder gefunden"
        emptyDescription={
          query
            ? 'Zu dieser Suche gibt es keinen Treffer.'
            : 'Sobald jemand XP sammelt, erscheint er hier.'
        }
        columns={[
          {
            key: 'rank',
            header: '#',
            className: 'w-14',
            render: (row) => <span className="tabular-nums text-muted-foreground">{row.rank}</span>,
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
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.displayName ?? row.username ?? row.discordId}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{row.discordId}</p>
                </div>
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
            render: (row) => <span className="tabular-nums">{level.formatXp(row.xp)}</span>,
          },
          {
            key: 'activity',
            header: 'Aktivität',
            render: (row) => (
              <span className="text-xs text-muted-foreground">
                {level.formatXp(row.messages)} Nachrichten · {level.formatXp(row.voiceMinutes)} Min Voice
              </span>
            ),
          },
          {
            key: 'state',
            header: 'Zuletzt aktiv',
            render: (row) => (
              <div className="text-xs">
                <p className="text-muted-foreground">
                  {row.lastActivityAt ? row.lastActivityAt.toLocaleDateString('de-CH') : '—'}
                </p>
                {row.inDecay ? (
                  <Badge variant="secondary" className="mt-1">
                    Im Abzug
                  </Badge>
                ) : null}
              </div>
            ),
          },
          ...(canManage
            ? [
                {
                  key: 'actions',
                  header: <span className="sr-only">Aktionen</span>,
                  className: 'w-32 text-right',
                  render: (row: (typeof result.entries)[number]) => (
                    <AdjustXpDialog
                      csrfToken={csrfToken}
                      discordId={row.discordId}
                      name={row.displayName ?? row.username ?? row.discordId}
                      currentXp={row.xp}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      {totalPages > 1 ? (
        <Pagination page={page} totalPages={totalPages} total={result.total} buildHref={buildHref} />
      ) : null}
    </>
  );
}
