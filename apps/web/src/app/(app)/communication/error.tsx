'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Fehleranzeige innerhalb des Kommunikationsmoduls.
 *
 * Sie steht bewusst hier und nicht nur an der Wurzel: eine Fehlergrenze auf
 * oberster Ebene ersetzt die gesamte Seite einschliesslich Layout - dann ist
 * auch die Seitenleiste weg, und aus einem Fehler in einem Modul wird eine
 * Anwendung, die sich nicht mehr bedienen lässt.
 *
 * Diese Grenze fängt den Fehler innerhalb des Layouts ab. Die Navigation
 * bleibt bedienbar, und man kommt mit einem Klick woandershin.
 */
export default function CommunicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // Nur die Referenz - der vollständige Fehler steht im Server-Log.
    console.error('Fehler im Kommunikationsmodul', error.digest ?? '');
  }, [error]);

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/15 text-destructive">
        <AlertOctagon className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-lg font-semibold">Der Bereich konnte nicht geladen werden</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Bereits gesendete Nachrichten sind davon nicht betroffen. Versuche es erneut oder wechsle in
        einen anderen Bereich.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Referenz: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Erneut versuchen</Button>
        <Button asChild variant="outline">
          <Link href="/communication/history">Zum Verlauf</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Zum Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
