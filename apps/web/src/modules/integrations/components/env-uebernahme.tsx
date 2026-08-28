'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { importEnvAction } from '@/modules/integrations/actions';

export interface EnvKandidatAnzeige {
  integrationId: string;
  integrationLabel: string;
  key: string;
  fieldLabel: string;
  envKey: string;
  inDatabase: boolean;
  secret: boolean;
}

/**
 * Übernahme bestehender Umgebungsvariablen (§40).
 *
 * Diese Komponente sieht **keinen einzigen Wert** - und kann keinen sehen. Der
 * Server liefert nur Namen und die Auskunft «vorhanden»; die Übernahme
 * geschieht vollständig serverseitig: lesen, verschlüsseln, ablegen. Der
 * Browser erfährt danach nur, welche Felder übernommen wurden (§41).
 *
 * Ein bereits in der Datenbank stehender Wert wird nicht überschrieben (§42) -
 * er ist die neuere Entscheidung. Wer das doch will, bestätigt es ausdrücklich.
 */
export function EnvUebernahme({
  kandidaten,
  csrfToken,
}: {
  kandidaten: EnvKandidatAnzeige[];
  csrfToken: string;
}): React.JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [offen, setOffen] = useState<EnvKandidatAnzeige | null>(null);
  const [erledigt, setErledigt] = useState<string[]>([]);

  if (kandidaten.length === 0) {
    return null;
  }

  const uebernehmen = async (
    kandidat: EnvKandidatAnzeige,
    ueberschreiben: boolean,
  ): Promise<void> => {
    setPending(true);
    try {
      const antwort = await importEnvAction({
        csrfToken,
        felder: [{ integrationId: kandidat.integrationId, key: kandidat.key }],
        ueberschreiben,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Die Übernahme hat nicht geklappt.');
        return;
      }
      const daten = antwort.data as {
        uebernommen: string[];
        uebersprungen: string[];
        fehlgeschlagen: Array<{ feld: string; grund: string }>;
      };
      if (daten.uebernommen.length > 0) {
        setErledigt((bisher) => [...bisher, `${kandidat.integrationId}.${kandidat.key}`]);
        toast.success(`${kandidat.fieldLabel} übernommen.`);
      } else if (daten.uebersprungen.length > 0) {
        toast.info('Es steht bereits ein Wert in der Datenbank - nichts geändert.');
      } else {
        toast.error(daten.fehlgeschlagen[0]?.grund ?? 'Nichts übernommen.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Aus der Umgebung übernehmen"
      description="Gefundene Werte werden serverseitig gelesen, verschlüsselt und abgelegt. Der Browser bekommt sie nie zu sehen."
    >
      <ul className="space-y-2">
        {kandidaten.map((kandidat) => {
          const kennung = `${kandidat.integrationId}.${kandidat.key}`;
          const fertig = kandidat.inDatabase || erledigt.includes(kennung);
          return (
            <li
              key={kennung}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {kandidat.integrationLabel} → {kandidat.fieldLabel}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {kandidat.envKey} gefunden
                </p>
              </div>
              {fertig ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                    In der Datenbank
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setOffen(kandidat)}
                  >
                    Ersetzen
                  </Button>
                </div>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => void uebernehmen(kandidat, false)}>
                  <Download aria-hidden="true" />
                  Importieren
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-muted-foreground">
        Die Datei <code className="font-mono">.env</code> wird dabei nicht verändert. Was übernommen
        wurde, kann dort anschliessend von Hand entfernt werden - die Datenbank gewinnt ohnehin.
      </p>

      <ConfirmationDialog
        open={offen !== null}
        onOpenChange={(zustand) => !zustand && setOffen(null)}
        title="Vorhandenen Wert ersetzen?"
        description="In der Datenbank steht bereits ein Wert. Er wird durch den aus der Umgebung ersetzt - die bisherige Fassung ist danach nicht mehr wiederherstellbar."
        confirmLabel="Ersetzen"
        destructive
        onConfirm={async () => {
          if (offen) {
            await uebernehmen(offen, true);
            setOffen(null);
          }
        }}
      />
    </Panel>
  );
}
