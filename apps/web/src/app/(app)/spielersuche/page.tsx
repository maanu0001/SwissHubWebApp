import type { Metadata } from 'next';
import Link from 'next/link';
import { Gamepad2, Plus, ScrollText, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { discord } from '@swisshub/discord';
import { isModuleEnabled, spielersuche } from '@swisshub/modules';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { MatchCard } from '@/modules/spielersuche/components/match-card';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { spielersucheSections } from '@/server/spielersuche';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Spielersuche' };
export const dynamic = 'force-dynamic';

/** Übersicht des Moduls: Kennzahlen, Schnellaktionen und laufende Suchen. */
export default async function SpielersuchePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.view);
  const sections = <SpielersucheSectionNav sections={spielersucheSections(context)} />;

  if (!(await isModuleEnabled(spielersuche.SPIELERSUCHE_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState title="Modul deaktiviert" description="Die Spielersuche ist derzeit deaktiviert." />
      </>
    );
  }

  const [overview, active, guild] = await Promise.all([
    spielersuche.getOverview(),
    spielersuche.listActiveSearchesWithParticipants(6),
    discord.guild.get().catch(() => null),
  ]);

  const figures = [
    { label: 'Aktive Suchen', value: overview.activeSearches },
    { label: 'Heute gestartet', value: overview.searchesToday },
    { label: 'Letzte 30 Tage', value: overview.searchesLast30Days },
    { label: 'Aktive Spieler', value: overview.activeParticipants },
    { label: 'Sprachkanäle', value: overview.activeVoiceChannels },
    { label: 'Spiele', value: overview.configuredGames },
  ];

  return (
    <>
      <PageHeader
        title="Spielersuche"
        description="Mitspieler finden, Gruppen füllen und Sprachkanäle automatisch verwalten."
      />
      {sections}

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {figures.map((figure) => (
          <div key={figure.label} className="rounded-lg border border-border bg-card/60 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{figure.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{figure.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        {can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.create) ? (
          <Link href="/spielersuche/neu" className={cn(buttonVariants())}>
            <Plus aria-hidden="true" />
            Neue Suche
          </Link>
        ) : null}
        {can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.gamesView) ? (
          <Link href="/spielersuche/spiele" className={cn(buttonVariants({ variant: 'outline' }))}>
            <Gamepad2 aria-hidden="true" />
            Spiele verwalten
          </Link>
        ) : null}
        <Link href="/spielersuche/verlauf" className={cn(buttonVariants({ variant: 'outline' }))}>
          <ScrollText aria-hidden="true" />
          Verlauf
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden="true" />
            Laufende Suchen
          </CardTitle>
          <CardDescription>
            {active.length === 0
              ? 'Momentan sucht niemand Mitspieler.'
              : `${overview.activeSearches} laufend - die neuesten sechs.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <EmptyState
              title="Keine aktive Suche"
              description="Sobald jemand /spielersuche nutzt oder hier eine Suche startet, erscheint sie an dieser Stelle."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {active.map((match) => (
                <MatchCard key={match.id} match={match} guildId={guild?.id ?? null} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {overview.activeSearches > active.length ? (
        <Link href="/spielersuche/aktiv" className="text-sm underline">
          Alle aktiven Suchen ansehen
        </Link>
      ) : null}
    </>
  );
}
