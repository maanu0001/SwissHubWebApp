import { Skeleton } from '@/components/ui/skeleton';

/** Ladezustand der Zeitleiste. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
        {Array.from({ length: 4 }, (_unused, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
