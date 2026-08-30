import type { ModerationSource } from '@swisshub/database';
import { SOURCE_LABEL } from '@/modules/moderation/sections';
import { cn } from '@/lib/utils';

/**
 * Woher eine Massnahme kam.
 *
 * Nur `DISCORD` hebt sich ab, und zwar absichtlich: alles Uebrige lief ueber
 * SwissHub und ist damit vollstaendig belegt - Grund, Berechtigung,
 * Rangfolgepruefung. Eine Massnahme aus Discord hat diese Pruefungen nicht
 * durchlaufen; sie wurde nachtraeglich bemerkt. Wer die Akte liest, soll das
 * am Zeilenrand sehen und nicht erst nachrechnen muessen.
 */
const TON: Record<ModerationSource, string> = {
  WEBAPP: 'border-border bg-secondary/50 text-muted-foreground',
  BOT: 'border-border bg-secondary/50 text-muted-foreground',
  SYSTEM: 'border-border bg-secondary/50 text-muted-foreground',
  DISCORD: 'border-primary/40 bg-primary/10 text-primary',
};

export function SourceBadge({ source }: { source: ModerationSource }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TON[source],
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}
