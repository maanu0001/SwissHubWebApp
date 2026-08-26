import type { DiscordActorSource, DiscordEventCategory, DiscordEventSeverity } from '@swisshub/database';
import { ACTOR_SOURCE_LABEL, CATEGORY_LABEL, SEVERITY_TONE, eventTypeLabel } from '../labels';
import { cn } from '@/lib/utils';

const TONE_CLASS: Record<'neutral' | 'warn' | 'hart', string> = {
  neutral: 'border-border bg-secondary/50 text-muted-foreground',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  hart: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/** Der Ereignistyp als Plakette, eingefärbt nach Schwere. */
export function EventTypeBadge({
  type,
  severity,
}: {
  type: string;
  severity: DiscordEventSeverity;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[SEVERITY_TONE[severity]],
      )}
    >
      {eventTypeLabel(type)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: DiscordEventCategory }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/**
 * Wer es war - und woher wir das wissen.
 *
 * Die Herkunft steht dabei, weil sie den Wert der Aussage bestimmt. «Nicht
 * zuzuordnen» erscheint ausdrücklich und nicht als leere Stelle: eine leere
 * Stelle liest sich wie ein Darstellungsfehler, dieser Satz wie das, was er
 * ist - eine Antwort.
 */
export function ActorLine({
  username,
  discordId,
  source,
}: {
  username: string | null;
  discordId: string | null;
  source: DiscordActorSource;
}): React.JSX.Element {
  if (source === 'UNKNOWN' || !discordId) {
    return (
      <span className="text-muted-foreground italic">
        {ACTOR_SOURCE_LABEL.UNKNOWN}
        <span className="sr-only"> - Discord meldet bei diesem Ereignis nicht, wer es ausgelöst hat.</span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="truncate">{username ?? discordId}</span>
      <span className="text-xs text-muted-foreground">{ACTOR_SOURCE_LABEL[source]}</span>
    </span>
  );
}
