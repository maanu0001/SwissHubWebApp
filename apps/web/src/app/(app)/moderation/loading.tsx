import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared/states';

/** Ladezustand waehrend die Serverdaten geholt werden. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b border-border/60 pb-5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
