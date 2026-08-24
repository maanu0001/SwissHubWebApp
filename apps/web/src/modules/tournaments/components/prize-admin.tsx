'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import {
  deletePrizeAction,
  markPrizeDeliveredAction,
  upsertPrizeAction,
} from '@/modules/tournaments/admin-actions';

export interface PreisZeile {
  id: string;
  placement: number;
  title: string;
  description: string | null;
  value: string | null;
  sponsorName: string | null;
  sponsorUrl: string | null;
  status: string;
  gewinner: string | null;
}

const PREIS_STATUS: Record<string, string> = {
  PENDING: 'Offen',
  AWARDED: 'Vergeben',
  DELIVERED: 'Übergeben',
  CANCELLED: 'Entfallen',
};

/**
 * Die Preise eines Turniers.
 *
 * Ein Preis je Platzierung - das erzwingt die Datenbank, und es ist die
 * richtige Grenze: zwei Preise für denselben Platz wären eine Frage, keine
 * Antwort. Vergeben werden sie beim Abschluss des Turniers selbsttätig;
 * «übergeben» hakt die Leitung von Hand ab, weil nur sie es wissen kann.
 */
export function PrizeAdmin({
  tournamentId,
  csrfToken,
  preise,
  darfVerwalten,
}: {
  tournamentId: string;
  csrfToken: string;
  preise: PreisZeile[];
  darfVerwalten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [loeschen, setLoeschen] = useState<PreisZeile | null>(null);
  const [platz, setPlatz] = useState(preise.length + 1);
  const [titel, setTitel] = useState('');
  const [wert, setWert] = useState('');
  const [sponsor, setSponsor] = useState('');

  async function anlegen(): Promise<void> {
    setLaeuft('create');
    const antwort = await upsertPrizeAction({
      csrfToken,
      tournamentId,
      placement: platz,
      title: titel.trim(),
      value: wert.trim() === '' ? null : wert.trim(),
      sponsorName: sponsor.trim() === '' ? null : sponsor.trim(),
    });
    if (antwort.ok) {
      toast.success('Preis gespeichert.');
      setTitel('');
      setWert('');
      setSponsor('');
      setPlatz(platz + 1);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  async function uebergeben(preis: PreisZeile): Promise<void> {
    setLaeuft(preis.id);
    const antwort = await markPrizeDeliveredAction({ csrfToken, prizeId: preis.id });
    if (antwort.ok) {
      toast.success('Als übergeben vermerkt.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-6">
      {darfVerwalten ? (
        <form
          className="space-y-3 rounded-xl border border-border/60 p-4"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            void anlegen();
          }}
        >
          <p className="text-sm font-medium">Preis hinzufügen oder ändern</p>
          <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
            <div className="space-y-1">
              <Label htmlFor="preis-platz">Platz</Label>
              <Input
                id="preis-platz"
                type="number"
                min={1}
                max={64}
                value={platz}
                onChange={(e) => setPlatz(Number.parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preis-titel">Was gibt es?</Label>
              <Input
                id="preis-titel"
                required
                maxLength={120}
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                placeholder="Gaming-Maus"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="preis-wert">Wert</Label>
              <Input
                id="preis-wert"
                maxLength={120}
                value={wert}
                onChange={(e) => setWert(e.target.value)}
                placeholder="CHF 120 oder «Discord-Rolle»"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preis-sponsor">Gestiftet von</Label>
              <Input
                id="preis-sponsor"
                maxLength={120}
                value={sponsor}
                onChange={(e) => setSponsor(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={titel.trim() === '' || laeuft !== null}>
              {laeuft === 'create' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Speichern
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Ein bestehender Preis auf demselben Platz wird ersetzt.
          </p>
        </form>
      ) : null}

      {preise.length === 0 ? (
        <EmptyState
          title="Noch keine Preise"
          description="Ein Turnier braucht keine Preise - wenn es welche gibt, stehen sie hier und auf der öffentlichen Seite."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {preise.map((preis) => (
            <li key={preis.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs">
                {preis.placement}
              </span>
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">{preis.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {preis.value ? `${preis.value} · ` : ''}
                  {preis.sponsorName ? `von ${preis.sponsorName} · ` : ''}
                  {preis.gewinner ? `an ${preis.gewinner}` : 'noch offen'}
                </span>
              </span>
              <Badge variant={preis.status === 'DELIVERED' ? 'success' : 'secondary'}>
                {PREIS_STATUS[preis.status] ?? preis.status}
              </Badge>

              {darfVerwalten && preis.status === 'AWARDED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={laeuft !== null}
                  onClick={() => void uebergeben(preis)}
                >
                  {laeuft === preis.id ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  Übergeben
                </Button>
              ) : null}

              {darfVerwalten ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={laeuft !== null}
                  onClick={() => setLoeschen(preis)}
                  aria-label={`${preis.title} entfernen`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setLoeschen(null);
          }
        }}
        title={`${loeschen?.title ?? ''} entfernen?`}
        description="Der Preis verschwindet auch von der öffentlichen Turnierseite."
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await deletePrizeAction({ csrfToken, prizeId: loeschen.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Preis entfernt.');
          setLoeschen(null);
          router.refresh();
        }}
      />
    </div>
  );
}
