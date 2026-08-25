import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Geruest der Mitgliederakte.
 *
 * Bewusst in denselben Massen wie die fertige Seite: ein Skelett, das anders
 * gross ist als der Inhalt, laesst die Seite beim Erscheinen springen.
 */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-36" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-8 w-24 shrink-0" />
            ))}
          </div>
          <Card>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
