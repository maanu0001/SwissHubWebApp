import type { Metadata } from 'next';
import Link from 'next/link';
import { spielersuche } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Pagination } from '@/components/shared/pagination';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { STATUS_LABEL } from '@/modules/spielersuche/components/match-card';
import { requirePagePermission } from '@/server/auth';
import { spielersucheSections } from '@/server/spielersuche';

export const metadata: Metadata = { title: 'Spielersuche-Verlauf' };
export const dynamic = 'force-dynamic';

/** Zeile der Verlaufstabelle - der Typ kommt aus der Modulabfrage. */
type HistoryRow = Awaited<ReturnType<typeof spielersuche.listSearches>>['items'][number];

/** Beendete und abgelaufene Suchen - die Historie bleibt vollständig. */
export default async function SearchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; gameId?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.view);
  const params = await searchParams;
  const query = spielersuche.searchListQuerySchema.parse({
    tab: 'history',
    page: params.page ?? '1',
    search: params.search,
    gameId: params.gameId,
  });

  const [result, games] = await Promise.all([
    spielersuche.listSearches(query),
    spielersuche.listGames({ includeDisabled: true }),
  ]);

  const buildHref = (page: number): string => {
    const search = new URLSearchParams();
    if (page > 1) {
      search.set('page', String(page));
    }
    if (query.search) {
      search.set('search', query.search);
    }
    if (query.gameId) {
      search.set('gameId', query.gameId);
    }
    const suffix = search.toString();
    return suffix ? `/spielersuche/verlauf?${suffix}` : '/spielersuche/verlauf';
  };

  return (
    <>
      <PageHeader
        title="Verlauf"
        description={`${result.total} beendete ${result.total === 1 ? 'Suche' : 'Suchen'}.`}
        actions={
          <form className="flex gap-2" action="/spielersuche/verlauf">
            <Input
              name="search"
              defaultValue={query.search ?? ''}
              placeholder="Spiel oder Ersteller"
              className="w-56"
              aria-label="Verlauf durchsuchen"
            />
            <select
              name="gameId"
              defaultValue={query.gameId ?? ''}
              aria-label="Nach Spiel filtern"
              className="h-10 rounded-md border border-border bg-card px-3 text-sm"
            >
              <option value="">Alle Spiele</option>
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </form>
        }
      />

      <SpielersucheSectionNav sections={spielersucheSections(context)} />

      <DataTable
        rows={result.items}
        getRowKey={(match: HistoryRow) => match.id}
        emptyTitle="Noch keine beendeten Suchen"
        columns={[
          {
            key: 'game',
            header: 'Spiel',
            render: (match: HistoryRow) => (
              <Link href={`/spielersuche/${match.id}`} className="font-medium hover:underline">
                {match.gameName}
              </Link>
            ),
          },
          {
            key: 'creator',
            header: 'Ersteller',
            render: (match: HistoryRow) => (
              <span className="flex items-center gap-2">
                <DiscordAvatar
                  discordId={match.creatorDiscordId}
                  avatarHash={match.creatorAvatarHash}
                  name={match.creatorUsername}
                  size={24}
                />
                <span className="truncate">{match.creatorDisplayName ?? match.creatorUsername}</span>
              </span>
            ),
          },
          {
            key: 'participants',
            header: 'Teilnehmer',
            render: (match: HistoryRow) => (
              <span className="tabular-nums">
                {match.participants.length}/{match.requestedPlayers + 1}
              </span>
            ),
          },
          {
            key: 'created',
            header: 'Gestartet',
            render: (match: HistoryRow) => (
              <span className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(match.createdAt)}
              </span>
            ),
          },
          {
            key: 'duration',
            header: 'Aktiv',
            render: (match: HistoryRow) => (
              <span className="whitespace-nowrap text-muted-foreground">{formatActiveDuration(match)}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (match: HistoryRow) => {
              const status = STATUS_LABEL[match.status] ?? STATUS_LABEL.CLOSED!;
              return <Badge variant={status.variant}>{status.label}</Badge>;
            },
          },
        ]}
      />

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        buildHref={buildHref}
      />
    </>
  );
}

/** "2h 18m" - wie lange die Suche offen war. */
function formatActiveDuration(match: { createdAt: Date; closedAt: Date | null }): string {
  const end = match.closedAt ?? new Date();
  const minutes = Math.max(0, Math.round((end.getTime() - match.createdAt.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
