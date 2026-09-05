import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { getCoreSettings, listMembersPage } from '@swisshub/modules';
import { discord } from '@swisshub/discord';
import { sanitizeText, toAppError } from '@swisshub/shared';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
import { MemberCard } from '@/components/shared/member-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mitglieder' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 100) : '')),
  rolle: z.string().max(20).optional(),
  status: z.enum(['alle', 'jail', 'premium']).optional().default('alle'),
  bots: z.enum(['an', 'aus']).optional().default('aus'),
  seite: z.coerce.number().int().min(1).max(50).optional().default(1),
});

/**
 * Die Mitgliederliste des Member Center.
 *
 * Gesucht, gefiltert und geblaettert wird serverseitig. Der Browser bekommt
 * eine Seite - nie die Mitgliederliste des Servers.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission('members.view');
  const params = querySchema.parse(await searchParams);
  const settings = await getCoreSettings();

  let seite: Awaited<ReturnType<typeof listMembersPage>> = {
    members: [],
    total: 0,
    page: params.seite,
    pageSize: 24,
  };
  let rollen: Array<{ id: string; name: string }> = [];
  let error: string | null = null;

  try {
    await enforceRateLimit('memberSearch', context.user.discordId);
    [seite, rollen] = await Promise.all([
      listMembersPage(
        params.q,
        {
          roleId: params.rolle && params.rolle !== 'alle' ? params.rolle : null,
          jailed: params.status === 'jail',
          premium: params.status === 'premium',
          ohneBots: params.bots === 'aus',
        },
        { page: params.seite, pageSize: 24 },
      ),
      // Nur fuer die Auswahlliste. Faellt sie aus, bleibt die Suche nutzbar.
      discord.roles
        .list()
        .then((liste) =>
          liste
            .filter((rolle) => rolle.position > 0)
            .sort((a, b) => b.position - a.position)
            .map((rolle) => ({ id: rolle.id, name: rolle.name })),
        )
        .catch(() => []),
    ]);
  } catch (caught) {
    error = toAppError(caught).userMessage;
  }

  const seiten = Math.max(1, Math.ceil(seite.total / seite.pageSize));
  const link = (aenderung: Record<string, string | number>): string => {
    const suche = new URLSearchParams();
    if (params.q) suche.set('q', params.q);
    if (params.rolle && params.rolle !== 'alle') suche.set('rolle', params.rolle);
    if (params.status !== 'alle') suche.set('status', params.status);
    if (params.bots !== 'aus') suche.set('bots', params.bots);
    for (const [schluessel, wert] of Object.entries(aenderung)) {
      suche.set(schluessel, String(wert));
    }
    return `/members?${suche.toString()}`;
  };

  return (
    <>
      <form role="search" className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              name="q"
              defaultValue={params.q}
              placeholder="Username, Anzeigename oder Discord ID"
              aria-label="Mitglieder suchen"
              className="pl-9"
            />
          </div>
          <button type="submit" className={cn(buttonVariants({ variant: 'default' }))}>
            Suchen
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="filter-rolle">
            Nach Rolle filtern
          </label>
          <select
            id="filter-rolle"
            name="rolle"
            defaultValue={params.rolle ?? 'alle'}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="alle">Alle Rollen</option>
            {rollen.map((rolle) => (
              <option key={rolle.id} value={rolle.id}>
                {rolle.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="filter-status">
            Nach Status filtern
          </label>
          <select
            id="filter-status"
            name="status"
            defaultValue={params.status}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="alle">Alle</option>
            <option value="jail">Im Jail</option>
            <option value="premium">Mit Premium</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="bots"
              value="an"
              defaultChecked={params.bots === 'an'}
              className="size-4 rounded border-border"
            />
            Bots anzeigen
          </label>
        </div>
      </form>

      {error ? (
        <ErrorState title="Suche nicht möglich" description={error} />
      ) : seite.members.length === 0 ? (
        <EmptyState
          title={params.q ? 'Keine Treffer' : 'Keine Mitglieder gefunden'}
          description={
            params.q
              ? 'Für diese Suche wurden keine Mitglieder gefunden.'
              : 'Gib einen Suchbegriff ein oder wähle einen Filter.'
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {seite.total} {seite.total === 1 ? 'Mitglied' : 'Mitglieder'}
            {seiten > 1 ? ` · Seite ${seite.page} von ${seiten}` : ''}
          </p>

          <section aria-label="Suchergebnisse" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {seite.members.map((member) => (
              <MemberCard
                key={member.discordId}
                member={{
                  discordId: member.discordId,
                  username: member.username,
                  displayName: member.displayName,
                  avatarHash: member.avatarHash,
                  isBot: member.isBot,
                  roles: member.roles,
                  joinedAt: member.joinedAt,
                  accountCreatedAt: member.accountCreatedAt,
                  jailed: member.activeJail !== null,
                  timedOut: member.timedOut,
                  showDiscordId: settings.showDiscordIds,
                }}
              />
            ))}
          </section>

          {seiten > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="Seiten">
              {seite.page > 1 ? (
                <Link
                  href={link({ seite: seite.page - 1 })}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  Zurück
                </Link>
              ) : (
                <span />
              )}
              {seite.page < seiten ? (
                <Link
                  href={link({ seite: seite.page + 1 })}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  Weiter
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
