import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { can } from '@swisshub/auth';
import { communication } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { Pagination } from '@/components/shared/pagination';
import { DeleteMessageButton } from '@/modules/communication/components/history-actions';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Kommunikation – Verlauf' };
export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  NEWS: 'Neuigkeiten',
  EVENT: 'Event',
  POLL: 'Umfrage',
};

/** Verlauf der gesendeten Nachrichten inklusive Vorlage und Discord-Link. */
export default async function CommunicationHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(communication.COMMUNICATION_PERMISSIONS.history);
  const csrfToken = csrfTokenFor(context);
  const params = await searchParams;

  const query = communication.communicationHistoryQuerySchema.parse({
    type: params.typ ?? 'ALL',
    page: params.seite ?? 1,
  });
  const result = await communication.listCommunicationHistory(query);
  const canManage = can(context, communication.COMMUNICATION_PERMISSIONS.manage);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Letzte Nachrichten</CardTitle>
        <CardDescription>
          Alles, was über die WebApp im Namen des Bots gesendet wurde. Gelöschte Nachrichten bleiben zur
          Nachvollziehbarkeit sichtbar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.entries.length === 0 ? (
          <EmptyState
            title="Noch nichts gesendet"
            description="Sobald eine Nachricht gesendet wurde, erscheint sie hier."
          />
        ) : (
          <ul className="space-y-2">
            {result.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-border px-4 py-3"
              >
                <DiscordAvatar
                  discordId={entry.sentByDiscordId}
                  avatarHash={entry.sentByAvatarHash}
                  name={entry.sentByUsername}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{TYPE_LABEL[entry.type] ?? entry.type}</Badge>
                    <span className="truncate font-medium">{entry.title}</span>
                    {entry.deletedAt ? <Badge variant="destructive">gelöscht</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.channelName ? `#${entry.channelName}` : entry.channelId} · {entry.sentByUsername} ·{' '}
                    {formatDateTime(entry.sentAt)}
                  </p>
                </div>

                <span className="flex shrink-0 items-center gap-2">
                  {entry.discordUrl ? (
                    <Link
                      href={entry.discordUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      Auf Discord öffnen
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}
                  <Link
                    href={`/communication?vorlage=${entry.id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Als Vorlage verwenden
                  </Link>
                  {canManage && !entry.deletedAt && entry.discordUrl ? (
                    <DeleteMessageButton csrfToken={csrfToken} id={entry.id} title={entry.title} />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {result.total > result.pageSize ? (
          <Pagination
            page={result.page}
            totalPages={Math.ceil(result.total / result.pageSize)}
            total={result.total}
            buildHref={(page) => `/communication/history?typ=${query.type}&seite=${page}`}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
