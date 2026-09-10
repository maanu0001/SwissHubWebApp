import { Skeleton } from '@/components/ui/skeleton';

/**
 * Ladezustand des Dashboards.
 *
 * Der Platzhalter zeichnet nach, was danach tatsaechlich kommt: Begruessung,
 * eine Zeile mit dem Stand, die Schnellaktionen, dann die beiden Spalten. Vier
 * grosse Kacheln standen hier noch, als das Dashboard mit vier Kennzahlkarten
 * begann - seit die Karten nur noch bei Handlungsbedarf erscheinen, waere das
 * ein Versprechen, das die Seite gleich darauf bricht: der Inhalt sprang beim
 * Laden um eine halbe Bildschirmhoehe.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-80 lg:col-span-3" />
        <Skeleton className="h-80 lg:col-span-2" />
      </div>
    </div>
  );
}
