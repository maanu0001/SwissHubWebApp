'use client';

import { useEffect } from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Globale Fehleranzeige.
 *
 * Es werden bewusst keine technischen Details (Stack Traces, SQL, Discord
 * Payloads) angezeigt - diese landen ausschliesslich im Server-Log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // Nur die Referenz protokollieren - der Server hat den vollständigen Fehler.
    console.error('Unerwarteter Fehler', error.digest ?? '');
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="items-center gap-3">
          <span className="rounded-full bg-destructive/15 p-3 text-destructive">
            <AlertOctagon className="size-6" aria-hidden="true" />
          </span>
          <CardTitle className="text-xl">Aktion konnte nicht ausgeführt werden</CardTitle>
          <CardDescription>
            Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut. Falls das Problem bestehen
            bleibt, wende dich an einen Administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Referenz: <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
          <Button onClick={reset}>Erneut versuchen</Button>
        </CardContent>
      </Card>
    </main>
  );
}
