import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, jail, listCachedChannels } from '@swisshub/modules';
import { formatDateTime, formatDuration } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { PageToolbar } from '@/components/shared/page-header';
import { StartVoteJailDialog } from '@/modules/jail/components/start-vote-jail-dialog';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { JailSectionNav } from '@/modules/jail/components/section-nav';
import { jailSections } from '@/server/jail';

export const metadata: Metadata = { title: 'Vote Jails' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'outline' | 'destructive' }> =
  {
    ACTIVE: { label: 'Läuft', variant: 'warning' },
    SUCCEEDED: { label: 'Erfolgreich', variant: 'success' },
    FAILED: { label: 'Ohne Ergebnis', variant: 'outline' },
    CANCELLED: { label: 'Abgebrochen', variant: 'destructive' },
  };

/**
 * Übersicht der Community-Abstimmungen.
 *
 * Zeigt laufende und abgeschlossene Vote Jails. Der Stand kommt vollständig aus
 * der Datenbank - auch wenn Discord gerade nicht erreichbar ist.
 */
export default async function VoteJailsPage(): Promise<React.JSX.Element> {
  // Zwei Zugaenge: die Abstimmungen einsehen - oder eine starten duerfen.
  // Bisher stand hier nur `view`, und damit sah jemand mit dem Recht «Vote
  // Jail starten» den Bereich nie, den er bedienen darf.
  const context = await requirePagePermission([jail.JAIL_PERMISSIONS.view, jail.JAIL_PERMISSIONS.voteStart]);
  const csrfToken = csrfTokenFor(context);

  // Das Archiv wird nur geholt, wenn es auch gezeigt wird - was nicht geladen
  // wird, kann auch nicht versehentlich in einer Antwort landen.
  const darfArchivLaden = can(context, jail.JAIL_PERMISSIONS.view);
  const [enabled, config, active, past, channels] = await Promise.all([
    isModuleEnabled(jail.JAIL_MODULE_ID),
    jail.getVoteJailConfig(),
    jail.listVoteJails({ tab: 'active' }),
    darfArchivLaden ? jail.listVoteJails({ tab: 'past', limit: 50 }) : Promise.resolve([]),
    listCachedChannels().catch(() => []),
  ]);

  const canStart = can(context, jail.JAIL_PERMISSIONS.voteStart);
  // Das Archiv gehoert zur Moderationssicht. Wer nur mitstimmen darf, sieht
  // die laufenden Abstimmungen und startet neue - die Sammlung aller
  // beendeten Verfahren ist etwas anderes als die Teilnahme am laufenden.
  const darfArchiv = darfArchivLaden;
  const channelName = config.channelId
    ? (channels.find((channel) => channel.id === config.channelId)?.name ?? null)
    : null;

  const rows = (entries: typeof active): React.JSX.Element => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ziel</TableHead>
          <TableHead>Initiator</TableHead>
          <TableHead>Grund</TableHead>
          <TableHead className="text-right">Stimmen</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>Ende</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((vote) => (
          <TableRow key={vote.id}>
            <TableCell>
              <span className="flex items-center gap-2">
                <DiscordAvatar
                  discordId={vote.targetDiscordId}
                  avatarHash={vote.targetAvatarHash}
                  name={vote.targetDisplayName ?? vote.targetUsername}
                  size={24}
                />
                <span className="truncate font-medium">{vote.targetDisplayName ?? vote.targetUsername}</span>
              </span>
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <DiscordAvatar
                  discordId={vote.startedByDiscordId}
                  avatarHash={vote.startedByAvatarHash}
                  name={vote.startedByUsername}
                  size={24}
                />
                <span className="truncate">{vote.startedByUsername}</span>
              </span>
            </TableCell>
            <TableCell className="max-w-[16rem] truncate text-muted-foreground">
              {vote.reason ?? '-'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {vote.voteCount} / {vote.requiredVotes}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS[vote.status]?.variant ?? 'outline'}>
                {STATUS[vote.status]?.label ?? vote.status}
              </Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(vote.createdAt)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(vote.finishedAt ?? vote.expiresAt)}
            </TableCell>
            <TableCell className="text-right">
              <span className="flex justify-end gap-3">
                {vote.resultingJailId ? (
                  <Link
                    href={`/jail/${vote.resultingJailId}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Jail
                  </Link>
                ) : null}
                {vote.discordUrl ? (
                  <Link
                    href={vote.discordUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Discord
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </Link>
                ) : null}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <>
      <JailSectionNav sections={jailSections(context)} />
      <PageToolbar>
        <p className="text-sm text-muted-foreground">
          {config.enabled
            ? `${config.requiredVotes} Stimmen innerhalb ${formatDuration(config.durationSeconds * 1000)} führen zu ${formatDuration(config.resultSeconds * 1000)} Jail.`
            : 'Vote Jail ist derzeit deaktiviert.'}
        </p>
        {canStart ? (
          <StartVoteJailDialog
            csrfToken={csrfToken}
            requiredVotes={config.requiredVotes}
            durationSeconds={config.durationSeconds}
            resultSeconds={config.resultSeconds}
            channelName={channelName}
            disabled={!enabled || !config.enabled || !config.channelId}
          />
        ) : null}
      </PageToolbar>

      {enabled && config.enabled && !config.channelId ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Es ist kein Vote-Jail-Channel gewählt. Ohne Channel kann keine Abstimmung veröffentlicht werden -
            nachzuholen unter{' '}
            <Link href="/modules/jail" className="underline">
              Module → Jail
            </Link>
            .
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Laufende Abstimmungen</CardTitle>
          <CardDescription>Abstimmungen, die noch Stimmen sammeln.</CardDescription>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <EmptyState title="Keine laufende Abstimmung" description="Aktuell läuft kein Vote Jail." />
          ) : (
            rows(active)
          )}
        </CardContent>
      </Card>

      {darfArchiv ? (
        <Card>
          <CardHeader>
            <CardTitle>Abgeschlossen</CardTitle>
            <CardDescription>Die letzten beendeten Abstimmungen.</CardDescription>
          </CardHeader>
          <CardContent>
            {past.length === 0 ? (
              <EmptyState title="Noch nichts abgeschlossen" description="Es gab bisher keine Abstimmung." />
            ) : (
              rows(past)
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
