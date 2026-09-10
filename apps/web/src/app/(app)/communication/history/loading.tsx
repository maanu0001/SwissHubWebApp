import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared/states';

/**
 * Ladezustand des Verlaufs.
 *
 * Aus demselben Grund wie nebenan: die Seite wird frisch gerendert, und ohne
 * Ladegrenze bliebe der Browser bis zur fertigen Antwort auf der alten Seite
 * stehen - ein Klick, der nichts tut.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-10 w-full max-w-lg" />
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
