import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { calendar } from '@swisshub/modules';

type Zeile = Awaited<ReturnType<typeof calendar.listEventsInRange>>[number];
type Status = Zeile['status'];

/**
 * Bausteine, die Kalender, Detailseite und Verwaltung gemeinsam nutzen.
 *
 * An einer Stelle, damit ein Event ueberall gleich aussieht - eine zweite
 * Statusfarbe an anderer Stelle waere derselbe Zustand in einem anderen
 * Gewand.
 */

const STATUS_TEXT: Record<Status, string> = {
  DRAFT: 'Entwurf',
  SCHEDULED: 'Geplant',
  ONGOING: 'Läuft',
  COMPLETED: 'Beendet',
  CANCELLED: 'Abgesagt',
};

const STATUS_STIL: Record<Status, string> = {
  DRAFT: 'border-border bg-muted text-muted-foreground',
  SCHEDULED: 'border-primary/40 bg-primary/10 text-primary',
  ONGOING: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  COMPLETED: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export function EventStatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}): React.JSX.Element {
  return (
    <Badge variant="outline" className={cn(STATUS_STIL[status], className)}>
      {STATUS_TEXT[status]}
    </Badge>
  );
}

export function KategorieBadge({
  kategorie,
}: {
  kategorie: { name: string; color: string } | null;
}): React.JSX.Element | null {
  if (!kategorie) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: kategorie.color }}
      />
      {kategorie.name}
    </span>
  );
}

/** Uhrzeit in der Zone des Events. */
export function uhrzeit(wert: Date, timezone: string): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(wert);
}

export function datumLang(wert: Date, timezone: string): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(wert);
}

export function datumKurz(wert: Date, timezone: string): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(wert);
}

/** Zeitspanne eines Events, kurz. */
export function zeitspanne(zeile: {
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timezone: string;
}): string {
  if (zeile.allDay) {
    return 'Ganztägig';
  }
  const beginn = uhrzeit(zeile.startAt, zeile.timezone);
  return zeile.endAt ? `${beginn} – ${uhrzeit(zeile.endAt, zeile.timezone)}` : beginn;
}

/** Belegung als Text - `null`, wenn das Event keine Anmeldung hat. */
export function belegungsText(zeile: {
  registrationEnabled: boolean;
  capacity: number;
  confirmed: number;
}): string | null {
  if (!zeile.registrationEnabled) {
    return null;
  }
  return zeile.capacity > 0 ? `${zeile.confirmed} / ${zeile.capacity}` : `${zeile.confirmed}`;
}

/**
 * Ein Event als kompakte Zeile im Kalendergitter.
 *
 * Bewusst knapp: in einer Monatszelle ist Platz fuer Uhrzeit und Namen, mehr
 * nicht. Alles Weitere steht auf der Detailseite.
 */
export function EventChip({ zeile }: { zeile: Zeile }): React.JSX.Element {
  const farbe = zeile.category?.color ?? 'var(--color-primary)';
  return (
    <Link
      href={`/kalender/${zeile.slug}`}
      className={cn(
        'group flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted',
        zeile.status === 'CANCELLED' && 'opacity-60',
      )}
      title={`${zeitspanne(zeile)} · ${zeile.title}`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: farbe }}
      />
      {!zeile.allDay ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {uhrzeit(zeile.startAt, zeile.timezone)}
        </span>
      ) : null}
      <span
        className={cn(
          'truncate font-medium',
          zeile.status === 'CANCELLED' && 'line-through',
        )}
      >
        {zeile.title}
      </span>
      {zeile.meine ? (
        <span
          aria-label={zeile.meine === 'CONFIRMED' ? 'Du bist angemeldet' : 'Du stehst auf der Warteliste'}
          className={cn(
            'ml-auto size-1.5 shrink-0 rounded-full',
            zeile.meine === 'CONFIRMED' ? 'bg-emerald-500' : 'bg-amber-500',
          )}
        />
      ) : null}
    </Link>
  );
}

/**
 * Ein Event als Karte - fuer Agenda, «Meine Events» und Mobile.
 *
 * Auf dem Telefon ersetzt diese Darstellung das Gitter: eine
 * zusammengequetschte Monatsansicht laesst sich weder lesen noch treffen.
 */
export function EventKarte({ zeile }: { zeile: Zeile }): React.JSX.Element {
  const plaetze = belegungsText(zeile);
  return (
    <Link
      href={`/kalender/${zeile.slug}`}
      className={cn(
        'flex gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40',
        zeile.status === 'CANCELLED' && 'opacity-70',
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: zeile.category?.color ?? 'var(--color-primary)' }}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'font-medium',
              zeile.status === 'CANCELLED' && 'line-through',
            )}
          >
            {zeile.title}
          </span>
          {zeile.status !== 'SCHEDULED' ? <EventStatusBadge status={zeile.status} /> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {datumKurz(zeile.startAt, zeile.timezone)} · {zeitspanne(zeile)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <KategorieBadge kategorie={zeile.category} />
          {plaetze ? (
            <span className="text-xs tabular-nums text-muted-foreground">{plaetze} Plätze</span>
          ) : null}
          {zeile.meine ? (
            <Badge
              variant="outline"
              className={
                zeile.meine === 'CONFIRMED'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-500'
              }
            >
              {zeile.meine === 'CONFIRMED' ? 'Angemeldet' : 'Warteliste'}
            </Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
