'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Fehleranzeige für alle Bereiche der angemeldeten Anwendung.
 *
 * Sie greift innerhalb des Layouts. Ohne sie würde jeder Fehler die
 * Fehlergrenze an der Wurzel auslösen, und die ersetzt die gesamte Seite -
 * samt Seitenleiste. Aus einem Fehler in einem einzelnen Modul würde so eine
 * Anwendung, aus der man nur noch per Adresszeile herausfindet.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    console.error('Fehler im Anwendungsbereich', error.digest ?? '');
  }, [error]);

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/15 text-destructive">
        <AlertOctagon className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-lg font-semibold">Diese Seite konnte nicht geladen werden</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Es ist ein unerwarteter Fehler aufgetreten. Die übrigen Bereiche sind weiterhin erreichbar.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Referenz: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Erneut versuchen</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Zum Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
