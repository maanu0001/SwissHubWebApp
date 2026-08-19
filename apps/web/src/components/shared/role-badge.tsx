import { cn } from '@/lib/utils';

interface RoleBadgeProps {
  name: string;
  /** Discord-Rollenfarbe als Integer. 0 = keine Farbe. */
  color?: number;
  className?: string;
}

/**
 * Discord-Rolle als Badge. Der Rollenname stammt von Discord und wird
 * ausschliesslich als Text gerendert (kein HTML) - siehe SECURITY.md.
 */
export function RoleBadge({ name, color = 0, className }: RoleBadgeProps): React.JSX.Element {
  const hex = color > 0 ? `#${color.toString(16).padStart(6, '0')}` : undefined;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: hex ?? 'hsl(var(--muted-foreground))' }}
        aria-hidden="true"
      />
      {name}
    </span>
  );
}
