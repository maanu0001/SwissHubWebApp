'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, FileKey, ShieldAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { confirmLevelImportAction, discardLevelImportAction } from '@/modules/level/actions';

/**
 * Schritt 1: `levels.db` hochladen und analysieren.
 *
 * Die Analyse verändert keinen XP-Stand - sie liest die Datei, bewertet jede
 * Zeile und speichert nur das Ergebnis.
 */
export function LevelImportUpload({
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
      const response = await fetch('/api/level/import', { method: 'POST', body: form });
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
      router.push(`/level/import?id=${payload.data.importId}`);
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
          levels.db hochladen
        </CardTitle>
        <CardDescription>
          Die Datei wird nur gelesen und danach wieder gelöscht. Übernommen wird erst im nächsten Schritt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".db,.sqlite,.sqlite3,application/octet-stream"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleUpload(file);
            }
          }}
        />
        <Button disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden="true" />
          {pending ? 'Wird gelesen…' : 'Datei auswählen'}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

export interface ImportSummary {
  importId: string;
  fileName: string;
  counts: { total: number; importable: number; duplicate: number; invalid: number; empty: number };
  totalXp: number;
  highestLevel: number;
  rows: Array<{ legacyKey: string; label: string; action: string; note: string | null; kind: string }>;
}

const ACTION_LABELS: Record<string, string> = {
  IMPORT: 'Wird übernommen',
  SKIP_DUPLICATE: 'Schon übernommen',
  SKIP_INVALID: 'Unbrauchbar',
  SKIP_EMPTY: 'Leer',
  CONFLICT: 'Konflikt',
};

/** Schritt 2: Vorschau prüfen und bestätigen. */
export function LevelImportConfirm({
  csrfToken,
  summary,
}: {
  csrfToken: string;
  summary: ImportSummary;
}): React.JSX.Element {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  const [importSettings, setImportSettings] = useState(true);
  const [pending, setPending] = useState(false);

  const confirm = async (): Promise<void> => {
    if (!stopped) {
      toast.error('Bitte zuerst bestätigen, dass der alte Level-Bot abgeschaltet ist.');
      return;
    }
    setPending(true);
    const response = await confirmLevelImportAction({
      csrfToken,
      importId: summary.importId,
      legacyBotStopped: true,
      importSettings,
    });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }
    const { imported, failed, totalXp, settingsError } = response.data;
    toast.success(`${imported} Einträge übernommen (${totalXp} XP).`);
    if (failed > 0) {
      toast.error(`${failed} Einträge konnten nicht übernommen werden.`);
    }
    if (settingsError) {
      toast.error(`Einstellungen nicht gespeichert: ${settingsError}`);
    }
    router.push('/level/import');
    router.refresh();
  };

  const discard = async (): Promise<void> => {
    setPending(true);
    const response = await discardLevelImportAction({ csrfToken, importId: summary.importId });
    setPending(false);
    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }
    toast.success('Übernahme verworfen.');
    router.push('/level/import');
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vorschau: {summary.fileName}</CardTitle>
        <CardDescription>
          {summary.counts.importable} von {summary.counts.total} Einträgen werden übernommen - zusammen{' '}
          {summary.totalXp} XP, höchstes Level {summary.highestLevel}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Wird übernommen', value: summary.counts.importable },
            { label: 'Schon übernommen', value: summary.counts.duplicate },
            { label: 'Leer', value: summary.counts.empty },
            { label: 'Unbrauchbar', value: summary.counts.invalid },
          ].map((figure) => (
            <div key={figure.label} className="rounded-lg border border-border bg-card/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{figure.value}</dd>
            </div>
          ))}
        </dl>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          <ul className="divide-y divide-border text-sm">
            {summary.rows.slice(0, 200).map((row) => (
              <li key={row.legacyKey} className="flex items-center gap-3 px-3 py-2">
                <Badge variant="secondary" className="shrink-0">
                  {ACTION_LABELS[row.action] ?? row.action}
                </Badge>
                <div className="min-w-0">
                  <p className="truncate">{row.label}</p>
                  {row.note ? <p className="truncate text-xs text-muted-foreground">{row.note}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
          <p className="flex items-start gap-2 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              Der alte Level-Bot muss abgeschaltet sein. Läuft er weiter, vergeben zwei Bots gleichzeitig XP
              und die übernommenen Stände sind sofort wieder falsch.
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Switch id="legacy-stopped" checked={stopped} onCheckedChange={setStopped} />
            <Label htmlFor="legacy-stopped">Der alte Level-Bot ist abgeschaltet</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="import-settings" checked={importSettings} onCheckedChange={setImportSettings} />
            <Label htmlFor="import-settings">
              Einstellungen mit übernehmen (XP-Boost, Channels ohne XP, Voice-Regeln)
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !stopped} onClick={() => void confirm()}>
            {pending ? 'Läuft…' : 'Jetzt übernehmen'}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => void discard()}>
            Verwerfen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface EnvPreview {
  settings: Array<{ key: string; label: string; display: string; valid: boolean; note?: string }>;
  milestones: Array<{ level: number; roleId: string }>;
  ignoredKeys: number;
  applicable: number;
}

/**
 * Übernahme einzelner Werte aus der alten `.env`.
 *
 * Gelesen wird ausschliesslich, was auf der Positivliste des Moduls steht.
 * Zugangsdaten wie `BOT_TOKEN` oder `DATABASE_URL` erscheinen deshalb gar
 * nicht erst in dieser Vorschau.
 */
export function LevelEnvImport({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EnvPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (chosen: File, apply: boolean): Promise<void> => {
    setError(null);
    setPending(true);

    const form = new FormData();
    form.append('csrfToken', csrfToken);
    form.append('env', chosen);
    form.append('apply', apply ? 'true' : 'false');
    if (apply) {
      form.append('keys', [...selected].join(','));
    }

    try {
      const response = await fetch('/api/level/env', { method: 'POST', body: form });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: EnvPreview & { applied?: string[]; milestones?: number };
        error?: { message: string };
      };
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Die Datei konnte nicht gelesen werden.');
        return;
      }

      if (apply) {
        toast.success(
          `${payload.data.applied?.length ?? 0} Einstellungen übernommen` +
            (payload.data.milestones ? `, ${payload.data.milestones} Level-Rollen angelegt.` : '.'),
        );
        setPreview(null);
        setFile(null);
        router.refresh();
        return;
      }

      setPreview(payload.data);
      setSelected(new Set(payload.data.settings.filter((entry) => entry.valid).map((entry) => entry.key)));
    } catch {
      setError('Die Datei konnte nicht übertragen werden.');
    } finally {
      setPending(false);
    }
  };

  const toggle = (key: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileKey className="size-4" aria-hidden="true" />
          Einstellungen aus der alten .env
        </CardTitle>
        <CardDescription>
          Es wird ausschliesslich gelesen, was zum Level-System gehört. Zugangsdaten wie{' '}
          <code className="font-mono text-xs">BOT_TOKEN</code>,{' '}
          <code className="font-mono text-xs">AUTH_SECRET</code>,{' '}
          <code className="font-mono text-xs">DATABASE_URL</code> und{' '}
          <code className="font-mono text-xs">REDIS_URL</code> werden nicht ausgewertet und tauchen hier nicht
          auf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".env,text/plain"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) {
              setFile(chosen);
              void send(chosen, false);
            }
          }}
        />

        {preview === null ? (
          <Button variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            {pending ? 'Wird gelesen…' : '.env auswählen'}
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {preview.applicable} übernehmbare Werte gefunden. {preview.ignoredKeys} weitere Einträge wurden
              nicht ausgewertet.
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {preview.settings.map((entry) => (
                <li key={entry.key} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`env-${entry.key}`}
                    checked={selected.has(entry.key)}
                    disabled={!entry.valid}
                    onChange={() => toggle(entry.key)}
                    className="size-4"
                  />
                  <label htmlFor={`env-${entry.key}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{entry.label}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {entry.key} = {entry.display}
                    </span>
                    {entry.note ? <span className="block text-xs text-destructive">{entry.note}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || selected.size === 0 || file === null}
                onClick={() => file && void send(file, true)}
              >
                {pending ? 'Läuft…' : `${selected.size} Werte übernehmen`}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
              >
                Abbrechen
              </Button>
            </div>
          </>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
