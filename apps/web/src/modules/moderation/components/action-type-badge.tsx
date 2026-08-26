import type { ModerationActionType } from '@swisshub/database';
import { ACTION_LABEL, ACTION_TONE } from '@/modules/moderation/sections';
import { cn } from '@/lib/utils';

const TONE_CLASS: Record<'neutral' | 'warn' | 'hart' | 'gut', string> = {
  neutral: 'border-border bg-secondary/50 text-muted-foreground',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  hart: 'border-destructive/40 bg-destructive/10 text-destructive',
  gut: 'border-success/40 bg-success/10 text-success',
};

/**
 * Die Massnahme als Plakette.
 *
 * Die Farbe sagt, wie schwer sie wiegt - eine Notiz sieht nicht aus wie ein
 * Bann. Beschriftung und Ton stehen zentral in `sections.ts`, damit Verlauf,
 * Uebersicht und Mitgliederprofil dasselbe sagen.
 */
export function ActionTypeBadge({ type }: { type: ModerationActionType }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[ACTION_TONE[type]],
      )}
    >
      {ACTION_LABEL[type]}
    </span>
  );
}
