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
import { CommunicationSectionNav } from '@/modules/communication/components/section-nav';
import { HistoryFilters } from '@/modules/communication/components/history-filters';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { communicationSections } from '@/server/communication';

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

  // Nachsichtig gelesen: ein unsinniger Wert in der Adresse führt zum
  // Standardwert, nicht zu einem Fehler.
  const query = communication.parseHistoryQuery({
    type: params.typ,
    status: params.status,
    channelId: params.kanal,
    search: params.suche,
    from: params.von,
    to: params.bis,
    page: params.seite,
  });

  // Der Verlauf hängt nicht an Discord: er zeigt auch dann, was gesendet
  // wurde, wenn Discord gerade nicht erreichbar ist.
  const [result, channels] = await Promise.all([
    communication.listCommunicationHistory(query),
    communication.listSendableChannels('NEWS').catch(() => []),
  ]);
  const canManage = can(context, communication.COMMUNICATION_PERMISSIONS.manage);

  return (
    <>
      <CommunicationSectionNav sections={communicationSections(context)} />

      <Card>
        <CardHeader>
          <CardTitle>Letzte Nachrichten</CardTitle>
          <CardDescription>
            Alles, was über die WebApp oder <code>/post</code> im Namen des Bots gesendet wurde.
            Gelöschte und fehlgeschlagene Nachrichten bleiben zur Nachvollziehbarkeit sichtbar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <HistoryFilters channels={channels.map((entry) => ({ id: entry.id, name: entry.name }))} />

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
                      {entry.status === 'DELETED' ? <Badge variant="destructive">gelöscht</Badge> : null}
                      {entry.status === 'FAILED' ? (
                        <Badge variant="destructive">nicht gesendet</Badge>
                      ) : null}
                      {entry.editedAt ? <Badge variant="outline">bearbeitet</Badge> : null}
                      <Badge variant="secondary">
                        {entry.source === 'SLASH_COMMAND' ? 'via /post' : 'via WebApp'}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.channelName ? `#${entry.channelName}` : entry.channelId} · {entry.sentByUsername}{' '}
                      · {formatDateTime(entry.sentAt)}
                    </p>
                    {entry.status === 'FAILED' && entry.failureCode ? (
                      <p className="mt-1 text-xs text-destructive">
                        {entry.failureCode === 'TIMEOUT'
                          ? 'Discord hat nicht rechtzeitig geantwortet. Bitte im Channel prüfen, bevor du es erneut versuchst.'
                          : `Discord hat den Versand abgelehnt (${entry.failureCode}).`}
                      </p>
                    ) : null}
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
                    {canManage && entry.status === 'SENT' && entry.discordUrl ? (
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
              // Die gesetzten Filter bleiben beim Blättern erhalten.
              buildHref={(page) => {
                const next = new URLSearchParams();
                for (const [key, value] of Object.entries(params)) {
                  if (value && key !== 'seite') {
                    next.set(key, value);
                  }
                }
                next.set('seite', String(page));
                return `/communication/history?${next.toString()}`;
              }}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
