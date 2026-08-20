import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { spielersuche } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { RoleBadge } from '@/components/shared/role-badge';
import { DeleteGameButton, EditGameTrigger, GameDialog } from '@/modules/spielersuche/components/game-dialog';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { spielersucheSections } from '@/server/spielersuche';
import type { SpielersucheGame } from '@swisshub/database';

export const metadata: Metadata = { title: 'Spiele' };
export const dynamic = 'force-dynamic';

/** Spieleverwaltung - ersetzt `/spielersucheadmin game-add` und `game-remove`. */
export default async function GamesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.gamesView);
  const csrfToken = csrfTokenFor(context);
  const canManage = can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.gamesManage);

  const [games, usage, options] = await Promise.all([
    spielersuche.listGames({ includeDisabled: true }),
    spielersuche.getGameUsage(),
    loadDiscordOptions(),
  ]);

  const roles = options.roles.map((role) => ({
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
  }));

  const roleOf = (roleId: string): { name: string; color: number } | null => {
    const role = options.roles.find((entry) => entry.id === roleId);
    return role ? { name: role.name, color: role.color } : null;
  };

  return (
    <>
      <PageHeader
        title="Spiele"
        description="Diese Spiele stehen in /spielersuche zur Auswahl - Änderungen wirken sofort."
        actions={canManage ? <GameDialog csrfToken={csrfToken} roles={roles} /> : undefined}
      />
      <SpielersucheSectionNav sections={spielersucheSections(context)} />

      <DataTable
        rows={games}
        getRowKey={(game: SpielersucheGame) => game.id}
        emptyTitle="Noch kein Spiel"
        emptyDescription="Ohne Spiel hat /spielersuche nichts zur Auswahl."
        columns={[
          {
            key: 'name',
            header: 'Spiel',
            render: (game: SpielersucheGame) => (
              <span className="flex items-center gap-2">
                <span className="font-medium">{game.name}</span>
                {game.enabled ? null : <Badge variant="outline">Deaktiviert</Badge>}
              </span>
            ),
          },
          {
            key: 'role',
            header: 'Rolle',
            render: (game: SpielersucheGame) => {
              const role = roleOf(game.roleId);
              return role ? (
                <RoleBadge name={role.name} color={role.color} />
              ) : (
                <span className="text-xs text-warning">
                  Rolle fehlt&nbsp;
                  <span className="font-mono text-muted-foreground">{game.roleId}</span>
                </span>
              );
            },
          },
          {
            key: 'squad',
            header: 'Gruppe',
            render: (game: SpielersucheGame) => (
              <span className="whitespace-nowrap text-muted-foreground">
                {game.maxSquadSize ? `max. ${game.maxSquadSize}` : 'unbegrenzt'}
              </span>
            ),
          },
          {
            key: 'banner',
            header: 'Banner',
            render: (game: SpielersucheGame) =>
              game.bannerUrl ? (
                // Kein `next/image`: die Adresse ist frei konfigurierbar und
                // müsste sonst je Host freigeschaltet werden.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={game.bannerUrl} alt="" className="h-8 w-14 rounded object-cover" loading="lazy" />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
          {
            key: 'usage',
            header: 'Suchen',
            render: (game: SpielersucheGame) => {
              const stats = usage.get(game.id);
              return (
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {stats?.searches ?? 0}
                </span>
              );
            },
          },
          {
            key: 'last',
            header: 'Zuletzt genutzt',
            render: (game: SpielersucheGame) => {
              const stats = usage.get(game.id);
              return (
                <span className="whitespace-nowrap text-muted-foreground">
                  {stats?.lastUsedAt ? formatDateTime(stats.lastUsedAt) : '—'}
                </span>
              );
            },
          },
          ...(canManage
            ? [
                {
                  key: 'actions',
                  header: <span className="sr-only">Aktionen</span>,
                  className: 'text-right',
                  render: (game: SpielersucheGame) => (
                    <span className="flex justify-end gap-1">
                      <GameDialog
                        csrfToken={csrfToken}
                        roles={roles}
                        trigger={<EditGameTrigger />}
                        game={{
                          id: game.id,
                          name: game.name,
                          roleId: game.roleId,
                          bannerUrl: game.bannerUrl ?? '',
                          maxSquadSize: game.maxSquadSize ? String(game.maxSquadSize) : '',
                          enabled: game.enabled,
                        }}
                      />
                      <DeleteGameButton csrfToken={csrfToken} gameId={game.id} name={game.name} />
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
