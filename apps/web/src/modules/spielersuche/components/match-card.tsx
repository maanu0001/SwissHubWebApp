import Link from 'next/link';
import { ExternalLink, Users } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import type { SpielersucheMatch, SpielersucheParticipant } from '@swisshub/database';

/**
 * Karte einer Spielersuche.
 *
 * Zeigt genau das, was das Discord-Embed auch zeigt - damit Dashboard und
 * Discord dieselbe Wahrheit erzählen.
 */
export interface MatchCardProps {
  match: SpielersucheMatch & { participants: SpielersucheParticipant[] };
  guildId: string | null;
}

export const STATUS_LABEL: Record<string, { label: string; variant: 'warning' | 'success' | 'outline' }> = {
  OPEN: { label: 'Offen', variant: 'warning' },
  COMPLETE: { label: 'Komplett', variant: 'success' },
  CLOSED: { label: 'Beendet', variant: 'outline' },
  EXPIRED: { label: 'Abgelaufen', variant: 'outline' },
};

/** Link auf die Discord-Nachricht der Suche. */
export function discordMessageLink(match: SpielersucheMatch, guildId: string | null): string | null {
  if (!guildId || !match.channelId || !match.messageId) {
    return null;
  }
  return `https://discord.com/channels/${guildId}/${match.channelId}/${match.messageId}`;
}

export function MatchCard({ match, guildId }: MatchCardProps): React.JSX.Element {
  const total = match.requestedPlayers + 1;
  const active = match.participants.filter((participant) => participant.leftAt === null);
  const status = STATUS_LABEL[match.status] ?? STATUS_LABEL.CLOSED!;
  const link = discordMessageLink(match, guildId);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/spielersuche/${match.id}`} className="font-medium hover:underline">
            {match.gameName}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDateTime(match.createdAt)}
            {match.status === 'OPEN' || match.status === 'COMPLETE'
              ? ` · läuft ab ${formatDateTime(match.expiresAt)}`
              : ''}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </header>

      <div className="flex items-center gap-2">
        <DiscordAvatar
          discordId={match.creatorDiscordId}
          avatarHash={match.creatorAvatarHash}
          name={match.creatorUsername}
          size={28}
        />
        <span className="min-w-0 truncate text-sm">{match.creatorDisplayName ?? match.creatorUsername}</span>
      </div>

      {match.comment ? <p className="line-clamp-2 text-sm text-muted-foreground">{match.comment}</p> : null}

      <footer className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden="true" />
          {active.length}/{total}
        </span>
        {match.voiceChannelId ? <span>🔊 {match.voiceChannelName ?? 'Voice'}</span> : null}
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Auf Discord öffnen
          </a>
        ) : null}
      </footer>
    </article>
  );
}
