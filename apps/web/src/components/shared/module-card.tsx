import Link from 'next/link';
import { NavIcon } from '@/components/layout/nav-icon';
import { cn } from '@/lib/utils';

interface ModuleCardProps {
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  href?: string | null;
}

/** Modulkachel im SwissHub-Design (Icon, Name, Kurztext, Statuspunkt). */
export function ModuleCard({ name, description, icon, enabled, href }: ModuleCardProps): React.JSX.Element {
  const status = enabled ? 'Aktiv' : 'Deaktiviert';
  const statusClasses = enabled ? 'text-success' : 'text-destructive';
  const dotClasses = enabled ? 'bg-success' : 'bg-destructive';

  const content = (
    <div
      className={cn(
        'flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-5 text-center transition-colors',
        href ? 'hover:border-primary/40 hover:bg-card' : '',
      )}
    >
      <span className="icon-chip size-11 [&_svg]:size-5">
        <NavIcon name={icon} />
      </span>
      <p className="mt-1 text-sm font-semibold">{name}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      <p className={cn('mt-auto flex items-center gap-1.5 pt-2 text-xs font-medium', statusClasses)}>
        <span className={cn('size-1.5 rounded-full', dotClasses)} aria-hidden="true" />
        {status}
      </p>
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
