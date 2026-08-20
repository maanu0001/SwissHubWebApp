import type { Metadata } from 'next';
import Link from 'next/link';
import { jail, getModuleSettings, isModuleEnabled } from '@swisshub/modules';
import { formatDateTime, formatDayTime } from '@swisshub/shared';
import { can } from '@swisshub/auth';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageToolbar } from '@/components/shared/page-header';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { DataTable } from '@/components/shared/data-table';
import { Pagination } from '@/components/shared/pagination';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/shared/states';
import { CreateJailDialog } from '@/modules/jail/components/create-jail-dialog';
import { JailRowActions } from '@/modules/jail/components/jail-row-actions';
import { RemainingTime } from '@/modules/jail/components/remaining-time';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';
import type { JailEntry } from '@swisshub/database';

export const metadata: Metadata = { title: 'Jail' };
export const dynamic = 'force-dynamic';

interface JailPageProps {
  searchParams: Promise<{ tab?: string; page?: string; search?: string }>;
}

export default async function JailPage({ searchParams }: JailPageProps): Promise<React.JSX.Element> {
  const context = await requirePagePermission(jail.JAIL_PERMISSIONS.view);
  const params = await searchParams;
  const query = jail.jailListQuerySchema.parse({
    tab: params.tab ?? 'active',
    page: params.page ?? '1',
    search: params.search,
  });

  const [result, settings, enabled] = await Promise.all([
    jail.listJails(query),
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    isModuleEnabled(jail.JAIL_MODULE_ID),
  ]);

  const csrfToken = csrfTokenFor(context);
  const canRelease = can(context, jail.JAIL_PERMISSIONS.release);
  const canCreate = can(context, jail.JAIL_PERMISSIONS.create);

  const buildHref = (page: number, tab = query.tab): string => {
    const search = new URLSearchParams();
    search.set('tab', tab);
    if (page > 1) {
      search.set('page', String(page));
    }
    if (query.search) {
      search.set('search', query.search);
    }
    return `/jail?${search.toString()}`;
  };

  const columns = [
    {
      key: 'member',
      header: 'Mitglied',
      render: (entry: JailEntry) => (
        <Link href={`/members/${entry.targetDiscordId}`} className="flex items-center gap-3 hover:underline">
          <DiscordAvatar
            discordId={entry.targetDiscordId}
            avatarHash={entry.targetAvatarHash}
            name={entry.targetUsername}
            size={32}
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{entry.targetDisplayName ?? entry.targetUsername}</span>
            <span className="truncate text-xs text-muted-foreground">@{entry.targetUsername}</span>
          </span>
        </Link>
      ),
    },
    {
      key: 'reason',
      header: 'Grund',
      className: 'max-w-xs',
      render: (entry: JailEntry) => (
        <span className="line-clamp-2 break-words text-muted-foreground">{entry.reason}</span>
      ),
    },
    {
      key: 'moderator',
      header: 'Moderator',
      render: (entry: JailEntry) => (
        <span className="flex items-center gap-2">
          <DiscordAvatar
            discordId={entry.moderatorDiscordId}
            avatarHash={entry.moderatorAvatarHash}
            name={entry.moderatorUsername}
            size={24}
          />
          <span className="truncate">{entry.moderatorUsername}</span>
        </span>
      ),
    },
    {
      key: 'start',
      header: 'Start',
      render: (entry: JailEntry) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {query.tab === 'active' ? formatDayTime(entry.startedAt) : formatDateTime(entry.startedAt)}
        </span>
      ),
    },
    {
      key: 'end',
      header: query.tab === 'active' ? 'Ende' : 'Freigelassen',
      render: (entry: JailEntry) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {query.tab === 'active'
            ? jail.jailEndLabel(entry, { short: true })
            : entry.releasedAt
              ? formatDateTime(entry.releasedAt)
              : '-'}
        </span>
      ),
    },
    query.tab === 'active'
      ? {
          key: 'remaining',
          header: 'Verbleibend',
          render: (entry: JailEntry) =>
            entry.endsAt ? (
              <span className="whitespace-nowrap font-medium text-primary-bright">
                <RemainingTime endsAt={entry.endsAt.toISOString()} />
              </span>
            ) : (
              // Permanente Jails haben keinen Countdown.
              <Badge variant="warning">{jail.PERMANENT_LABEL}</Badge>
            ),
        }
      : {
          key: 'duration',
          header: 'Dauer',
          render: (entry: JailEntry) => (
            <span className="whitespace-nowrap text-muted-foreground">{jail.jailDurationLabel(entry)}</span>
          ),
        },
    {
      key: 'status',
      header: 'Status',
      render: (entry: JailEntry) =>
        query.tab === 'active' ? (
          <StatusBadge status={entry.status} />
        ) : entry.releaseType ? (
          <Badge variant={entry.releaseType === 'MANUAL' ? 'secondary' : 'outline'}>
            {entry.releaseType === 'MANUAL'
              ? 'Manuell'
              : entry.releaseType === 'AUTOMATIC'
                ? 'Automatisch'
                : 'Abgleich'}
          </Badge>
        ) : (
          <StatusBadge status={entry.status} />
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Aktionen</span>,
      className: 'text-right',
      render: (entry: JailEntry) =>
        query.tab === 'active' ? (
          <JailRowActions
            csrfToken={csrfToken}
            jailId={entry.id}
            memberLabel={entry.targetDisplayName ?? entry.targetUsername}
            canRelease={canRelease}
          />
        ) : (
          <Link href={`/jail/${entry.id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            Details
          </Link>
        ),
    },
  ];

  return (
    <>
      {!enabled ? (
        <EmptyState
          title="Modul deaktiviert"
          description="Das Jail-Modul ist derzeit deaktiviert. Aktive Einträge bleiben sichtbar, neue Jails sind nicht möglich."
        />
      ) : null}

      {!settings.jailRoleId ? (
        <div
          role="status"
          className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          Es ist noch keine Jail-Rolle konfiguriert. Bitte in den Einstellungen unter &quot;Jail&quot; eine
          Rolle hinterlegen, bevor Jails erstellt werden.
        </div>
      ) : null}

      <PageToolbar
        actions={
          canCreate && enabled ? (
            <CreateJailDialog
              csrfToken={csrfToken}
              durationPresets={jail.JAIL_DURATION_PRESETS}
              maxDurationSeconds={settings.maxDurationSeconds}
            />
          ) : null
        }
      >
        <div className="inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-card/60 p-1">
          {(
            [
              { key: 'active', label: 'Aktiv' },
              { key: 'past', label: 'Vergangen' },
            ] as const
          ).map((tab) => (
            <Link
              key={tab.key}
              href={buildHref(1, tab.key)}
              aria-current={query.tab === tab.key ? 'page' : undefined}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                query.tab === tab.key
                  ? 'bg-primary/20 text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        <form className="flex items-center gap-2" role="search">
          <input type="hidden" name="tab" value={query.tab} />
          <Input
            name="search"
            defaultValue={query.search ?? ''}
            placeholder="Benutzer oder Moderator suchen"
            className="sm:w-72"
            aria-label="Jails durchsuchen"
          />
          <button type="submit" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Suchen
          </button>
        </form>
      </PageToolbar>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowKey={(entry) => entry.id}
        emptyTitle={query.tab === 'active' ? 'Keine aktiven Jails' : 'Keine vergangenen Jails'}
        emptyDescription={
          query.tab === 'active'
            ? 'Aktuell ist kein Mitglied gejailt.'
            : 'Es wurden noch keine Jail-Strafen abgeschlossen.'
        }
        caption="Jail-Übersicht"
      />

      {result.totalPages > 1 ? (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          buildHref={(page) => buildHref(page)}
        />
      ) : null}
    </>
  );
}
