import { tageSpaeter, tagesBeginnIn, teileIn } from '@swisshub/shared';
import { cn } from '@/lib/utils';
import { EventChip, EventKarte, datumKurz, uhrzeit } from './shared';
import type { calendar } from '@swisshub/modules';

type Zeile = Awaited<ReturnType<typeof calendar.listEventsInRange>>[number];

/**
 * Monats-, Wochen- und Agendaansicht.
 *
 * Serverseitig gerechnet: das Gitter steht fest, sobald der Zeitraum
 * feststeht, und ein Kalender, der erst im Browser entsteht, zeigt beim Laden
 * ein leeres Raster. Alle Tagesgrenzen laufen ueber die Zone der Ansicht -
 * eine feste Stundenzahl laege an den beiden Umstellungstagen daneben.
 */

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Ordnet Events den Tagen zu, auf die sie fallen. */
function nachTagen(
  zeilen: Zeile[],
  tage: Date[],
  zone: string,
): Map<number, Zeile[]> {
  const karte = new Map<number, Zeile[]>();
  for (const [index, tag] of tage.entries()) {
    const ende = tageSpaeter(tag, zone, 1);
    // Ein Event gehoert in den Tag, wenn es darin beginnt oder hineinragt.
    // Der zweite Fall ist der ueber Mitternacht laufende Abend - er steht
    // sonst nur in der Freitagsspalte und fehlt am Samstag.
    const treffer = zeilen.filter((zeile) => {
      const beginnt = zeile.startAt >= tag && zeile.startAt < ende;
      const ragtHinein =
        zeile.endAt !== null && zeile.startAt < tag && zeile.endAt > tag;
      return beginnt || ragtHinein;
    });
    if (treffer.length > 0) {
      karte.set(index, treffer);
    }
  }
  return karte;
}

function tageZwischen(von: Date, bis: Date, zone: string): Date[] {
  const tage: Date[] = [];
  let aktuell = tagesBeginnIn(von, zone);
  // Obergrenze als Bremse: eine kaputte Eingabe soll keine Endlosschleife
  // erzeugen, sondern eine kurze Ansicht.
  while (aktuell < bis && tage.length < 70) {
    tage.push(aktuell);
    aktuell = tageSpaeter(aktuell, zone, 1);
  }
  return tage;
}

export interface GitterProps {
  zeilen: Zeile[];
  von: Date;
  bis: Date;
  /** Monat bzw. Woche, um die es geht - Tage daneben werden gedaempft. */
  anker: Date;
  zone: string;
  heute: Date;
}

export function Monatsansicht({
  zeilen,
  anker,
  zone,
  heute,
}: GitterProps): React.JSX.Element {
  const ankerTeile = teileIn(anker, zone);
  // Das Gitter beginnt am Montag vor dem Monatsersten und laeuft ueber
  // sechs Wochen - so bleibt die Hoehe ueber alle Monate gleich, und die
  // Ansicht springt beim Blaettern nicht.
  const monatsErster = tagesBeginnIn(
    new Date(Date.UTC(ankerTeile.jahr, ankerTeile.monat - 1, 1, 12)),
    zone,
  );
  const ersterTeile = teileIn(monatsErster, zone);
  const versatz = (ersterTeile.wochentag + 6) % 7;
  const start = tageSpaeter(monatsErster, zone, -versatz);
  const tage = Array.from({ length: 42 }, (_, i) => tageSpaeter(start, zone, i));
  const karte = nachTagen(zeilen, tage, zone);
  const heuteSchluessel = tagesBeginnIn(heute, zone).getTime();

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WOCHENTAGE.map((tag) => (
          <div key={tag} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
            {tag}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {tage.map((tag, index) => {
          const teile = teileIn(tag, zone);
          const imMonat = teile.monat === ankerTeile.monat;
          const istHeute = tag.getTime() === heuteSchluessel;
          const events = karte.get(index) ?? [];
          return (
            <div
              key={tag.toISOString()}
              className={cn(
                'min-h-24 min-w-0 border-b border-r border-border p-1 last:border-r-0',
                index % 7 === 6 && 'border-r-0',
                !imMonat && 'bg-muted/20',
              )}
            >
              <div className="flex items-center justify-between px-1">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    imMonat ? 'text-foreground' : 'text-muted-foreground/60',
                    istHeute &&
                      'flex size-5 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground',
                  )}
                >
                  {teile.tag}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {events.slice(0, 3).map((zeile) => (
                  <EventChip key={zeile.id} zeile={zeile} />
                ))}
                {events.length > 3 ? (
                  <p className="px-1.5 text-xs text-muted-foreground">
                    +{events.length - 3} weitere
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Wochenansicht({
  zeilen,
  von,
  bis,
  zone,
  heute,
}: GitterProps): React.JSX.Element {
  const tage = tageZwischen(von, bis, zone);
  const karte = nachTagen(zeilen, tage, zone);
  const heuteSchluessel = tagesBeginnIn(heute, zone).getTime();

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-1 sm:grid-cols-7">
        {tage.map((tag, index) => {
          const teile = teileIn(tag, zone);
          const istHeute = tag.getTime() === heuteSchluessel;
          const events = karte.get(index) ?? [];
          return (
            <div
              key={tag.toISOString()}
              className={cn(
                'min-h-32 min-w-0 border-b border-border p-2 sm:border-r sm:last:border-r-0',
                istHeute && 'bg-primary/5',
              )}
            >
              <div className="mb-2 flex items-baseline gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {WOCHENTAGE[(teile.wochentag + 6) % 7]}
                </span>
                <span
                  className={cn(
                    'text-sm tabular-nums',
                    istHeute && 'font-semibold text-primary',
                  )}
                >
                  {teile.tag}.{teile.monat}.
                </span>
              </div>
              <div className="space-y-1">
                {events.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground/60">–</p>
                ) : (
                  events.map((zeile) => (
                    <div
                      key={zeile.id}
                      className="rounded-lg border border-border/60 bg-card p-1.5"
                    >
                      <EventChip zeile={zeile} />
                      {!zeile.allDay && zeile.endAt ? (
                        <p className="px-1.5 text-xs text-muted-foreground">
                          bis {uhrzeit(zeile.endAt, zeile.timezone)}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Agendaansicht({ zeilen, zone }: GitterProps): React.JSX.Element {
  // Nach Tagen gruppiert statt als flache Liste: sonst laesst sich nicht
  // erkennen, wo ein Tag endet und der naechste beginnt.
  const gruppen = new Map<string, { tag: Date; events: Zeile[] }>();
  for (const zeile of zeilen) {
    const tag = tagesBeginnIn(zeile.startAt, zone);
    const schluessel = tag.toISOString();
    const vorhanden = gruppen.get(schluessel);
    if (vorhanden) {
      vorhanden.events.push(zeile);
    } else {
      gruppen.set(schluessel, { tag, events: [zeile] });
    }
  }

  return (
    <div className="space-y-5">
      {[...gruppen.values()].map((gruppe) => (
        <div key={gruppe.tag.toISOString()} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {datumKurz(gruppe.tag, zone)}
          </h3>
          <div className="space-y-2">
            {gruppe.events.map((zeile) => (
              <EventKarte key={zeile.id} zeile={zeile} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
