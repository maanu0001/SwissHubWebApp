import Link from 'next/link';
import { formatDateTime } from '@swisshub/shared';
import type { DiscordEvent } from '@swisshub/database';
import type { analytics } from '@swisshub/modules';
import { ActorLine, CategoryBadge, EventTypeBadge } from './event-badges';

/**
 * Eine Zeile der Zeitleiste.
 *
 * Der Aufbau folgt der Frage, die jemand stellt, wenn er hierher kommt: was
 * ist geschehen, wen betraf es, wer war es - in dieser Reihenfolge. Der
 * Zeitpunkt steht rechts, weil man ihn sucht, wenn man schon weiss, was man
 * sucht.
 *
 * `mitInhalten` blendet den Text nicht nur aus: die Felder sind gar nicht
 * geladen, wenn die Berechtigung fehlt. Der Parameter sagt hier nur, ob eine
 * Vorschau erwartet werden darf.
 */
export function EventRow({
  event,
  mitInhalten,
}: {
  event: DiscordEvent | analytics.EventOhneInhalt;
  mitInhalten: boolean;
}): React.JSX.Element {
  const inhalt = mitInhalten ? (event as DiscordEvent) : null;
  const vorher = inhalt?.contentBefore?.trim();
  const nachher = inhalt?.contentAfter?.trim();

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <EventTypeBadge type={event.type} severity={event.severity} />
        <CategoryBadge category={event.category} />
        {event.channelName ? (
          <span className="truncate text-sm text-muted-foreground">#{event.channelName}</span>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(event.occurredAt)}
        </span>
      </div>

      <div className="grid gap-1 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Betroffen</span>
          {event.subjectDiscordId ? (
            <Link href={`/members/${event.subjectDiscordId}`} className="min-w-0 truncate hover:underline">
              {event.subjectUsername ?? event.subjectDiscordId}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Ausgelöst</span>
          <ActorLine
            username={event.actorUsername}
            discordId={event.actorDiscordId}
            source={event.actorSource}
          />
        </div>
      </div>

      {vorher || nachher ? (
        <div className="space-y-1.5 rounded-lg border border-border/70 bg-secondary/30 p-3 text-sm">
          {vorher ? (
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Vorher</p>
              <p className="whitespace-pre-wrap break-words">{vorher}</p>
            </div>
          ) : null}
          {nachher ? (
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Nachher</p>
              <p className="whitespace-pre-wrap break-words">{nachher}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {event.moderationActionId ? (
        // Dasselbe Geschehen, zwei Blickwinkel: hier das Discord-Ereignis,
        // dort der Moderationsvorgang mit Grund und Verantwortlichem.
        <p className="text-xs text-muted-foreground">
          Ausgelöst über dieses Dashboard -{' '}
          <Link href="/moderation/verlauf" className="text-primary-bright hover:underline">
            im Moderationsverlauf ansehen
          </Link>
        </p>
      ) : null}
    </li>
  );
}
