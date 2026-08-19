import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { getCoreSettings, searchMembers } from '@swisshub/modules';
import { sanitizeText, toAppError } from '@swisshub/shared';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
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
});

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission('members.view');
  const params = querySchema.parse(await searchParams);
  const settings = await getCoreSettings();

  let members: Awaited<ReturnType<typeof searchMembers>> = [];
  let error: string | null = null;

  try {
    await enforceRateLimit('memberSearch', context.user.discordId);
    members = await searchMembers(params.q, { limit: settings.memberSearchLimit });
  } catch (caught) {
    error = toAppError(caught).userMessage;
  }

  return (
    <>
      <PageHeader
        title="Mitglieder"
        description="Mitglieder des SwissHub Discord-Servers suchen und einsehen."
      />

      <form role="search" className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
      </form>

      {error ? (
        <ErrorState title="Suche nicht moeglich" description={error} />
      ) : members.length === 0 ? (
        <EmptyState
          title={params.q ? 'Keine Treffer' : 'Keine Mitglieder gefunden'}
          description={
            params.q
              ? 'Fuer diese Suche wurden keine Mitglieder gefunden.'
              : 'Gib einen Suchbegriff ein, um Mitglieder zu finden.'
          }
        />
      ) : (
        <section aria-label="Suchergebnisse" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => (
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
      )}
    </>
  );
}
