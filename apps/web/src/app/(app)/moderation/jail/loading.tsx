import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared/states';

/** Ladezustand während die Serverdaten geholt werden. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full max-w-md" />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
