'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RotateCcw, Upload } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { resetBrandingLogoAction } from '@/modules/settings/actions';

/**
 * Logo verwalten.
 *
 * Vor dem Speichern zeigt eine Vorschau das Logo in den drei Umgebungen, in
 * denen es tatsächlich erscheint: Seitenleiste, Login-Karte und dunkler
 * Hintergrund. Ein zu helles oder zu grosses Logo fällt so vorher auf.
 */
const ACCEPTED = 'image/png,image/jpeg,image/webp';
const MAX_MB = 5;

export function BrandingForm({
  csrfToken,
  currentLogoUrl,
  hasCustomLogo,
  updatedAt,
  canManage,
}: {
  csrfToken: string;
  currentLogoUrl: string;
  hasCustomLogo: boolean;
  updatedAt: string | null;
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  function choose(selected: File | null): void {
    setError(null);
    if (!selected) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (selected.size > MAX_MB * 1024 * 1024) {
      setError(`Die Datei ist zu gross (maximal ${MAX_MB} MB).`);
      return;
    }
    if (!ACCEPTED.split(',').includes(selected.type)) {
      setError('Nur PNG, JPG und WEBP werden unterstützt.');
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  async function upload(): Promise<void> {
    if (!file || pending) {
      return;
    }
    setPending(true);
    setError(null);

    const body = new FormData();
    body.set('csrfToken', csrfToken);
    body.set('logo', file);

    try {
      const response = await fetch('/api/branding/upload', { method: 'POST', body });
      const result = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };

      if (result.ok) {
        toast.success('Logo wurde aktualisiert.');
        setFile(null);
        setPreview(null);
        if (inputRef.current) {
          inputRef.current.value = '';
        }
        router.refresh();
      } else {
        setError(result.error.message);
        toast.error(result.error.message);
      }
    } catch {
      setError('Der Upload ist fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  async function reset(): Promise<void> {
    const response = await resetBrandingLogoAction({ csrfToken });
    if (response.ok) {
      toast.success('Standardlogo wiederhergestellt.');
      setFile(null);
      setPreview(null);
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  const shown = preview ?? currentLogoUrl;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="branding-logo">Logo hochladen</Label>
        <input
          ref={inputRef}
          id="branding-logo"
          type="file"
          accept={ACCEPTED}
          disabled={!canManage || pending}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-secondary/80 disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          PNG, JPG oder WEBP, maximal {MAX_MB} MB. SVG wird bewusst nicht unterstützt - es kann Skripte
          enthalten.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vorschau{preview ? ' (noch nicht gespeichert)' : ''}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <PreviewTile label="Dunkler Hintergrund" className="bg-background">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="Logo-Vorschau" className="max-h-12 w-auto" />
          </PreviewTile>

          <PreviewTile label="Seitenleiste" className="bg-card">
            <span className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown} alt="" className="size-9 rounded-xl object-contain ring-1 ring-primary/40" />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">{branding.name}</span>
                <span className="text-xs text-muted-foreground">{branding.productName}</span>
              </span>
            </span>
          </PreviewTile>

          <PreviewTile label="Login-Karte" className="bg-card">
            <span className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown} alt="" className="max-h-10 w-auto" />
              <span className="text-xs text-muted-foreground">Mit Discord anmelden</span>
            </span>
          </PreviewTile>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={() => void upload()} loading={pending} disabled={!canManage || !file}>
          <Upload aria-hidden="true" />
          Logo speichern
        </Button>

        {hasCustomLogo ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={!canManage || pending}>
              <RotateCcw aria-hidden="true" />
              Standardlogo wiederherstellen
            </Button>
            <ConfirmationDialog
              open={confirmReset}
              onOpenChange={setConfirmReset}
              title="Standardlogo wiederherstellen?"
              description="Das hochgeladene Logo wird gelöscht und überall durch das mitgelieferte Standardlogo ersetzt."
              confirmLabel="Wiederherstellen"
              destructive
              onConfirm={reset}
            />
          </>
        ) : null}

        {updatedAt ? (
          <span className="text-xs text-muted-foreground">Zuletzt geändert: {updatedAt}</span>
        ) : null}
        {!canManage ? (
          <span className="text-xs text-muted-foreground">
            Zum Ändern wird die Berechtigung „Branding verwalten" benötigt.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PreviewTile({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div
        className={`grid min-h-[5.5rem] place-items-center rounded-lg border border-border p-4 ${className ?? ''}`}
      >
        {children}
      </div>
    </div>
  );
}
