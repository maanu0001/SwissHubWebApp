'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { testIntegrationAction } from '@/modules/integrations/actions';

/**
 * «Verbindung testen» (§26).
 *
 * Der Test kostet eine echte Anfrage beim Anbieter - bei der AI auch Geld.
 * Deshalb ist der Knopf während der Anfrage gesperrt und die Aktion
 * serverseitig eng ratenbegrenzt (§48); ein festgehaltener Knopf löst keine
 * hundert Anfragen aus.
 *
 * Was zurückkommt, ist eine bereinigte Auskunft. Eine Anbieter-Rohantwort
 * käme hier nie an: sie wird serverseitig übersetzt, ehe sie den Prozess
 * verlässt (§47).
 */
export function TestKnopf({
  integrationId,
  csrfToken,
  label = 'Verbindung testen',
}: {
  integrationId: string;
  csrfToken: string;
  label?: string;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ ok: boolean; detail: string } | null>(null);

  const testen = async (): Promise<void> => {
    setPending(true);
    try {
      const antwort = await testIntegrationAction({ csrfToken, integrationId });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Der Test hat nicht geklappt.');
        return;
      }
      const daten = antwort.data as { ok: boolean; detail: string };
      setErgebnis(daten);
      toast[daten.ok ? 'success' : 'error'](daten.detail);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void testen()}>
        <PlugZap aria-hidden="true" />
        {pending ? 'Testet ...' : label}
      </Button>
      {ergebnis ? (
        <p
          className={`flex items-center gap-1.5 text-sm ${
            ergebnis.ok ? 'text-emerald-500' : 'text-destructive'
          }`}
          role="status"
        >
          {ergebnis.ok ? (
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="size-4 shrink-0" aria-hidden="true" />
          )}
          {ergebnis.detail}
        </p>
      ) : null}
    </div>
  );
}
