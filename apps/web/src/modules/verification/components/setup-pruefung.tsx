'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, CircleDashed, PlayCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { setupCheckAction } from '@/modules/verification/actions';

interface Punkt {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  detail: string;
}

const SYMBOL = {
  ok: <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />,
  warning: <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden="true" />,
  error: <XCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />,
  skipped: <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
};

/**
 * «Verifikation testen».
 *
 * Prüft, ohne irgendjemanden anzufassen: keine Rolle wird vergeben, nichts
 * gesendet, niemand gebannt. Der Test soll die Fehler finden, bevor das erste
 * neue Mitglied auf sie stösst.
 */
export function SetupPruefung({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [bericht, setBericht] = useState<{ bereit: boolean; punkte: Punkt[] } | null>(null);

  const pruefen = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await setupCheckAction({ csrfToken });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Die Prüfung hat nicht geklappt.');
        return;
      }
      const daten = ergebnis.data as { bereit: boolean; punkte: Punkt[] };
      setBericht(daten);
      toast[daten.bereit ? 'success' : 'error'](
        daten.bereit ? 'Alles bereit.' : 'Es fehlt noch etwas - siehe Liste.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Einrichtung prüfen"
      description="Prüft Rollen, Rangfolge, Kanäle, Rechte und Intents - ohne jemanden zu verändern."
    >
      <Button disabled={pending} onClick={() => void pruefen()}>
        <PlayCircle aria-hidden="true" />
        {pending ? 'Prüft ...' : 'Verifikation testen'}
      </Button>

      {bericht ? (
        <ul className="mt-4 space-y-2">
          {bericht.punkte.map((punkt) => (
            <li key={punkt.id} className="flex items-start gap-2 text-sm">
              {SYMBOL[punkt.status]}
              <span className="min-w-0">
                <span className="font-medium">{punkt.label}</span>
                <span className="block text-xs text-muted-foreground">{punkt.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Noch nicht geprüft. Der Test legt keinen Vorgang an und sendet nichts.
        </p>
      )}
    </Panel>
  );
}
