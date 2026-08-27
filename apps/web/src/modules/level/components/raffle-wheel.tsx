'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';

/**
 * Das Glücksrad.
 *
 * Wichtig: Dieses Rad bestimmt nichts. Der Gewinner steht zum Zeitpunkt der
 * Animation längst in der Datenbank; das Rad dreht sich zu einem Ergebnis,
 * das es nur noch zeigt. Deshalb gibt es hier auch keinen Zufall - die
 * Drehung wird aus dem Wert berechnet, den der Server mitgeliefert hat, und
 * sieht dadurch auf allen Geräten gleich aus.
 *
 * Die Segmente sind so breit wie das Gewicht der jeweiligen Teilnahme. Beim
 * Festbetrag sind damit alle gleich breit, beim Anteilsmodell entspricht die
 * Breite dem bezahlten Einsatz - das Bild zeigt also die tatsächliche
 * Gewinnchance und nicht eine geschönte.
 */

export interface WheelSegment {
  entryId: string;
  discordId: string;
  label: string;
  weight: number;
  avatarHash?: string | null;
}

/**
 * Ab wie vielen Teilnehmenden zusammengefasst wird.
 *
 * Bei zweihundert winzigen Kuchenstücken ist kein Name mehr lesbar. Die
 * kleinsten werden deshalb zu einem Segment zusammengelegt - das behält den
 * Kreis als Ganzes massstabsgetreu, denn das Sammelsegment ist genau so
 * breit wie die Summe der Gewichte darin.
 */
const MAX_SEGMENTS = 20;

const PALETTE = ['#83060a', '#a81419', '#c92a2a', '#6d0508', '#b02025', '#8f1114', '#d13a3a', '#5c0406'];

interface DisplaySegment {
  key: string;
  label: string;
  weight: number;
  discordId: string | null;
  avatarHash?: string | null;
  /** Fasst mehrere Teilnahmen zusammen. */
  aggregate: boolean;
  containsEntryIds: string[];
  startAngle: number;
  endAngle: number;
  color: string;
}

function buildSegments(segments: WheelSegment[]): DisplaySegment[] {
  const sorted = [...segments].sort((a, b) => b.weight - a.weight || a.entryId.localeCompare(b.entryId));
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    return [];
  }

  const visible = sorted.slice(0, MAX_SEGMENTS - 1);
  const rest = sorted.slice(MAX_SEGMENTS - 1);
  const parts: Array<{
    key: string;
    label: string;
    weight: number;
    discordId: string | null;
    avatarHash?: string | null;
    aggregate: boolean;
    containsEntryIds: string[];
  }> = [];

  if (rest.length === 0) {
    for (const entry of sorted) {
      parts.push({
        key: entry.entryId,
        label: entry.label,
        weight: entry.weight,
        discordId: entry.discordId,
        avatarHash: entry.avatarHash,
        aggregate: false,
        containsEntryIds: [entry.entryId],
      });
    }
  } else {
    for (const entry of visible) {
      parts.push({
        key: entry.entryId,
        label: entry.label,
        weight: entry.weight,
        discordId: entry.discordId,
        avatarHash: entry.avatarHash,
        aggregate: false,
        containsEntryIds: [entry.entryId],
      });
    }
    parts.push({
      key: '__rest__',
      label: `+${rest.length} weitere`,
      weight: rest.reduce((sum, entry) => sum + entry.weight, 0),
      discordId: null,
      aggregate: true,
      containsEntryIds: rest.map((entry) => entry.entryId),
    });
  }

  let cursor = 0;
  return parts.map((part, index) => {
    const sweep = (part.weight / total) * 360;
    const segment: DisplaySegment = {
      ...part,
      startAngle: round(cursor),
      endAngle: round(cursor + sweep),
      color: PALETTE[index % PALETTE.length]!,
    };
    cursor += sweep;
    return segment;
  });
}

/**
 * Auf feste Stellen gerundet.
 *
 * `Math.cos` und `Math.sin` dürfen sich zwischen Node und dem Browser im
 * letzten Bit unterscheiden. In ein SVG-Attribut geschrieben ergibt das zwei
 * unterschiedliche Zeichenketten, und React meldet beim Abgleich einen
 * Hydration-Fehler. Drei Nachkommastellen sind für eine Zeichnung dieser
 * Grösse mehr als genug.
 */
const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Punkt auf dem Kreis. 0° zeigt nach oben, im Uhrzeigersinn wachsend. */
function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [round(cx + radius * Math.cos(radians)), round(cy + radius * Math.sin(radians))];
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  // Ein voller Kreis lässt sich nicht als einzelner Bogen zeichnen.
  if (end - start >= 359.999) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`;
  }
  const [x1, y1] = polar(cx, cy, radius, start);
  const [x2, y2] = polar(cx, cy, radius, end);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

export function RaffleWheel({
  segments,
  winnerEntryId,
  animationSeed,
  spinning,
  runId,
  onSpinEnd,
}: {
  segments: WheelSegment[];
  /** Gesetzt, sobald der Server gezogen hat. */
  winnerEntryId?: string | null;
  /** Wert vom Server - sorgt für dieselbe Drehung auf allen Geräten. */
  animationSeed?: string | null;
  spinning: boolean;
  /**
   * Zaehler, der eine erneute Drehung ausloest.
   *
   * Gebraucht fuer «nochmal ansehen»: Gewinner und Wert des Servers bleiben
   * gleich, und ohne diesen Zaehler saehe der Effekt keinen Grund, noch
   * einmal zu laufen. Auf den Gewinner hat er keinen Einfluss.
   */
  runId?: number;
  onSpinEnd?: () => void;
}): React.JSX.Element {
  const display = useMemo(() => buildSegments(segments), [segments]);
  const [rotation, setRotation] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Drehung, bei der das Rad zur Ruhe gekommen ist. Danach richten sich die
  // Beschriftungen aus - waehrend der Drehung liest sie ohnehin niemand.
  const [settled, setSettled] = useState(0);
  const timer = useRef<number | null>(null);

  // Wer die Bewegung abbestellt hat, bekommt das Ergebnis ohne Drehung.
  //
  // Bewusst im Effekt statt waehrend des Renderns: `window` gibt es auf dem
  // Server nicht, und ein Zweig darauf laesst die erste Fassung im Browser
  // von der des Servers abweichen - React meldet das als Hydration-Fehler.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) {
      return;
    }
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const winnerSegment = winnerEntryId
    ? display.find((segment) => segment.containsEntryIds.includes(winnerEntryId))
    : undefined;

  useEffect(() => {
    if (!winnerSegment) {
      return;
    }

    // Mitte des Gewinnersegments unter den Zeiger drehen.
    const middle = round((winnerSegment.startAngle + winnerSegment.endAngle) / 2);
    // Zusätzliche volle Umdrehungen, damit es nach einer Ziehung aussieht.
    // Die Zahl stammt aus dem Wert des Servers, nicht aus Zufall im Browser.
    const seedNumber = animationSeed ? Number.parseInt(animationSeed.slice(0, 4), 16) : 0;
    const extraTurns = 4 + (seedNumber % 3);
    const target = extraTurns * 360 + (360 - middle);

    if (reducedMotion || !spinning) {
      setAnimate(false);
      setRotation(360 - middle);
      setSettled(360 - middle);
      onSpinEnd?.();
      return;
    }

    setAnimate(true);
    setRotation(target);
    timer.current = window.setTimeout(() => {
      setSettled(target);
      onSpinEnd?.();
    }, 6200);

    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
    // `onSpinEnd` bewusst nicht in der Liste: eine neue Funktionsreferenz
    // würde die Drehung sonst mitten im Lauf neu starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerSegment?.key, animationSeed, spinning, reducedMotion, runId]);

  if (display.length === 0) {
    return (
      <div
        className="flex aspect-square w-full max-w-md items-center justify-center rounded-full border-4 border-dashed border-border text-center text-sm text-muted-foreground"
        role="img"
        aria-label="Glücksrad ohne Teilnehmende"
      >
        <span className="max-w-[60%]">Noch niemand dabei – das Rad füllt sich mit jeder Teilnahme.</span>
      </div>
    );
  }

  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 8;

  return (
    <div className="relative mx-auto w-full max-w-md">
      {/* Zeiger */}
      <div
        className="absolute left-1/2 top-0 z-10 size-0 -translate-x-1/2 border-x-[14px] border-t-[26px] border-x-transparent border-t-primary drop-shadow"
        aria-hidden="true"
      />

      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full"
        role="img"
        aria-label={
          winnerSegment
            ? `Glücksrad. Gewinner: ${winnerSegment.aggregate ? 'aus den zusammengefassten Teilnahmen' : winnerSegment.label}.`
            : `Glücksrad mit ${segments.length} Teilnehmenden.`
        }
      >
        <defs>
          <clipPath id="wheel-clip">
            <circle cx={cx} cy={cy} r={radius} />
          </clipPath>
        </defs>

        <g
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: '50% 50%',
            transition: animate ? 'transform 6s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          }}
        >
          {display.map((segment) => {
            const sweep = segment.endAngle - segment.startAngle;
            const middle = round((segment.startAngle + segment.endAngle) / 2);
            const [lx, ly] = polar(cx, cy, radius * 0.66, middle);
            const [ax, ay] = polar(cx, cy, radius * 0.78, middle);
            // Unter etwa 14 Grad wird jede Beschriftung unleserlich.
            const showLabel = sweep >= 14;
            const showAvatar = sweep >= 26 && segment.discordId !== null;
            // In der unteren Kreishälfte zeigt der Radius nach unten - ohne
            // die halbe Drehung stünden die Namen dort auf dem Kopf. Massgeblich
            // ist dabei die Lage nach der Drehung, nicht die im Ruhezustand.
            const effective = (((middle + settled) % 360) + 360) % 360;
            const upsideDown = effective > 90 && effective < 270;
            const textAngle = upsideDown ? middle + 180 : middle;

            return (
              <g key={segment.key}>
                <path
                  d={arcPath(cx, cy, radius, segment.startAngle, segment.endAngle)}
                  fill={segment.color}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth={1.5}
                />
                {showAvatar ? (
                  <image
                    href={getDiscordAvatarUrl(segment.discordId!, segment.avatarHash ?? null, 64)}
                    x={ax - 16}
                    y={ay - 16}
                    width={32}
                    height={32}
                    clipPath="circle(16px at 16px 16px)"
                    transform={`rotate(${textAngle} ${ax} ${ay})`}
                  />
                ) : null}
                {showLabel ? (
                  <text
                    x={lx}
                    y={ly}
                    fill="#ffffff"
                    fontSize={sweep >= 40 ? 15 : 12}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${textAngle} ${lx} ${ly})`}
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.5)', strokeWidth: 3 }}
                  >
                    {segment.label.length > 14 ? `${segment.label.slice(0, 13)}…` : segment.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Nabe */}
        <circle cx={cx} cy={cy} r={radius * 0.17} fill="#0d0d0f" stroke="#83060a" strokeWidth={3} />
        <text
          x={cx}
          y={cy}
          fill="#ffffff"
          fontSize={20}
          textAnchor="middle"
          dominantBaseline="middle"
          aria-hidden="true"
        >
          🎡
        </text>
      </svg>

      {display.some((segment) => segment.aggregate) ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Zur Lesbarkeit sind die kleinsten Anteile zu einem Segment zusammengefasst. Der Kreis bleibt
          massstabsgetreu: das Sammelsegment ist genau so breit wie die Anteile darin.
        </p>
      ) : null}
    </div>
  );
}
