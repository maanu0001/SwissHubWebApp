'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { calendar } from '@swisshub/modules';

type Query = Awaited<ReturnType<typeof calendar.calendarQuerySchema.parse>>;

/**
 * Zeitraumnavigation und Filter.
 *
 * Der gesamte Zustand steht in der Adresse - damit laesst sich ein Monat
 * verlinken, der Zurueck-Knopf funktioniert, und ein Neuladen zeigt dasselbe.
 * Ein Zustand im Arbeitsspeicher haette keine dieser Eigenschaften.
 *
 * Auf dem Telefon liegen die Filter hinter einem Knopf: sonst fuellen sie den
 * halben Bildschirm, ehe der erste Termin zu sehen ist.
 */
export function KalenderFilter({
  query,
  kategorien,
  titel,
  vorherAnchor,
  nachherAnchor,
}: {
  query: Query;
  kategorien: Array<{ id: string; name: string; color: string }>;
  titel: string;
  vorherAnchor: string;
  nachherAnchor: string;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState(query.search ?? '');

  const gehe = (aenderungen: Record<string, string | null>): void => {
    const naechste = new URLSearchParams(params.toString());
    for (const [schluessel, wert] of Object.entries(aenderungen)) {
      if (wert === null || wert === '') {
        naechste.delete(schluessel);
      } else {
        naechste.set(schluessel, wert);
      }
    }
    startTransition(() => {
      router.push(`/kalender?${naechste.toString()}`);
    });
  };

  const aktiveFilter =
    (query.categoryId ? 1 : 0) +
    (query.mine ? 1 : 0) +
    (query.withRegistration ? 1 : 0) +
    (query.withFreeSeats ? 1 : 0) +
    (query.search ? 1 : 0);

  const Umschalter = ({
    an,
    label,
    onClick,
  }: {
    an: boolean;
    label: string;
    onClick: () => void;
  }): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={an}
      className={cn(
        'min-h-9 rounded-lg border px-3 text-sm transition-colors',
        an
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Vorheriger Zeitraum"
            disabled={pending}
            onClick={() => gehe({ anchor: vorherAnchor })}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => gehe({ anchor: null })}>
            Heute
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Nächster Zeitraum"
            disabled={pending}
            onClick={() => gehe({ anchor: nachherAnchor })}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{titel}</h2>

        {/* Die Ansichtsumschaltung wirkt nur auf grossen Bildschirmen - auf
            dem Telefon wird ohnehin immer die Agenda gezeigt. */}
        <div className="hidden rounded-lg border border-border p-0.5 md:flex">
          {(
            [
              ['month', 'Monat'],
              ['week', 'Woche'],
              ['agenda', 'Liste'],
            ] as const
          ).map(([wert, label]) => (
            <button
              key={wert}
              type="button"
              onClick={() => gehe({ view: wert })}
              aria-current={query.view === wert}
              className={cn(
                'min-h-8 rounded-md px-3 text-sm transition-colors',
                query.view === wert
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          className="md:hidden"
          onClick={() => setOffen((wert) => !wert)}
          aria-expanded={offen}
        >
          <SlidersHorizontal aria-hidden="true" />
          Filter
          {aktiveFilter > 0 ? (
            <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {aktiveFilter}
            </span>
          ) : null}
        </Button>
      </div>

      <div className={cn('space-y-3', offen ? 'block' : 'hidden md:block')}>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            gehe({ search: suche.trim() || null });
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={suche}
              onChange={(event) => setSuche(event.target.value)}
              placeholder="Event suchen ..."
              aria-label="Events durchsuchen"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Suchen
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          <Umschalter
            an={query.mine}
            label="Meine Events"
            onClick={() => gehe({ mine: query.mine ? null : 'true' })}
          />
          <Umschalter
            an={query.withRegistration}
            label="Mit Anmeldung"
            onClick={() => gehe({ withRegistration: query.withRegistration ? null : 'true' })}
          />
          <Umschalter
            an={query.withFreeSeats}
            label="Plätze frei"
            onClick={() => gehe({ withFreeSeats: query.withFreeSeats ? null : 'true' })}
          />

          {kategorien.map((kategorie) => (
            <button
              key={kategorie.id}
              type="button"
              aria-pressed={query.categoryId === kategorie.id}
              onClick={() => gehe({ categoryId: query.categoryId === kategorie.id ? null : kategorie.id })}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                query.categoryId === kategorie.id
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: kategorie.color }}
              />
              {kategorie.name}
            </button>
          ))}

          {aktiveFilter > 0 ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSuche('');
                gehe({
                  categoryId: null,
                  mine: null,
                  withRegistration: null,
                  withFreeSeats: null,
                  search: null,
                });
              }}
            >
              <X aria-hidden="true" />
              Zurücksetzen
            </Button>
          ) : null}
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground md:hidden">
          <CalendarRange className="size-3.5" aria-hidden="true" />
          Auf dem Telefon zeigt der Kalender die Terminliste.
        </p>
      </div>
    </div>
  );
}
