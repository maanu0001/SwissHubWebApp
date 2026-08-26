import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared/states';

/** Ladezustand des Moderationsverlaufs. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}
