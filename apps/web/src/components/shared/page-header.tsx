import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Kopfbereich für Detailseiten mit dynamischem Titel (z.B. ein einzelner
 * Jail-Vorgang). Die Titel der Modulseiten stehen in der Kopfzeile und werden
 * dort aus der Module Registry abgeleitet.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="truncate text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="truncate text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Werkzeugleiste einer Modulseite: links Filter/Tabs, rechts Aktionen.
 * Der Seitentitel selbst steht bereits in der Kopfzeile.
 */
export function PageToolbar({
  children,
  actions,
  className,
}: {
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
