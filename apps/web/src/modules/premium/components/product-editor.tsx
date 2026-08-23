'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { updateProductAction } from '@/modules/premium/actions';

const ANSPRUECHE = [
  { wert: 'PREMIUM_ROLE', label: 'Premium-Rolle' },
  { wert: 'PREMIUM_STUEBLI_ROLE', label: 'Premium-Stübli-Rolle' },
  { wert: 'PRIVATE_VOICE', label: 'Eigener Sprachkanal' },
] as const;

export interface ProductFormValue {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  features: string[];
  entitlements: string[];
  active: boolean;
  sortOrder: number;
  providerPriceId: string | null;
}

/**
 * Angebot bearbeiten.
 *
 * Der Preis wird in Franken eingegeben und sofort in Rappen umgerechnet -
 * gespeichert wird ausschliesslich die ganze Zahl.
 */
export function ProductEditor({
  product,
  csrfToken,
}: {
  product: ProductFormValue;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wert, setWert] = useState({
    ...product,
    preisFranken: (product.priceMinor / 100).toFixed(2),
    merkmale: product.features.join('\n'),
    providerPriceId: product.providerPriceId ?? '',
  });

  async function speichern(): Promise<void> {
    setError(null);
    const rappen = Math.round(Number.parseFloat(wert.preisFranken.replace(',', '.')) * 100);
    if (!Number.isFinite(rappen) || rappen < 0) {
      setError('Bitte einen gültigen Preis angeben.');
      return;
    }

    setPending(true);
    const response = await updateProductAction({
      csrfToken,
      productId: product.id,
      name: wert.name.trim(),
      description: wert.description.trim(),
      priceMinor: rappen,
      features: wert.merkmale.split('\n').map((z) => z.trim()).filter(Boolean),
      entitlements: wert.entitlements as never,
      active: wert.active,
      sortOrder: wert.sortOrder,
      providerPriceId: wert.providerPriceId.trim() || undefined,
    });

    if (response.ok) {
      toast.success('Das Angebot wurde gespeichert.');
      setOpen(false);
      router.refresh();
    } else {
      setError(response.error.message);
      toast.error(response.error.message);
    }
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Pencil aria-hidden="true" />
          Bearbeiten
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product.name} bearbeiten</DialogTitle>
          <DialogDescription>
            Änderungen wirken sofort auf der öffentlichen Premium-Seite.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`name-${product.id}`}>Name</Label>
            <Input
              id={`name-${product.id}`}
              value={wert.name}
              onChange={(e) => setWert({ ...wert, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`beschreibung-${product.id}`}>Beschreibung</Label>
            <Input
              id={`beschreibung-${product.id}`}
              value={wert.description}
              onChange={(e) => setWert({ ...wert, description: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`preis-${product.id}`}>Preis in CHF pro Monat</Label>
              <Input
                id={`preis-${product.id}`}
                inputMode="decimal"
                value={wert.preisFranken}
                onChange={(e) => setWert({ ...wert, preisFranken: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`reihenfolge-${product.id}`}>Reihenfolge</Label>
              <Input
                id={`reihenfolge-${product.id}`}
                type="number"
                value={wert.sortOrder}
                onChange={(e) => setWert({ ...wert, sortOrder: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`merkmale-${product.id}`}>Vorteile - eine Zeile je Punkt</Label>
            <textarea
              id={`merkmale-${product.id}`}
              rows={5}
              value={wert.merkmale}
              onChange={(e) => setWert({ ...wert, merkmale: e.target.value })}
              className="w-full rounded-lg border border-border bg-card/70 p-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Ansprüche</legend>
            <p className="text-xs text-muted-foreground">
              Bestimmen, was auf Discord vergeben wird. Eine feste Auswahl - Discord-Berechtigungen
              lassen sich hier bewusst nicht frei eintragen.
            </p>
            {ANSPRUECHE.map((anspruch) => (
              <label key={anspruch.wert} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={wert.entitlements.includes(anspruch.wert)}
                  onChange={(e) =>
                    setWert({
                      ...wert,
                      entitlements: e.target.checked
                        ? [...wert.entitlements, anspruch.wert]
                        : wert.entitlements.filter((eintrag) => eintrag !== anspruch.wert),
                    })
                  }
                  className="size-4 rounded border-border"
                />
                {anspruch.label}
              </label>
            ))}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={`preisid-${product.id}`}>Preis-ID des Zahlungsanbieters</Label>
            <Input
              id={`preisid-${product.id}`}
              placeholder="price_..."
              value={wert.providerPriceId}
              onChange={(e) => setWert({ ...wert, providerPriceId: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Ohne diese ID lässt sich für das Angebot kein Checkout starten.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label htmlFor={`aktiv-${product.id}`}>Auf der Premium-Seite anbieten</Label>
            <Switch
              id={`aktiv-${product.id}`}
              checked={wert.active}
              onCheckedChange={(next) => setWert({ ...wert, active: next })}
            />
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button onClick={speichern} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
