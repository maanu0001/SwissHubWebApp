import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PanelProps {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  /** Aktion oben rechts, z.B. "Alle anzeigen". */
  action?: { label: string; href: string; ariaLabel?: string } | React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

function isLinkAction(value: unknown): value is { label: string; href: string } {
  return typeof value === 'object' && value !== null && 'href' in value && 'label' in value;
}

/**
 * Panel im SwissHub-Design: Kopfzeile mit Icon-Chip, Titel und optionaler
 * Aktion, darunter der Inhalt.
 */
export function Panel({
  title,
  icon,
  description,
  action,
  className,
  bodyClassName,
  children,
}: PanelProps): React.JSX.Element {
  return (
    <section className={cn('flex flex-col rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <span className="icon-chip size-9 shrink-0 [&_svg]:size-4">{icon}</span> : null}
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>

        {isLinkAction(action) ? (
          <Link
            href={action.href}
            aria-label={action.ariaLabel}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : (
          action
        )}
      </header>

      <div className={cn('flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
