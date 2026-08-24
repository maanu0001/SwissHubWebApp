'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { setCustomFieldsAction } from '@/modules/tournaments/admin-actions';

export type FeldArt = 'SHORT_TEXT' | 'LONG_TEXT' | 'URL' | 'SELECT';

export interface Zusatzfeld {
  kind: FeldArt;
  label: string;
  description: string | null;
  placeholder: string | null;
  required: boolean;
  options: string[];
  maxLength: number | null;
}

const ARTEN: Array<{ wert: FeldArt; label: string }> = [
  { wert: 'SHORT_TEXT', label: 'Kurzer Text' },
  { wert: 'LONG_TEXT', label: 'Langer Text' },
  { wert: 'URL', label: 'Link' },
  { wert: 'SELECT', label: 'Auswahl' },
];

/**
 * Zusatzfragen bei der Anmeldung.
 *
 * Höchstens zehn - eine Anmeldung, die zwanzig Fragen stellt, füllt niemand
 * aus. Und nur, solange noch niemand geantwortet hat: Felder zu ersetzen, auf
 * die bereits Antworten zeigen, löschte die Antworten mit. Der Server lehnt
 * das ab; hier steht der Hinweis dazu.
 */
export function CustomFieldsAdmin({
  tournamentId,
  csrfToken,
  felder: anfang,
  gesperrt,
}: {
  tournamentId: string;
  csrfToken: string;
  felder: Zusatzfeld[];
  /** Es gibt bereits Antworten - dann lässt sich nichts mehr ändern. */
  gesperrt: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [felder, setFelder] = useState(anfang);
  const [laeuft, setLaeuft] = useState(false);

  function aendere(index: number, teil: Partial<Zusatzfeld>): void {
    setFelder(felder.map((feld, i) => (i === index ? { ...feld, ...teil } : feld)));
  }

  async function speichern(): Promise<void> {
    setLaeuft(true);
    const antwort = await setCustomFieldsAction({
      csrfToken,
      tournamentId,
      felder: felder.map((feld) => ({
        kind: feld.kind,
        label: feld.label.trim(),
        description: feld.description,
        placeholder: feld.placeholder,
        required: feld.required,
        options: feld.options,
        maxLength: feld.maxLength,
      })),
    });
    if (antwort.ok) {
      toast.success('Zusatzfragen gespeichert.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(false);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">Zusatzfragen bei der Anmeldung</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {gesperrt
            ? 'Es gibt bereits ausgefüllte Antworten. Die Fragen lassen sich nicht mehr ändern.'
            : 'Höchstens zehn. Sie erscheinen im Anmeldeformular auf der Turnierseite.'}
        </p>
      </div>

      {felder.map((feld, index) => (
        <div key={index} className="space-y-3 rounded-xl border border-border/60 p-4">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor={`feld-art-${index}`} className="text-xs">
                Art
              </Label>
              <select
                id={`feld-art-${index}`}
                value={feld.kind}
                disabled={gesperrt}
                onChange={(e) => aendere(index, { kind: e.target.value as FeldArt })}
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
              >
                {ARTEN.map((art) => (
                  <option key={art.wert} value={art.wert}>
                    {art.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`feld-label-${index}`} className="text-xs">
                Frage
              </Label>
              <Input
                id={`feld-label-${index}`}
                maxLength={80}
                disabled={gesperrt}
                value={feld.label}
                onChange={(e) => aendere(index, { label: e.target.value })}
                placeholder="Dein In-Game-Name"
              />
            </div>

            <div className="flex items-end pb-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={gesperrt}
                onClick={() => setFelder(felder.filter((_, i) => i !== index))}
                aria-label={`Frage ${index + 1} entfernen`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>

          {feld.kind === 'SELECT' ? (
            <div className="space-y-1">
              <Label htmlFor={`feld-optionen-${index}`} className="text-xs">
                Auswahlmöglichkeiten
              </Label>
              <Input
                id={`feld-optionen-${index}`}
                disabled={gesperrt}
                value={feld.options.join(', ')}
                onChange={(e) =>
                  aendere(index, {
                    options: e.target.value
                      .split(',')
                      .map((option) => option.trim())
                      .filter((option) => option !== '')
                      .slice(0, 25),
                  })
                }
                placeholder="Mit Komma getrennt"
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`feld-pflicht-${index}`} className="text-xs">
              Pflichtfeld
            </Label>
            <Switch
              id={`feld-pflicht-${index}`}
              checked={feld.required}
              disabled={gesperrt}
              onCheckedChange={(an) => aendere(index, { required: an })}
            />
          </div>
        </div>
      ))}

      {!gesperrt ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={felder.length >= 10}
            onClick={() =>
              setFelder([
                ...felder,
                {
                  kind: 'SHORT_TEXT',
                  label: '',
                  description: null,
                  placeholder: null,
                  required: false,
                  options: [],
                  maxLength: null,
                },
              ])
            }
          >
            <Plus aria-hidden="true" />
            Frage hinzufügen
          </Button>

          <Button
            type="button"
            disabled={laeuft || felder.some((feld) => feld.label.trim() === '')}
            onClick={() => void speichern()}
          >
            {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            Fragen speichern
          </Button>
        </div>
      ) : null}
    </section>
  );
}
