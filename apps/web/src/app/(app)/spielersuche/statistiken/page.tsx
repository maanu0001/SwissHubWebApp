import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';
import { can } from '@swisshub/auth';
import { spielersuche } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { spielersucheSections } from '@/server/spielersuche';

export const metadata: Metadata = { title: 'Spielersuche-Statistiken' };
export const dynamic = 'force-dynamic';

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

/**
 * Statistiken.
 *
 * Wer nur `stats.viewOwn` besitzt, sieht ausschliesslich die eigenen Zahlen.
 * Rangliste und Serverwerte brauchen `stats.viewAll`.
 */
export default async function StatsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.statsViewOwn);
  const canViewAll = can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.statsViewAll);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [own, ownLast30, overview, leaderboard, topGames, topCreators] = await Promise.all([
    spielersuche.getUserStats(context.user.discordId),
    spielersuche.getUserStats(context.user.discordId, since),
    canViewAll ? spielersuche.getOverview() : Promise.resolve(null),
    canViewAll ? spielersuche.getLeaderboard({ since, limit: 5 }) : Promise.resolve([]),
    canViewAll ? spielersuche.getTopGames(since, 5) : Promise.resolve([]),
    canViewAll ? spielersuche.getTopCreators(since, 5) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Statistiken"
        description="Voice-Zeit wird ausschliesslich in Sprachkanälen gemessen, die die Spielersuche selbst erstellt hat."
      />
      <SpielersucheSectionNav sections={spielersucheSections(context)} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DiscordAvatar
              discordId={context.user.discordId}
              avatarHash={context.user.avatarHash}
              name={context.user.username}
              size={28}
            />
            Deine Zahlen
          </CardTitle>
          <CardDescription>Gesamt und die letzten 30 Tage im Vergleich.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatBlock title="Gesamt" stats={own} />
            <StatBlock title="Letzte 30 Tage" stats={ownLast30} />
          </div>
        </CardContent>
      </Card>

      {canViewAll && overview ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Suchen heute" value={overview.searchesToday} />
            <Figure label="Letzte 7 Tage" value={overview.searchesLast7Days} />
            <Figure label="Letzte 30 Tage" value={overview.searchesLast30Days} />
            <Figure label="Gesamt" value={overview.totalSearches} />
            <Figure
              label="Voice-Zeit (30 Tage)"
              value={spielersuche.formatVoiceDuration(overview.voiceSecondsLast30Days)}
            />
            <Figure label="Ø Gruppengrösse" value={overview.averageGroupSize} />
            <Figure label="Completion Rate" value={`${overview.completionRate} %`} />
            <Figure label="Aktive Sprachkanäle" value={overview.activeVoiceChannels} />
          </dl>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="size-4" aria-hidden="true" />
                  Top 5 · letzte 30 Tage
                </CardTitle>
                <CardDescription>Nach gestarteten Suchen, bei Gleichstand nach Voice-Zeit.</CardDescription>
              </CardHeader>
              <CardContent>
                {leaderboard.length === 0 ? (
                  <EmptyState
                    title="Noch keine Daten"
                    description="In den letzten 30 Tagen wurde keine Suche gestartet."
                  />
                ) : (
                  <ol className="space-y-3">
                    {leaderboard.map((entry, index) => (
                      <li key={entry.discordId} className="flex items-center gap-3">
                        <span aria-hidden="true" className="w-6 text-center">
                          {MEDALS[index] ?? `${index + 1}.`}
                        </span>
                        <DiscordAvatar
                          discordId={entry.discordId}
                          avatarHash={entry.avatarHash}
                          name={entry.username ?? entry.discordId}
                          size={28}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {entry.username ?? entry.discordId}
                        </span>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {entry.usageCount}× · {spielersuche.formatVoiceDuration(entry.voiceSeconds)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Beliebteste Spiele</CardTitle>
                <CardDescription>Letzte 30 Tage.</CardDescription>
              </CardHeader>
              <CardContent>
                {topGames.length === 0 ? (
                  <EmptyState title="Noch keine Daten" />
                ) : (
                  <ol className="space-y-2 text-sm">
                    {topGames.map((game) => (
                      <li key={game.name} className="flex items-center justify-between gap-3">
                        <span className="truncate">{game.name}</span>
                        <span className="tabular-nums text-muted-foreground">{game.searches}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Aktivste Ersteller</CardTitle>
                <CardDescription>Letzte 30 Tage.</CardDescription>
              </CardHeader>
              <CardContent>
                {topCreators.length === 0 ? (
                  <EmptyState title="Noch keine Daten" />
                ) : (
                  <ol className="space-y-3">
                    {topCreators.map((creator) => (
                      <li key={creator.discordId} className="flex items-center gap-3">
                        <DiscordAvatar
                          discordId={creator.discordId}
                          avatarHash={creator.avatarHash}
                          name={creator.username ?? creator.discordId}
                          size={24}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {creator.username ?? creator.discordId}
                        </span>
                        <span className="tabular-nums text-xs text-muted-foreground">{creator.searches}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function StatBlock({ title, stats }: { title: string; stats: spielersuche.UserStats }): React.JSX.Element {
  const rows = [
    { label: 'Suchen gestartet', value: `${stats.usageCount}×` },
    { label: 'Teilnahmen bei anderen', value: String(stats.joinedSearches) },
    { label: 'Voice-Zeit', value: spielersuche.formatVoiceDuration(stats.voiceSeconds) },
    { label: 'Voice-Sessions', value: String(stats.voiceSessions) },
  ];

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
