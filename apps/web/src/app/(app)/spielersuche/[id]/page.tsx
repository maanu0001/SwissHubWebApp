import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { can } from '@swisshub/auth';
import { discord } from '@swisshub/discord';
import { spielersuche } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { CloseSearchButton } from '@/modules/spielersuche/components/close-search-button';
import { STATUS_LABEL, discordMessageLink } from '@/modules/spielersuche/components/match-card';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Spielersuche' };
export const dynamic = 'force-dynamic';

/** Detailansicht einer Suche mit allen Teilnehmern. */
export default async function SearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.view);
  const { id } = await params;

  const [match, guild] = await Promise.all([
    spielersuche.getSearchDetail(id),
    discord.guild.get().catch(() => null),
  ]);
  if (!match) {
    notFound();
  }

  const csrfToken = csrfTokenFor(context);
  const status = STATUS_LABEL[match.status] ?? STATUS_LABEL.CLOSED!;
  const active = match.status === 'OPEN' || match.status === 'COMPLETE';
  const isCreator = match.creatorDiscordId === context.user.discordId;
  const mayClose =
    active &&
    (can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.closeAny) ||
      (isCreator && can(context, spielersuche.SPIELERSUCHE_PERMISSIONS.closeOwn)));
  const link = discordMessageLink(match, guild?.id ?? null);

  const current = match.participants.filter((participant) => participant.leftAt === null);
  const past = match.participants.filter((participant) => participant.leftAt !== null);

  return (
    <>
      <PageHeader
        title={match.gameName}
        description={`Gestartet am ${formatDateTime(match.createdAt)} von ${
          match.creatorDisplayName ?? match.creatorUsername
        }.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/spielersuche/aktiv"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <ArrowLeft aria-hidden="true" />
              Zurück
            </Link>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <ExternalLink aria-hidden="true" />
                Auf Discord öffnen
              </a>
            ) : null}
            {mayClose ? <CloseSearchButton csrfToken={csrfToken} matchId={match.id} size="default" /> : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Alle Angaben zu dieser Spielersuche.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Spiel">{match.gameName}</Row>
              <Row label="Ersteller">
                <span className="flex items-center gap-2">
                  <DiscordAvatar
                    discordId={match.creatorDiscordId}
                    avatarHash={match.creatorAvatarHash}
                    name={match.creatorUsername}
                    size={24}
                  />
                  <Link href={`/members/${match.creatorDiscordId}`} className="hover:underline">
                    {match.creatorDisplayName ?? match.creatorUsername}
                  </Link>
                </span>
              </Row>
              <Row label="Gesuchte Spieler">{match.requestedPlayers}</Row>
              <Row label="Gruppe">
                {current.length} / {match.requestedPlayers + 1}
                {match.maxSquadSize ? ` · Gruppengrösse ${match.maxSquadSize}` : ''}
              </Row>
              {match.comment ? (
                <Row label="Kommentar">
                  <span className="whitespace-pre-wrap break-words">{match.comment}</span>
                </Row>
              ) : null}
              <Row label="Status">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {match.source === 'LEGACY_IMPORT' ? (
                    <Badge variant="outline">Übernommen</Badge>
                  ) : (
                    <Badge variant="outline">
                      {match.source === 'DASHBOARD' ? 'Dashboard' : 'Slash Command'}
                    </Badge>
                  )}
                </span>
              </Row>
              <Row label="Sprachkanal">
                {match.voiceChannelId
                  ? (match.voiceChannelName ?? `#${match.voiceChannelId}`)
                  : 'kein Sprachkanal'}
              </Row>
              <Row label="Rollen-Ping">
                {match.rolePinged
                  ? match.pingRoleId
                    ? `Rolle wurde erwähnt (${match.pingRoleId})`
                    : 'Rolle wurde erwähnt'
                  : 'nicht erwähnt (Cooldown oder deaktiviert)'}
              </Row>
              <Row label="Startzeit">{formatDateTime(match.createdAt)}</Row>
              <Row label="Ablaufzeit">{formatDateTime(match.expiresAt)}</Row>
              {match.closedAt ? (
                <Row label="Beendet">
                  {formatDateTime(match.closedAt)}
                  {match.closedByDiscordId ? ` durch <@${match.closedByDiscordId}>` : ''}
                </Row>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teilnehmer</CardTitle>
            <CardDescription>
              {current.length} {current.length === 1 ? 'Person' : 'Personen'} in der Gruppe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Aktuell dabei
              </h3>
              <ul className="space-y-2">
                {current.map((participant) => (
                  <li key={participant.id} className="flex items-center gap-2 text-sm">
                    <DiscordAvatar
                      discordId={participant.discordId}
                      avatarHash={participant.avatarHash}
                      name={participant.username ?? participant.discordId}
                      size={24}
                    />
                    <Link
                      href={`/members/${participant.discordId}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {participant.displayName ?? participant.username ?? participant.discordId}
                    </Link>
                    {participant.isCreator ? <span aria-label="Ersteller">👑</span> : null}
                  </li>
                ))}
              </ul>
            </section>

            {past.length > 0 ? (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Wieder ausgetreten ({past.length})
                </h3>
                <ul className="space-y-2">
                  {past.map((participant) => (
                    <li
                      key={participant.id}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <DiscordAvatar
                        discordId={participant.discordId}
                        avatarHash={participant.avatarHash}
                        name={participant.username ?? participant.discordId}
                        size={24}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {participant.displayName ?? participant.username ?? participant.discordId}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid gap-1 border-b border-border/50 py-3 last:border-0 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}
