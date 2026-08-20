import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { discord } from '@swisshub/discord';
import { spielersuche } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { CloseSearchButton } from '@/modules/spielersuche/components/close-search-button';
import { MatchCard } from '@/modules/spielersuche/components/match-card';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { spielersucheSections } from '@/server/spielersuche';

export const metadata: Metadata = { title: 'Aktive Suchen' };
export const dynamic = 'force-dynamic';

/** Alle laufenden Suchen mit Schnellaktionen. */
export default async function ActiveSearchesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);

  const [matches, guild] = await Promise.all([
    spielersuche.listActiveSearchesWithParticipants(100),
    discord.guild.get().catch(() => null),
  ]);

  const canCloseAny = can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.closeAny);
  const canCloseOwn = can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.closeOwn);

  return (
    <>
      <PageHeader
        title="Aktive Suchen"
        description={`${matches.length} laufende ${matches.length === 1 ? 'Suche' : 'Suchen'}.`}
      />
      <SpielersucheSectionNav sections={spielersucheSections(context)} />

      {matches.length === 0 ? (
        <EmptyState title="Keine aktive Suche" description="Momentan sucht niemand Mitspieler." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((match) => {
            const mayClose =
              canCloseAny || (canCloseOwn && match.creatorDiscordId === context.user.discordId);
            return (
              <div key={match.id} className="flex flex-col gap-2">
                <MatchCard match={match} guildId={guild?.id ?? null} />
                {mayClose ? <CloseSearchButton csrfToken={csrfToken} matchId={match.id} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
