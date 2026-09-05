'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { HerkunftBadge, Maske } from './shared';
import { deleteSecretAction, setSecretAction } from '@/modules/integrations/actions';

export interface SecretFeldDaten {
  key: string;
  label: string;
  description?: string;
  secret: boolean;
  required: boolean;
  configured: boolean;
  origin: 'database' | 'environment' | 'default' | 'missing';
  display: string | null;
  updatedAt: string | null;
  alsoInEnvironment: boolean;
}

/**
 * Ein Feld der Zugangsdatenverwaltung.
 *
 * Drei Dinge, die diese Komponente nicht tut und auch nicht kann:
 *
 * - **Sie lädt kein bestehendes Geheimnis in das Eingabefeld** (§11). Der Wert
 *   kommt gar nicht bis hierher; das Feld startet leer und bleibt leer, bis
 *   jemand etwas eintippt. Leer absenden ändert nichts.
 * - **Sie zeigt nie einen vollständigen Wert.** Was neben dem Feld steht, ist
 *   die Maske, die der Server gebildet hat.
 * - **Sie entscheidet nichts.** Berechtigung, Prüfung und Verschlüsselung
 *   liegen serverseitig; die Knöpfe hier sind Bequemlichkeit.
 *
 * `type="password"` und `autoComplete="off"` sind kein Schmuck: ohne sie böte
 * der Browser an, ein Bot-Token im Passwortspeicher abzulegen oder es beim
 * nächsten Formular automatisch einzusetzen (§68).
 */
export function SecretFeld({
  integrationId,
  feld,
  csrfToken,
  darfAendern,
}: {
  integrationId: string;
  feld: SecretFeldDaten;
  csrfToken: string;
  darfAendern: boolean;
}): React.JSX.Element {
  const [wert, setWert] = useState('');
  const [pending, setPending] = useState(false);
  const [anzeige, setAnzeige] = useState(feld);
  const [loeschDialog, setLoeschDialog] = useState(false);

  const speichern = async (): Promise<void> => {
    if (wert === '') {
      toast.info('Leer lassen ändert nichts. Für einen neuen Wert bitte eintippen.');
      return;
    }
    setPending(true);
    try {
      const ergebnis = await setSecretAction({ csrfToken, integrationId, key: feld.key, value: wert });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Speichern hat nicht geklappt.');
        return;
      }
      const daten = ergebnis.data as { ok: boolean; display?: string; fehler?: string };
      if (!daten.ok) {
        toast.error(daten.fehler ?? 'Der Wert wurde abgelehnt.');
        return;
      }
      // Der Eingabewert wird sofort verworfen - er soll nicht im
      // Komponentenzustand liegenbleiben.
      setWert('');
      setAnzeige({
        ...anzeige,
        configured: true,
        origin: 'database',
        display: daten.display ?? anzeige.display,
        updatedAt: new Date().toISOString(),
      });
      toast.success(`${feld.label} gespeichert.`);
    } finally {
      setPending(false);
    }
  };

  const entfernen = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await deleteSecretAction({ csrfToken, integrationId, key: feld.key });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Entfernen hat nicht geklappt.');
        return;
      }
      setAnzeige({ ...anzeige, configured: false, origin: 'missing', display: null, updatedAt: null });
      toast.success(`${feld.label} entfernt.`);
    } finally {
      setPending(false);
    }
  };

  const feldId = `${integrationId}-${feld.key}`;

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={feldId} className="text-sm font-medium">
          {feld.label}
          {feld.required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
        <div className="flex items-center gap-2">
          <HerkunftBadge origin={anzeige.origin} alsoInEnvironment={anzeige.alsoInEnvironment} />
          <Maske display={anzeige.display} konfiguriert={anzeige.configured} />
        </div>
      </div>

      {feld.description ? <p className="text-xs text-muted-foreground">{feld.description}</p> : null}

      {darfAendern ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={feldId}
            type={feld.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            value={wert}
            onChange={(event) => setWert(event.target.value)}
            placeholder={anzeige.configured ? 'Leer lassen = unverändert' : 'Wert eingeben'}
            className="min-w-0 flex-1 font-mono"
            disabled={pending}
          />
          <Button size="sm" disabled={pending || wert === ''} onClick={() => void speichern()}>
            <Save aria-hidden="true" />
            Speichern
          </Button>
          {anzeige.configured && anzeige.origin === 'database' ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-label={`${feld.label} entfernen`}
                onClick={() => setLoeschDialog(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              <ConfirmationDialog
                open={loeschDialog}
                onOpenChange={setLoeschDialog}
                title={`${feld.label} entfernen?`}
                description="Diese Integration funktioniert danach nicht mehr, bis ein neuer Wert hinterlegt ist."
                confirmLabel="Entfernen"
                destructive
                onConfirm={entfernen}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {anzeige.updatedAt ? (
        <p className="text-xs text-muted-foreground">
          Zuletzt geändert: {new Date(anzeige.updatedAt).toLocaleString('de-CH')}
        </p>
      ) : null}
    </div>
  );
}
