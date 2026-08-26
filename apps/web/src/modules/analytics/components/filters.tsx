'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CATEGORIES, CATEGORY_LABEL } from '@/modules/analytics/labels';
import { cn } from '@/lib/utils';

interface AnalyticsFiltersProps {
  kategorie: string;
  akteur: string;
  betroffen: string;
  suche: string;
  von: string;
  bis: string;
  /** Darf der Betrachter Nachrichteninhalte sehen? Ändert nur den Hinweistext. */
  mitInhalten: boolean;
  /** Zusätzliche Schaltfläche rechts, z.B. der CSV-Export. */
  aktion?: React.ReactNode;
}

const ALLE = 'alle';

/**
 * Filter der Zeitleiste.
 *
 * Die Werte stehen in der Adresszeile, nicht im Zustand der Komponente: eine
 * gefilterte Ansicht bleibt teilbar und übersteht das Neuladen. Der Cursor
 * wird beim Filtern absichtlich fallen gelassen - er gehörte zur alten
 * Auswahl und zeigte sonst auf eine Stelle, die es in der neuen nicht gibt.
 */
export function AnalyticsFilters(props: AnalyticsFiltersProps): React.JSX.Element {
  const router = useRouter();
  const [kategorie, setKategorie] = useState(props.kategorie || ALLE);
  const [akteur, setAkteur] = useState(props.akteur);
  const [betroffen, setBetroffen] = useState(props.betroffen);
  const [suche, setSuche] = useState(props.suche);
  const [von, setVon] = useState(props.von);
  const [bis, setBis] = useState(props.bis);

  const gefiltert = Boolean(
    props.kategorie || props.akteur || props.betroffen || props.suche || props.von || props.bis,
  );

  function anwenden(): void {
    const parameter = new URLSearchParams();
    if (kategorie && kategorie !== ALLE) {
      parameter.set('kategorie', kategorie);
    }
    for (const [schluessel, wert] of [
      ['akteur', akteur],
      ['betroffen', betroffen],
      ['suche', suche],
      ['von', von],
      ['bis', bis],
    ] as const) {
      if (wert.trim()) {
        parameter.set(schluessel, wert.trim());
      }
    }
    const abfrage = parameter.toString();
    router.push(abfrage ? `/analytics?${abfrage}` : '/analytics');
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        anwenden();
      }}
    >
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="analytics-kategorie">Kategorie</Label>
          <select
            id="analytics-kategorie"
            value={kategorie}
            onChange={(event) => setKategorie(event.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value={ALLE}>Alle</option>
            {CATEGORIES.map((wert) => (
              <option key={wert} value={wert}>
                {CATEGORY_LABEL[wert]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="analytics-suche">Suche</Label>
          <Input
            id="analytics-suche"
            value={suche}
            onChange={(event) => setSuche(event.target.value)}
            placeholder="Name, Kanal oder ID"
          />
          <p className="text-xs text-muted-foreground">
            {props.mitInhalten
              ? 'Durchsucht auch Nachrichtentexte.'
              : 'Durchsucht Namen und Kanäle - nicht die Nachrichtentexte.'}
          </p>
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="analytics-akteur">Ausgelöst von (ID)</Label>
          <Input
            id="analytics-akteur"
            value={akteur}
            inputMode="numeric"
            onChange={(event) => setAkteur(event.target.value)}
            placeholder="Discord-ID"
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="analytics-betroffen">Betroffen (ID)</Label>
          <Input
            id="analytics-betroffen"
            value={betroffen}
            inputMode="numeric"
            onChange={(event) => setBetroffen(event.target.value)}
            placeholder="Discord-ID"
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="analytics-von">Von</Label>
          <Input
            id="analytics-von"
            type="date"
            value={von}
            onChange={(event) => setVon(event.target.value)}
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="analytics-bis">Bis</Label>
          <Input
            id="analytics-bis"
            type="date"
            value={bis}
            onChange={(event) => setBis(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline">
          <Filter aria-hidden="true" />
          Filtern
        </Button>
        {gefiltert ? (
          <a
            href="/analytics"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            aria-label="Filter zurücksetzen"
          >
            <X aria-hidden="true" />
            Zurücksetzen
          </a>
        ) : null}
        {props.aktion ? <span className="ml-auto">{props.aktion}</span> : null}
      </div>
    </form>
  );
}
