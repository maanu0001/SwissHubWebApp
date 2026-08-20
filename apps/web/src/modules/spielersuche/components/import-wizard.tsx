'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Database, ShieldAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  confirmSpielersucheImportAction,
  discardSpielersucheImportAction,
} from '@/modules/spielersuche/actions';

/**
 * Schritt 1: Datei hochladen und analysieren.
 *
 * Die Analyse verändert nichts - sie liest die Datei, bewertet jede Zeile und
 * speichert nur das Ergebnis.
 */
export function ImportUploadStep({
  csrfToken,
  maxBytes,
}: {
  csrfToken: string;
  maxBytes: number;
}): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File): Promise<void> {
    setError(null);
    if (file.size > maxBytes) {
      setError(`Die Datei ist zu gross (maximal ${Math.round(maxBytes / 1024 / 1024)} MB).`);
      return;
    }

    setPending(true);
    const form = new FormData();
    form.append('csrfToken', csrfToken);
    form.append('database', file);

    try {
      const response = await fetch('/api/spielersuche/import', { method: 'POST', body: form });
      if (response.status === 413) {
        setError('Die Datei wurde vom Server abgewiesen, weil sie zu gross ist.');
        return;
      }
      const text = await response.text();
      let payload: { ok: boolean; data?: { importId: string }; error?: { message: string } };
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        setError('Der Server hat unerwartet geantwortet. Bitte Serverprotokoll prüfen.');
        return;
      }
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Die Datei konnte nicht gelesen werden.');
        return;
      }

      toast.success('Datei analysiert. Bitte die Vorschau prüfen.');
      router.push(`/spielersuche/import?id=${payload.data.importId}`);
      router.refresh();
    } catch {
      setError('Die Datei konnte nicht übertragen werden. Besteht noch eine Verbindung?');
    } finally {
      setPending(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" aria-hidden="true" />
          Alte Datenbank hochladen
        </CardTitle>
        <CardDescription>
          Wähle die Datei <code>matchmaking.db</code> des früheren Spielersuche-Bots. Sie wird ausschliesslich
          gelesen und nach der Analyse gelöscht. In diesem Schritt wird nichts übernommen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="legacy-matchmaking">Datei</Label>
          <input
            ref={inputRef}
            id="legacy-matchmaking"
            type="file"
            accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUpload(file);
              }
            }}
            className="block w-full cursor-pointer rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground hover:file:bg-primary-bright"
          />
          <p className="text-xs text-muted-foreground">
            Maximal {Math.round(maxBytes / 1024 / 1024)} MB. Die Originaldatei wird nicht verändert.
          </p>
        </div>

        {pending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Upload className="size-4 animate-pulse" aria-hidden="true" />
            Datei wird gelesen und analysiert …
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Der alte Bot darf während und nach dem Import nicht mehr laufen. Zwei aktive Bots würden doppelte
            Suchen, doppelte Rollen-Pings und doppelte Sprachkanäle erzeugen.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** Schritt 6: Übernahme bestätigen. */
export function ImportConfirmStep({
  csrfToken,
  importId,
  importableRows,
  conflictRows,
}: {
  csrfToken: string;
  importId: string;
  importableRows: number;
  conflictRows: number;
}): React.JSX.Element {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  const [applySettings, setApplySettings] = useState(false);
  const [pending, setPending] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  async function handleConfirm(): Promise<void> {
    if (!stopped || pending) {
      return;
    }
    setPending(true);
    const response = await confirmSpielersucheImportAction({
      csrfToken,
      importId,
      legacyBotStopped: true,
      applySettings,
    });

    if (response.ok) {
      const data = response.data;
      toast.success('Übernahme abgeschlossen.', {
        description: `${data.games} Spiele, ${data.matches} Suchen, ${data.usages} Nutzungen, ${data.voiceSessions} Voice-Sessions.`,
      });
      router.refresh();
    } else {
      toast.error(response.error.message);
      setPending(false);
    }
  }

  async function handleDiscard(): Promise<void> {
    setDiscarding(true);
    const response = await discardSpielersucheImportAction({ csrfToken, importId });
    if (response.ok) {
      toast.info('Analyse verworfen. Es wurde nichts übernommen.');
      router.push('/spielersuche/import');
      router.refresh();
    } else {
      toast.error(response.error.message);
      setDiscarding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Übernahme bestätigen</CardTitle>
        <CardDescription>
          {importableRows === 0
            ? 'Es gibt nichts zu übernehmen - alle Zeilen wurden bereits importiert oder übersprungen.'
            : `${importableRows} Zeilen werden übernommen. Discord wird dabei nicht angefasst.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conflictRows > 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {conflictRows} Zeile(n) werden übersprungen, weil es bereits einen gleichnamigen Eintrag gibt.
              Bestehende Daten werden nie überschrieben.
            </span>
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-secondary/30 px-3 py-2.5">
          <div className="min-w-0">
            <Label htmlFor="legacy-stopped" className="cursor-pointer">
              Der alte Spielersuche-Bot ist gestoppt
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Erforderlich. Laufen beide Bots gleichzeitig, entstehen doppelte Suchen und Pings.
            </p>
          </div>
          <Switch
            id="legacy-stopped"
            checked={stopped}
            onCheckedChange={setStopped}
            disabled={pending || importableRows === 0}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-secondary/30 px-3 py-2.5">
          <div className="min-w-0">
            <Label htmlFor="apply-settings" className="cursor-pointer">
              Konfiguration als Startwerte übernehmen
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Channel, Voice-Kategorie, Ablaufzeit und Farbe - nur, wenn die Channels auf Discord noch
              existieren. Danach bleibt das Dashboard massgeblich.
            </p>
          </div>
          <Switch
            id="apply-settings"
            checked={applySettings}
            onCheckedChange={setApplySettings}
            disabled={pending}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void handleConfirm()}
            loading={pending}
            disabled={!stopped || importableRows === 0}
          >
            Jetzt übernehmen
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleDiscard()}
            loading={discarding}
            disabled={pending}
          >
            Analyse verwerfen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
