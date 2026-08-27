import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Plus, Settings2 } from 'lucide-react';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { tageSpaeter, teileIn } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/shared/states';
import {
  Agendaansicht,
  Monatsansicht,
  Wochenansicht,
} from '@/modules/calendar/components/kalender-gitter';
import { KalenderFilter } from '@/modules/calendar/components/kalender-filter';
import { EventKarte } from '@/modules/calendar/components/shared';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Community-Kalender' };
export const dynamic = 'force-dynamic';

const P = calendar.CALENDAR_PERMISSIONS;

/**
 * Der Community-Kalender.
 *
 * Ansicht, Zeitraum und Filter stehen in der Adresse - damit laesst sich ein
 * bestimmter Monat verlinken und mit dem Zurueck-Knopf verlassen. Gerechnet
 * wird serverseitig; ein Kalender, der erst im Browser entsteht, zeigt beim
 * Laden ein leeres Raster.
 */
export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.create, P.manageOwn]);
  const params = await searchParams;

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="Der Community-Kalender ist derzeit deaktiviert."
      />
    );
  }

  const einfach = (wert: string | string[] | undefined): string | undefined =>
    Array.isArray(wert) ? wert[0] : wert;

  const query = calendar.calendarQuerySchema.parse({
    view: einfach(params.view) ?? 'month',
    anchor: einfach(params.anchor),
    categoryId: einfach(params.categoryId),
    search: einfach(params.search),
    mine: einfach(params.mine) === 'true',
    withRegistration: einfach(params.withRegistration) === 'true',
    withFreeSeats: einfach(params.withFreeSeats) === 'true',
  });

  const settings = await calendar.calendarSettings();
  const zone = calendar.DEFAULT_TIMEZONE;
  const heute = new Date();
  const { von, bis, anker } = calendar.zeitraumFuer(query, zone, heute);

  // Entwuerfe sieht nur, wer sie verwalten darf - fuer alle anderen gibt es
  // sie nicht. Das ist keine Anzeigefrage: ein unveroeffentlichtes Event soll
  // auch nicht ueber die Kalenderabfrage sichtbar werden.
  const darfEntwuerfe = can(context, P.edit) || can(context, P.manageOwn);

  const [zeilen, kategorien] = await Promise.all([
    calendar.listEventsInRange(von, bis, query, {
      includeDrafts: darfEntwuerfe,
      viewerDiscordId: context.user.discordId,
    }),
    calendar.listCategories(true),
  ]);

  const teile = teileIn(anker, zone);
  const titel =
    query.view === 'month'
      ? new Intl.DateTimeFormat('de-CH', { timeZone: zone, month: 'long', year: 'numeric' }).format(
          anker,
        )
      : query.view === 'week'
        ? `${new Intl.DateTimeFormat('de-CH', { timeZone: zone, day: '2-digit', month: 'short' }).format(von)} – ${new Intl.DateTimeFormat('de-CH', { timeZone: zone, day: '2-digit', month: 'short' }).format(tageSpaeter(bis, zone, -1))}`
        : 'Die nächsten Wochen';

  const schritt = query.view === 'week' ? 7 : query.view === 'agenda' ? 30 : 0;
  const vorher =
    schritt > 0
      ? tageSpaeter(anker, zone, -schritt)
      : new Date(Date.UTC(teile.jahr, teile.monat - 2, 15, 12));
  const nachher =
    schritt > 0
      ? tageSpaeter(anker, zone, schritt)
      : new Date(Date.UTC(teile.jahr, teile.monat, 15, 12));

  const gitterProps = { zeilen, von, bis, anker, zone, heute };

  return (
    <>
      {/* Kein `PageHeader`: Titel und Beschreibung dieser Route stehen in der
          Module Registry und werden von der Kopfzeile gesetzt. Ein zweiter
          Titel stuende darunter noch einmal. */}
      {can(context, P.edit) || can(context, P.manageOwn) || can(context, P.create) ? (
        <div className="flex flex-wrap justify-end gap-2">
          {can(context, P.edit) || can(context, P.manageOwn) ? (
            <Button variant="outline" asChild>
              <Link href="/kalender/verwaltung">
                <Settings2 aria-hidden="true" />
                Verwaltung
              </Link>
            </Button>
          ) : null}
          {can(context, P.create) ? (
            <Button asChild>
              <Link href="/kalender/neu">
                <Plus aria-hidden="true" />
                Event erstellen
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <KalenderFilter
        query={query}
        kategorien={kategorien.map((eintrag) => ({
          id: eintrag.id,
          name: eintrag.name,
          color: eintrag.color,
        }))}
        titel={titel}
        vorherAnchor={vorher.toISOString()}
        nachherAnchor={nachher.toISOString()}
      />

      {zeilen.length === 0 ? (
        <EmptyState
          title="Keine Events in diesem Zeitraum"
          description={
            query.search || query.categoryId || query.mine
              ? 'Für diese Auswahl gibt es nichts. Setze die Filter zurück, um mehr zu sehen.'
              : 'Sobald ein Event angelegt wurde, erscheint es hier.'
          }
        />
      ) : (
        <>
          {/* Auf dem Telefon immer die Agenda: ein zusammengequetschtes
              Monatsgitter laesst sich weder lesen noch treffen. */}
          <div className="md:hidden">
            <Agendaansicht {...gitterProps} />
          </div>
          <div className="hidden md:block">
            {query.view === 'month' ? (
              <Monatsansicht {...gitterProps} />
            ) : query.view === 'week' ? (
              <Wochenansicht {...gitterProps} />
            ) : (
              <Agendaansicht {...gitterProps} />
            )}
          </div>
        </>
      )}

      {query.view !== 'agenda' && zeilen.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            Als Nächstes
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {zeilen
              .filter((zeile) => zeile.startAt >= heute && zeile.status !== 'CANCELLED')
              .slice(0, 6)
              .map((zeile) => (
                <EventKarte key={zeile.id} zeile={zeile} />
              ))}
          </div>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Alle Zeiten in {zone}. Events ohne Endzeit werden mit{' '}
        {settings.defaultDurationMinutes} Minuten dargestellt.
      </p>
    </>
  );
}
