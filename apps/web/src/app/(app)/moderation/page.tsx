import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { prisma } from '@swisshub/database';
import { formatDateTime, paginate, sanitizeText, toSkipTake } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/shared/data-table';
import { Pagination } from '@/components/shared/pagination';
import { StatusBadge } from '@/components/shared/status-badge';
import { requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';
import type { ModerationAction, Prisma } from '@swisshub/database';

export const metadata: Metadata = { title: 'Moderation' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  search: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const TYPE_LABEL: Record<string, string> = {
  JAIL_CREATE: 'Jail erstellt',
  JAIL_RELEASE: 'Jail beendet',
  JAIL_EXTEND: 'Jail angepasst',
};

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}): Promise<React.JSX.Element> {
  await requirePagePermission('moderation.view');
  const query = querySchema.parse(await searchParams);

  const where: Prisma.ModerationActionWhereInput = query.search
    ? {
        OR: [
          { targetUsername: { contains: query.search, mode: 'insensitive' } },
          { actorUsername: { contains: query.search, mode: 'insensitive' } },
          { targetDiscordId: query.search },
        ],
      }
    : {};

  const pagination = { page: query.page, pageSize: 25 };
  const { skip, take } = toSkipTake(pagination);
  const [items, total] = await Promise.all([
    prisma.moderationAction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.moderationAction.count({ where }),
  ]);
  const result = paginate(items, total, pagination);

  const buildHref = (page: number): string => {
    const search = new URLSearchParams();
    if (query.search) {
      search.set('search', query.search);
    }
    if (page > 1) {
      search.set('page', String(page));
    }
    const queryString = search.toString();
    return queryString ? `/moderation?${queryString}` : '/moderation';
  };

  return (
    <>
      <form role="search" className="flex items-center gap-2">
        <Input
          name="search"
          defaultValue={query.search ?? ''}
          placeholder="Benutzer oder Moderator suchen"
          aria-label="Moderationsaktionen durchsuchen"
          className="sm:w-80"
        />
        <button type="submit" className={cn(buttonVariants({ variant: 'outline' }))}>
          Suchen
        </button>
      </form>

      <DataTable
        columns={[
          {
            key: 'time',
            header: 'Zeitpunkt',
            render: (row: ModerationAction) => (
              <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.createdAt)}</span>
            ),
          },
          {
            key: 'type',
            header: 'Aktion',
            render: (row: ModerationAction) => (
              <span className="flex items-center gap-2">
                {TYPE_LABEL[row.type] ?? row.type}
                <Badge variant="outline">{row.module}</Badge>
              </span>
            ),
          },
          {
            key: 'target',
            header: 'Betroffen',
            render: (row: ModerationAction) => (
              <Link href={`/members/${row.targetDiscordId}`} className="hover:underline">
                {row.targetUsername}
              </Link>
            ),
          },
          { key: 'actor', header: 'Moderator', render: (row: ModerationAction) => row.actorUsername },
          {
            key: 'reason',
            header: 'Grund',
            className: 'max-w-xs',
            render: (row: ModerationAction) => (
              <span className="line-clamp-2 break-words text-muted-foreground">{row.reason ?? '-'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: ModerationAction) => <StatusBadge status={row.status} />,
          },
        ]}
        rows={result.items}
        getRowKey={(row) => row.id}
        emptyTitle="Keine Moderationsaktionen"
        emptyDescription="Sobald Aktionen ausgeführt werden, erscheinen sie hier."
        caption="Moderationshistorie"
      />

      {result.totalPages > 1 ? (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          buildHref={buildHref}
        />
      ) : null}
    </>
  );
}
