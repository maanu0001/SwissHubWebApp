'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';

/**
 * Die eigene Levelkarte.
 *
 * Der Bereich erscheint nur, wenn der Betrachter die Berechtigung besitzt -
 * entschieden wird das auf dem Server, nicht hier. Diese Komponente kuemmert
 * sich um Auswahl, Vorschau und die beiden Aufrufe.
 */
export function CustomCardPanel({
  csrfToken,
  discordId,
  vorhanden,
  empfohlen,
  maxBytes,
}: {
  csrfToken: string;
  discordId: string;
  /** Hat diese Person bereits eine eigene Karte hinterlegt? */
  vorhanden: boolean;
  empfohlen: { width: number; height: number };
  maxBytes: number;
}): React.JSX.Element {
  const router = useRouter();
  const eingabe = useRef<HTMLInputElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [entfernen, setEntfernen] = useState(false);
  const [vorschau, setVorschau] = useState<string | null>(null);
  // Wechselt nach jedem Upload, damit der Browser das neue Bild holt.
  const [version, setVersion] = useState(0);

  async function hochladen(datei: File): Promise<void> {
    if (datei.size > maxBytes) {
      toast.error(`Die Datei ist zu gross (maximal ${Math.round(maxBytes / 1024 / 1024)} MB).`);
      return;
    }
    setLaeuft(true);
    const form = new FormData();
    form.set('csrfToken', csrfToken);
    form.set('image', datei);

    const antwort = await fetch('/api/level/custom-card', { method: 'POST', body: form });
    const daten = (await antwort.json()) as { ok: boolean; error?: { message: string } };
    if (daten.ok) {
      toast.success('Eigene Levelkarte gespeichert.');
      setVorschau(null);
      setVersion((wert) => wert + 1);
      router.refresh();
    } else {
      toast.error(daten.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(false);
  }

  async function loeschen(): Promise<void> {
    setLaeuft(true);
    const form = new FormData();
    form.set('csrfToken', csrfToken);
    const antwort = await fetch('/api/level/custom-card', { method: 'DELETE', body: form });
    const daten = (await antwort.json()) as { ok: boolean; error?: { message: string } };
    if (daten.ok) {
      toast.success('Eigene Levelkarte entfernt. Es gilt wieder die normale Karte.');
      setVorschau(null);
      setVersion((wert) => wert + 1);
      router.refresh();
    } else {
      toast.error(daten.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(false);
    setEntfernen(false);
  }

  const quelle = vorschau ?? (vorhanden ? `/api/level/custom-card/${discordId}?v=${version}` : null);

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div>
        <p className="text-sm font-semibold">Eigene Level-Card</p>
        <p className="text-xs text-muted-foreground">
          Empfohlen: {empfohlen.width} × {empfohlen.height} Pixel · PNG, JPG oder WEBP · maximal{' '}
          {Math.round(maxBytes / 1024 / 1024)} MB
        </p>
      </div>

      {quelle ? (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* Feste Seitenverhaeltnisse, `cover` gegen Verzerrung. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={quelle} alt="Eigene Level-Card" className="block aspect-[4/1] w-full object-cover" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Noch keine eigene Karte. Es gilt die normale Level-Card des Servers.
        </p>
      )}

      <input
        ref={eingabe}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(ereignis) => {
          const datei = ereignis.target.files?.[0];
          if (!datei) {
            return;
          }
          setVorschau(URL.createObjectURL(datei));
          void hochladen(datei);
          ereignis.target.value = '';
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={laeuft} onClick={() => eingabe.current?.click()}>
          <ImageUp className="size-4" aria-hidden="true" />
          Bild hochladen
        </Button>
        {vorhanden ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={laeuft}
            onClick={() => setEntfernen(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Entfernen
          </Button>
        ) : null}
      </div>

      <ConfirmationDialog
        open={entfernen}
        onOpenChange={setEntfernen}
        title="Eigene Level-Card entfernen?"
        description="Danach erscheint wieder die normale Level-Card des Servers."
        confirmLabel="Entfernen"
        destructive
        onConfirm={loeschen}
      />
    </div>
  );
}
