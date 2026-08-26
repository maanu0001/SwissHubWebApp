import { Skeleton } from '@/components/ui/skeleton';

/**
 * Ladezustand der Statistik.
 *
 * Bewusst der Form der Seite nachempfunden: ein Gerüst, das schon zeigt, wo
 * gleich was steht, wirkt kürzer als ein kreisender Spinner über dem ganzen
 * Fenster.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
        {Array.from({ length: 6 }, (_unused, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}
