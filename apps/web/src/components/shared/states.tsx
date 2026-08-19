import { AlertTriangle, Inbox, Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: StateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/80 px-6 py-14 text-center',
        className,
      )}
    >
      <span className="rounded-full bg-muted p-3 text-muted-foreground">
        <Inbox className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title, description, action, className }: StateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-14 text-center',
        className,
      )}
      role="alert"
    >
      <span className="rounded-full bg-destructive/15 p-3 text-destructive">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PermissionDeniedState({ description }: { description?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/80 px-6 py-14 text-center">
      <span className="rounded-full bg-warning/15 p-3 text-warning">
        <ShieldAlert className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">Keine Berechtigung</p>
        <p className="text-sm text-muted-foreground">
          {description ?? 'Dir fehlt die erforderliche Berechtigung fuer diesen Bereich.'}
        </p>
      </div>
    </div>
  );
}

export function LoadingState({ label = 'Wird geladen ...' }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
          >
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <Skeleton key={columnIndex} className="h-5" />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
