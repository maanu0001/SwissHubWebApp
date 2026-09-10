import { Skeleton } from '@/components/ui/skeleton';

/**
 * Ladezustand der Kommunikation.
 *
 * Diese Datei ist die Behebung eines Navigationsfehlers, nicht Schmuck.
 *
 * `/communication` wird bei jedem Aufruf frisch gerendert und wartet dabei auf
 * drei Dinge, die von Discord kommen: die versendbaren Kanaele, Rollen und
 * Kanaele der Konfiguration, und die Erreichbarkeitspruefung der
 * Modulgesundheit. Jede einzelne Discord-Anfrage darf zehn Sekunden dauern und
 * wird bis zu dreimal wiederholt - die Seite faengt jeden Fehler ab und kommt
 * ohne diese Angaben aus, aber eben erst danach.
 *
 * Ohne Ladegrenze hat Next nichts, was es in der Zwischenzeit zeigen koennte:
 * der Browser bleibt auf der alten Seite stehen, bis der Server fertig ist.
 * Ein Klick auf «Kommunikation» sah deshalb aus, als sei er ins Leere
 * gegangen - und man klickte ein zweites Mal. Genau dieses Fenster schliesst
 * die Ladegrenze: der Wechsel ist sofort sichtbar, und `<Link>` kann sie
 * ausserdem vorab laden.
 *
 * Kein Kunstgriff an der Navigation, sondern derselbe Mechanismus, den
 * Dashboard, Mitglieder, Moderation, Audit, Analytics und Profil bereits
 * benutzen.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      {/* Die Bereichsnavigation - sie steht auf jeder Seite des Moduls. */}
      <Skeleton className="h-9 w-full max-w-md" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-96" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}
