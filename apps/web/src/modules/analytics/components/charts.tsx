import { cn } from '@/lib/utils';

/**
 * Diagramme als reines SVG.
 *
 * Das Projekt hat keine Chart-Bibliothek, und eine einzuführen wäre für diese
 * Seite der falsche Handel: Recharts und Verwandte bringen 100 bis 200 kB in
 * jedes Bundle, das sie anfasst, und liefern dafür Interaktionen, die eine
 * Statistikseite nicht braucht. Was sie braucht - Linie, Balken, Raster - ist
 * SVG, und SVG rendert der Server mit.
 *
 * Alle Farben kommen aus den Design-Tokens, damit die Diagramme im hellen wie
 * im dunklen Erscheinungsbild stimmen.
 */

export interface Reihe {
  id: string;
  label: string;
  werte: number[];
  /** Tailwind-Farbklasse für Strich und Fläche. */
  farbe: string;
}

interface LinienDiagrammProps {
  reihen: Reihe[];
  /** Beschriftungen der x-Achse - gleich viele wie Werte. */
  labels: string[];
  /** Formatiert die Werte in der Achse und im Tooltip. */
  formatWert?: (wert: number) => string;
  hoehe?: number;
  className?: string;
  /**
   * Wo die y-Achse beginnt.
   *
   * `null` ist für Mengen richtig - eine Nachrichtenzahl von 40 gegenüber 80
   * ist die Hälfte, und das soll man sehen. Für einen Bestand ist es falsch:
   * eine Mitgliederzahl zwischen 5'800 und 6'000 ergäbe auf einer Achse ab
   * null eine schnurgerade Linie am oberen Rand, aus der niemand ablesen
   * kann, ob die Gemeinschaft wächst. `daten` legt die Achse um die
   * tatsächlichen Werte.
   */
  nullpunkt?: 'null' | 'daten';
  /** Beschreibung für Screenreader, wenn die Grafik nicht lesbar ist. */
  beschreibung: string;
}

const BREITE = 1000;
const RAND = { oben: 12, rechts: 8, unten: 26, links: 48 };

/** Rundet die Achsenobergrenze auf einen lesbaren Wert auf. */
function obergrenze(werte: number[]): number {
  const groesster = Math.max(1, ...werte);
  const stelle = 10 ** Math.floor(Math.log10(groesster));
  return Math.ceil(groesster / stelle) * stelle;
}

/**
 * Der dargestellte Wertebereich.
 *
 * Bei `daten` bekommt die Spanne oben und unten etwas Luft, damit die Linie
 * nicht am Rand klebt - und sie fällt nie unter null, weil es keine
 * negativen Mitglieder gibt.
 */
function achsenSpanne(werte: number[], nullpunkt: 'null' | 'daten'): { unten: number; oben: number } {
  if (nullpunkt === 'null') {
    return { unten: 0, oben: obergrenze(werte) };
  }
  const kleinster = Math.min(...werte);
  const groesster = Math.max(...werte);
  if (groesster === kleinster) {
    // Eine waagerechte Linie soll in der Mitte liegen, nicht am Rand.
    return { unten: Math.max(0, kleinster - 1), oben: groesster + 1 };
  }
  const luft = Math.max(1, Math.round((groesster - kleinster) * 0.15));
  return { unten: Math.max(0, kleinster - luft), oben: groesster + luft };
}

/**
 * Linien über die Zeit.
 *
 * Ohne Punkte je Datum: bei 90 Tagen wären das 90 Kreise, die einander
 * überlappen und nichts hinzufügen. Die Werte stehen im Tooltip-Streifen.
 */
export function LinienDiagramm({
  reihen,
  labels,
  formatWert = (wert) => wert.toLocaleString('de-CH'),
  hoehe = 220,
  className,
  nullpunkt = 'null',
  beschreibung,
}: LinienDiagrammProps): React.JSX.Element {
  const anzahl = Math.max(...reihen.map((reihe) => reihe.werte.length), 0);
  if (anzahl === 0) {
    return <LeeresDiagramm hoehe={hoehe} className={className} />;
  }

  const alleWerte = reihen.flatMap((reihe) => reihe.werte);
  const spanne = achsenSpanne(alleWerte, nullpunkt);
  const innenBreite = BREITE - RAND.links - RAND.rechts;
  const innenHoehe = hoehe - RAND.oben - RAND.unten;
  const x = (index: number): number =>
    RAND.links + (anzahl === 1 ? innenBreite / 2 : (index / (anzahl - 1)) * innenBreite);
  const y = (wert: number): number =>
    RAND.oben + innenHoehe - ((wert - spanne.unten) / (spanne.oben - spanne.unten)) * innenHoehe;

  // Höchstens sechs Beschriftungen - mehr überlappen auf dem Telefon.
  const schritt = Math.max(1, Math.ceil(anzahl / 6));

  return (
    <figure className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${BREITE} ${hoehe}`}
        className="h-auto w-full"
        role="img"
        aria-label={beschreibung}
        preserveAspectRatio="none"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((anteil) => (
          <g key={anteil}>
            <line
              x1={RAND.links}
              x2={BREITE - RAND.rechts}
              y1={RAND.oben + innenHoehe * anteil}
              y2={RAND.oben + innenHoehe * anteil}
              className="stroke-border/60"
              strokeWidth={1}
            />
            <text
              x={RAND.links - 8}
              y={RAND.oben + innenHoehe * anteil + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatWert(Math.round(spanne.unten + (spanne.oben - spanne.unten) * (1 - anteil)))}
            </text>
          </g>
        ))}

        {reihen.map((reihe) => {
          const punkte = reihe.werte.map((wert, index) => `${x(index)},${y(wert)}`).join(' ');
          const flaeche = `${RAND.links},${RAND.oben + innenHoehe} ${punkte} ${x(reihe.werte.length - 1)},${RAND.oben + innenHoehe}`;
          return (
            <g key={reihe.id}>
              <polygon points={flaeche} className={cn('opacity-10', reihe.farbe)} fill="currentColor" />
              <polyline
                points={punkte}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={reihe.farbe}
                stroke="currentColor"
              />
            </g>
          );
        })}

        {labels.map((label, index) =>
          index % schritt === 0 ? (
            <text
              key={`${label}-${index}`}
              x={x(index)}
              y={hoehe - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="sr-only">{beschreibung}</figcaption>
    </figure>
  );
}

interface BalkenDiagrammProps {
  labels: string[];
  reihen: Reihe[];
  /** Balken einer Position übereinander statt nebeneinander. */
  gestapelt?: boolean;
  formatWert?: (wert: number) => string;
  hoehe?: number;
  className?: string;
  beschreibung: string;
}

/** Balken - für Vergleiche und für Beitritte gegen Austritte. */
export function BalkenDiagramm({
  labels,
  reihen,
  gestapelt = false,
  formatWert = (wert) => wert.toLocaleString('de-CH'),
  hoehe = 200,
  className,
  beschreibung,
}: BalkenDiagrammProps): React.JSX.Element {
  const anzahl = labels.length;
  if (anzahl === 0 || reihen.length === 0) {
    return <LeeresDiagramm hoehe={hoehe} className={className} />;
  }

  const summenJePosition = labels.map((_unused, index) =>
    reihen.reduce((summe, reihe) => summe + Math.abs(reihe.werte[index] ?? 0), 0),
  );
  const max = obergrenze(gestapelt ? summenJePosition : reihen.flatMap((reihe) => reihe.werte));

  const innenBreite = BREITE - RAND.links - RAND.rechts;
  const innenHoehe = hoehe - RAND.oben - RAND.unten;
  const gruppenBreite = innenBreite / anzahl;
  const balkenBreite = gestapelt
    ? Math.max(2, gruppenBreite * 0.6)
    : Math.max(2, (gruppenBreite * 0.7) / reihen.length);
  const schritt = Math.max(1, Math.ceil(anzahl / 8));

  return (
    <figure className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${BREITE} ${hoehe}`}
        className="h-auto w-full"
        role="img"
        aria-label={beschreibung}
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((anteil) => (
          <g key={anteil}>
            <line
              x1={RAND.links}
              x2={BREITE - RAND.rechts}
              y1={RAND.oben + innenHoehe * anteil}
              y2={RAND.oben + innenHoehe * anteil}
              className="stroke-border/60"
              strokeWidth={1}
            />
            <text
              x={RAND.links - 8}
              y={RAND.oben + innenHoehe * anteil + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatWert(Math.round(max * (1 - anteil)))}
            </text>
          </g>
        ))}

        {labels.map((label, index) => {
          const gruppenStart = RAND.links + gruppenBreite * index;
          let gestapelteHoehe = 0;
          return (
            <g key={`${label}-${index}`}>
              {reihen.map((reihe, reihenIndex) => {
                const wert = Math.abs(reihe.werte[index] ?? 0);
                const balkenHoehe = (wert / max) * innenHoehe;
                const x = gestapelt
                  ? gruppenStart + (gruppenBreite - balkenBreite) / 2
                  : gruppenStart + gruppenBreite * 0.15 + balkenBreite * reihenIndex;
                const y = gestapelt
                  ? RAND.oben + innenHoehe - gestapelteHoehe - balkenHoehe
                  : RAND.oben + innenHoehe - balkenHoehe;
                gestapelteHoehe += gestapelt ? balkenHoehe : 0;
                return (
                  <rect
                    key={reihe.id}
                    x={x}
                    y={y}
                    width={balkenBreite}
                    height={Math.max(0, balkenHoehe)}
                    rx={2}
                    className={reihe.farbe}
                    fill="currentColor"
                  >
                    <title>{`${label} · ${reihe.label}: ${formatWert(wert)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        {labels.map((label, index) =>
          index % schritt === 0 ? (
            <text
              key={`achse-${label}-${index}`}
              x={RAND.links + gruppenBreite * index + gruppenBreite / 2}
              y={hoehe - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="sr-only">{beschreibung}</figcaption>
    </figure>
  );
}

/** Legende zu einem Diagramm. */
export function Legende({ reihen }: { reihen: Reihe[] }): React.JSX.Element {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {reihen.map((reihe) => (
        <li key={reihe.id} className="flex items-center gap-1.5">
          <span
            className={cn('size-2.5 shrink-0 rounded-sm', reihe.farbe)}
            style={{ backgroundColor: 'currentColor' }}
            aria-hidden="true"
          />
          {reihe.label}
        </li>
      ))}
    </ul>
  );
}

function LeeresDiagramm({ hoehe, className }: { hoehe: number; className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground',
        className,
      )}
      style={{ height: hoehe }}
    >
      Für diesen Zeitraum liegen keine Daten vor.
    </div>
  );
}

interface HeatmapProps {
  zellen: Array<{ wochentag: number; stunde: number; wert: number }>;
  max: number;
  formatWert: (wert: number) => string;
  beschreibung: string;
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/**
 * Wochentag mal Uhrzeit als Raster.
 *
 * Ein Raster aus `div`s statt SVG, weil es dadurch von selbst umbricht und
 * jede Zelle einen eigenen Tooltip tragen kann. Die Farbe ist die einzige
 * Kodierung - deshalb steht der Wert zusätzlich im `title`, und die
 * Spitzenzeiten stehen als Text daneben.
 */
export function HeatmapRaster({ zellen, max, formatWert, beschreibung }: HeatmapProps): React.JSX.Element {
  const nach = new Map(zellen.map((zelle) => [`${zelle.wochentag}-${zelle.stunde}`, zelle.wert]));

  return (
    <div className="min-w-0 overflow-x-auto scrollbar-slim" role="img" aria-label={beschreibung}>
      <div className="min-w-[34rem] space-y-1">
        <div className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-0.5">
          <span aria-hidden="true" />
          {Array.from({ length: 24 }, (_unused, stunde) => (
            <span
              key={stunde}
              className="text-center text-[10px] leading-none text-muted-foreground"
              aria-hidden="true"
            >
              {stunde % 3 === 0 ? stunde : ''}
            </span>
          ))}
        </div>
        {/* Montag zuerst: die Woche beginnt hier nicht am Sonntag. */}
        {[1, 2, 3, 4, 5, 6, 0].map((wochentag) => (
          <div key={wochentag} className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-0.5">
            <span className="text-[11px] leading-5 text-muted-foreground">{WOCHENTAGE[wochentag]}</span>
            {Array.from({ length: 24 }, (_unused, stunde) => {
              const wert = nach.get(`${wochentag}-${stunde}`) ?? 0;
              const anteil = max > 0 ? wert / max : 0;
              return (
                <span
                  key={stunde}
                  className="h-5 rounded-[2px] bg-primary"
                  // Deckkraft statt verschiedener Farben: eine Skala aus einer
                  // Farbe bleibt auch für Farbfehlsichtige eine Reihenfolge.
                  style={{ opacity: wert === 0 ? 0.06 : 0.15 + anteil * 0.85 }}
                  title={`${WOCHENTAGE[wochentag]} ${String(stunde).padStart(2, '0')}:00 – ${formatWert(wert)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
