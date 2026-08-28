'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveAiSettingsAction } from '@/modules/integrations/actions';

export interface AiEinstellungenDaten {
  enabled: boolean;
  provider: 'anthropic' | 'openai';
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxTokens: number;
}

/**
 * Die nicht geheimen AI-Einstellungen.
 *
 * Der Schlüssel steht bewusst nicht in diesem Formular - er läuft über
 * `SecretFeld`, weil für ihn andere Regeln gelten (nie zurückladen, nie
 * anzeigen, eigene Berechtigung). Hier stehen nur Werte, die man gefahrlos
 * lesen, kopieren und in einem Fehlerbericht zeigen kann.
 *
 * Die Modellvorschläge kommen vom Server aus dem Katalog (§25): eine im
 * Frontend verteilte Modelliste veraltete beim ersten neuen Modell, und jedes
 * andere Modell wäre damit nicht mehr wählbar. Deshalb ein Freitextfeld mit
 * Vorschlagsliste statt einer Auswahl.
 */
export function AiEinstellungen({
  daten,
  vorschlaege,
  csrfToken,
  darfAendern,
}: {
  daten: AiEinstellungenDaten;
  vorschlaege: Record<'anthropic' | 'openai', string[]>;
  csrfToken: string;
  darfAendern: boolean;
}): React.JSX.Element {
  const [form, setForm] = useState(daten);
  const [pending, setPending] = useState(false);

  const speichern = async (): Promise<void> => {
    setPending(true);
    try {
      const antwort = await saveAiSettingsAction({ csrfToken, ...form });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Speichern hat nicht geklappt.');
        return;
      }
      toast.success('AI-Einstellungen gespeichert.');
    } finally {
      setPending(false);
    }
  };

  const liste = vorschlaege[form.provider] ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-4">
        <div className="min-w-0">
          <Label htmlFor="ai-enabled" className="text-sm font-medium">
            AI aktiviert
          </Label>
          <p className="text-xs text-muted-foreground">
            Aus: kein Modul fragt ein Modell an, unabhängig von seinen eigenen Einstellungen.
          </p>
        </div>
        <Switch
          id="ai-enabled"
          checked={form.enabled}
          disabled={!darfAendern || pending}
          onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ai-provider">Anbieter</Label>
          <select
            id="ai-provider"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={form.provider}
            disabled={!darfAendern || pending}
            onChange={(event) =>
              setForm({ ...form, provider: event.target.value as 'anthropic' | 'openai' })
            }
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-model">Modell</Label>
          <Input
            id="ai-model"
            list="ai-model-vorschlaege"
            value={form.model}
            disabled={!darfAendern || pending}
            onChange={(event) => setForm({ ...form, model: event.target.value })}
            className="font-mono"
          />
          <datalist id="ai-model-vorschlaege">
            {liste.map((modell) => (
              <option key={modell} value={modell} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ai-baseurl">Base URL</Label>
          <Input
            id="ai-baseurl"
            type="url"
            placeholder="Leer = Standardadresse des Anbieters"
            value={form.baseUrl}
            disabled={!darfAendern || pending}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Nur nötig für einen Proxy oder eine kompatible Gegenstelle. Muss https sein.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-timeout">Zeitlimit (ms)</Label>
          <Input
            id="ai-timeout"
            type="number"
            min={1000}
            max={120000}
            step={500}
            value={form.timeoutMs}
            disabled={!darfAendern || pending}
            onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-maxtokens">Max Tokens</Label>
          <Input
            id="ai-maxtokens"
            type="number"
            min={16}
            max={8192}
            step={16}
            value={form.maxTokens}
            disabled={!darfAendern || pending}
            onChange={(event) => setForm({ ...form, maxTokens: Number(event.target.value) })}
          />
          <p className="text-xs text-muted-foreground">Obergrenze je Antwort - begrenzt die Kosten.</p>
        </div>
      </div>

      {darfAendern ? (
        <Button disabled={pending} onClick={() => void speichern()}>
          <Save aria-hidden="true" />
          {pending ? 'Speichert ...' : 'Einstellungen speichern'}
        </Button>
      ) : null}
    </div>
  );
}
