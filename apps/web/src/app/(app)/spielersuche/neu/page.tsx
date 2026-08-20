import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { spielersuche } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { CreateSearchForm } from '@/modules/spielersuche/components/create-search-form';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { spielersucheSections } from '@/server/spielersuche';

export const metadata: Metadata = { title: 'Neue Spielersuche' };
export const dynamic = 'force-dynamic';

/**
 * Neue Suche über das Dashboard.
 *
 * Dieselbe Engine wie `/spielersuche` auf Discord - Sprachkanal, Embed und
 * Rollen-Ping entstehen identisch.
 */
export default async function NewSearchPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.create);
  const csrfToken = csrfTokenFor(context);

  const [games, settings, options, active] = await Promise.all([
    spielersuche.listGames(),
    spielersuche.loadSpielersucheContext(),
    loadDiscordOptions(),
    spielersuche.getActiveSearchesForCreator(context.user.discordId),
  ]);

  const limitReached = active.length >= settings.settings.maxActiveSearchesPerUser;

  return (
    <>
      <PageHeader
        title="Neue Spielersuche"
        description="Startet dieselbe Suche wie /spielersuche auf Discord - inklusive Sprachkanal und Rollen-Ping."
      />
      <SpielersucheSectionNav sections={spielersucheSections(context)} />

      {limitReached ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Du hast bereits{' '}
            {active.length === 1 ? 'eine aktive Spielersuche' : `${active.length} aktive Spielersuchen`}.{' '}
            {active[0] ? (
              <Link href={`/spielersuche/${active[0].id}`} className="underline">
                Aktive Suche anzeigen
              </Link>
            ) : null}
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Suche starten</CardTitle>
          <CardDescription>
            Die Suche erscheint im konfigurierten Spielersuche-Channel und wird in deinem Namen erstellt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateSearchForm
            csrfToken={csrfToken}
            maxRequestedPlayers={settings.settings.maxRequestedPlayers}
            games={games.map((game) => ({
              id: game.id,
              name: game.name,
              maxSquadSize: game.maxSquadSize,
              roleName: options.roles.find((role) => role.id === game.roleId)?.name ?? null,
            }))}
          />
        </CardContent>
      </Card>
    </>
  );
}
