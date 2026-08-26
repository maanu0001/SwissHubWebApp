'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface PeriodPickerProps {
  aktiv: string;
  von: string;
  bis: string;
  /** Beschriftung des Vergleichszeitraums - oder `null`, wenn es keinen gibt. */
  vergleich: string | null;
}

const VORGABEN = [
  { id: '24h', label: '24 Stunden' },
  { id: '7d', label: '7 Tage' },
  { id: '30d', label: '30 Tage' },
  { id: '90d', label: '90 Tage' },
  { id: '1y', label: '1 Jahr' },
  { id: 'all', label: 'Gesamt' },
] as const;

/**
 * Zeitraumauswahl.
 *
 * Der gewählte Zeitraum steht in der Adresszeile, nicht im Zustand der
 * Komponente: eine Statistik zu einem bestimmten Monat bleibt dadurch teilbar
 * und übersteht das Neuladen.
 */
export function PeriodPicker({ aktiv, von, bis, vergleich }: PeriodPickerProps): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(aktiv === 'custom');
  const [vonWert, setVonWert] = useState(von);
  const [bisWert, setBisWert] = useState(bis);

  function waehle(id: string): void {
    router.push(id === '30d' ? '/analytics/statistik' : `/analytics/statistik?zeitraum=${id}`);
  }

  function eigenerZeitraum(): void {
    if (!vonWert || !bisWert) {
      return;
    }
    const parameter = new URLSearchParams({ zeitraum: 'custom', von: vonWert, bis: bisWert });
    router.push(`/analytics/statistik?${parameter.toString()}`);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {VORGABEN.map((vorgabe) => (
          <button
            key={vorgabe.id}
            type="button"
            onClick={() => waehle(vorgabe.id)}
            aria-pressed={aktiv === vorgabe.id}
            className={cn(
              'inline-flex min-h-9 items-center rounded-lg border px-3 text-sm transition-colors',
              aktiv === vorgabe.id
                ? 'border-primary/40 bg-primary/15 font-medium text-primary-bright'
                : 'border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
            )}
          >
            {vorgabe.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOffen((wert) => !wert)}
          aria-expanded={offen}
          aria-pressed={aktiv === 'custom'}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
            aktiv === 'custom'
              ? 'border-primary/40 bg-primary/15 font-medium text-primary-bright'
              : 'border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
          )}
        >
          <CalendarRange className="size-4" aria-hidden="true" />
          Benutzerdefiniert
        </button>
      </div>

      {offen ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            eigenerZeitraum();
          }}
        >
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="zeitraum-von">Von</Label>
            <Input
              id="zeitraum-von"
              type="date"
              value={vonWert}
              onChange={(event) => setVonWert(event.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="zeitraum-bis">Bis</Label>
            <Input
              id="zeitraum-bis"
              type="date"
              value={bisWert}
              onChange={(event) => setBisWert(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            Anwenden
          </Button>
        </form>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {vergleich
          ? `Verglichen mit dem gleich langen Zeitraum davor: ${vergleich}.`
          : 'Für diesen Zeitraum gibt es keinen Vergleich - davor wurde noch nicht gezählt.'}
      </p>
    </div>
  );
}
