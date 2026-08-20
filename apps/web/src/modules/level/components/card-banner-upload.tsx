'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImageOff, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Hintergrundbild einer Levelkarte hochladen.
 *
 * Der Vorgänger hatte die Bilder als Dateien neben dem Code liegen. Sie hier
 * hochzuladen ist der nächstliegende Ersatz: es braucht keinen Ort im Netz,
 * an dem die Bilder dauerhaft erreichbar bleiben müssen.
 */
export function CardBannerUpload({
  csrfToken,
  slot,
  label,
  hint,
  recommended,
  current,
  canManage,
}: {
  csrfToken: string;
  slot: 'normal' | 'prestige';
  label: string;
  hint: string;
  recommended: { width: number; height: number };
  /** Adresse des vorhandenen Bilds inklusive Version, `null` = keines. */
  current: string | null;
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  const send = async (method: 'POST' | 'DELETE', file?: File): Promise<void> => {
    setPending(true);
    const form = new FormData();
    form.append('csrfToken', csrfToken);
    form.append('slot', slot);
    if (file) {
      form.append('image', file);
    }

    try {
      const response = await fetch('/api/level/card-banner', { method, body: form });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.error(payload.error?.message ?? 'Das Bild konnte nicht gespeichert werden.');
        return;
      }
      toast.success(method === 'POST' ? `${label} aktualisiert.` : `${label} entfernt.`);
      router.refresh();
    } catch {
      toast.error('Die Datei konnte nicht übertragen werden.');
    } finally {
      setPending(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Empfohlen: {recommended.width} × {recommended.height} Pixel · PNG, JPG oder WEBP
        </p>
      </div>

      <div
        className="overflow-hidden rounded-lg border border-border bg-muted"
        style={{ aspectRatio: `${recommended.width} / ${recommended.height}` }}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- Route Handler, keine statische Datei.
          <img src={current} alt={`${label} – Vorschau`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="size-5" aria-hidden="true" />
            <span className="text-xs">Kein Bild hinterlegt</span>
          </div>
        )}
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void send('POST', file);
              }
            }}
          />
          <Button size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            {pending ? 'Läuft…' : current ? 'Ersetzen' : 'Hochladen'}
          </Button>
          {current ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => void send('DELETE')}>
              <Trash2 aria-hidden="true" />
              Entfernen
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
