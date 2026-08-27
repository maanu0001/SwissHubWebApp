'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, UserMinus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { removeRegistrationAction } from '@/modules/calendar/actions';

export interface TeilnehmerZeile {
  id: string;
  discordId: string;
  name: string;
  status: 'CONFIRMED' | 'WAITLIST' | 'CANCELLED';
  waitlistPosition: number | null;
  registeredAt: string;
  promoted: boolean;
  answers: Array<{ question: string; value: string }>;
}

const STATUS_TEXT: Record<TeilnehmerZeile['status'], string> = {
  CONFIRMED: 'Angemeldet',
  WAITLIST: 'Warteliste',
  CANCELLED: 'Abgemeldet',
};

/**
 * Teilnehmerliste mit Entfernen und CSV-Export.
 *
 * Der Export entsteht im Browser aus den bereits geladenen Zeilen - es
 * braucht keinen zweiten Endpunkt, der dieselbe Berechtigung noch einmal
 * pruefen muesste.
 */
export function TeilnehmerListe({
  csrfToken,
  darfVerwalten,
  eventTitel,
  zeilen,
}: {
  csrfToken: string;
  darfVerwalten: boolean;
  eventTitel: string;
  zeilen: TeilnehmerZeile[];
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [entfernen, setEntfernen] = useState<TeilnehmerZeile | null>(null);
  const [grund, setGrund] = useState('');

  const spalten = [...new Set(zeilen.flatMap((zeile) => zeile.answers.map((a) => a.question)))];

  const exportiere = (): void => {
    const kopf = ['Name', 'Discord-ID', 'Status', 'Wartelistenplatz', 'Angemeldet am', ...spalten];
    const zellen = zeilen.map((zeile) => [
      zeile.name,
      zeile.discordId,
      STATUS_TEXT[zeile.status],
      zeile.waitlistPosition === null ? '' : String(zeile.waitlistPosition),
      new Date(zeile.registeredAt).toISOString(),
      ...spalten.map(
        (spalte) => zeile.answers.find((a) => a.question === spalte)?.value ?? '',
      ),
    ]);
    // Anfuehrungszeichen verdoppeln, alles einschliessen: sonst zerlegt ein
    // Komma in einer Antwort die Zeile.
    const csv = [kopf, ...zellen]
      .map((zeile) => zeile.map((wert) => `"${wert.replace(/"/gu, '""')}"`).join(','))
      .join('\r\n');

    // Byte Order Mark voran: ohne sie zeigt Excel Umlaute als Buchstabensalat.
    // Als Escape geschrieben - ein unsichtbares Zeichen im Quelltext waere
    // eine Falle fuer den naechsten Leser.
    const BOM = '\uFEFF';
    const blob = new Blob([`${BOM}${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `teilnehmer-${eventTitel.replace(/[^a-z0-9]/giu, '-').toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" onClick={exportiere}>
          <Download aria-hidden="true" />
          CSV exportieren
        </Button>
      </div>

      <div className="space-y-2">
        {zeilen.map((zeile) => (
          <div
            key={zeile.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{zeile.name}</p>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat('de-CH', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(zeile.registeredAt))}
                {zeile.promoted ? ' · nachgerückt' : ''}
              </p>
            </div>

            <Badge
              variant="outline"
              className={
                zeile.status === 'CONFIRMED'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : zeile.status === 'WAITLIST'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                    : 'border-border bg-muted text-muted-foreground'
              }
            >
              {STATUS_TEXT[zeile.status]}
              {zeile.waitlistPosition ? ` ${zeile.waitlistPosition}` : ''}
            </Badge>

            {zeile.answers.length > 0 ? (
              <span className="w-full text-xs text-muted-foreground sm:w-auto">
                {zeile.answers.map((a) => `${a.question}: ${a.value}`).join(' · ')}
              </span>
            ) : null}

            {darfVerwalten && zeile.status !== 'CANCELLED' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                aria-label={`${zeile.name} entfernen`}
                onClick={() => {
                  setEntfernen(zeile);
                  setGrund('');
                }}
              >
                <UserMinus aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <ConfirmationDialog
        open={entfernen !== null}
        onOpenChange={(offen) => !offen && setEntfernen(null)}
        title="Teilnahme entfernen?"
        description={
          entfernen?.status === 'CONFIRMED'
            ? 'Der Platz wird frei - die erste Person auf der Warteliste rückt automatisch nach.'
            : 'Die Person wird von der Warteliste genommen; die übrigen rücken auf.'
        }
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!entfernen) {
            return;
          }
          setPending(true);
          try {
            const ergebnis = await removeRegistrationAction({
              csrfToken,
              registrationId: entfernen.id,
              reason: grund || undefined,
            });
            if (!ergebnis.ok) {
              toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
              throw new Error('fehlgeschlagen');
            }
            toast.success(
              ergebnis.data?.nachgerueckt
                ? 'Entfernt - eine Person ist nachgerückt.'
                : 'Teilnahme entfernt.',
            );
            setEntfernen(null);
            router.refresh();
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="entfernenGrund">Grund (optional)</Label>
          <Input
            id="entfernenGrund"
            value={grund}
            maxLength={300}
            onChange={(event) => setGrund(event.target.value)}
          />
        </div>
      </ConfirmationDialog>
    </>
  );
}
