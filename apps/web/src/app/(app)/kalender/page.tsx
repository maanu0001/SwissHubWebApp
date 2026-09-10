import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Plus, Settings2 } from 'lucide-react';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { tageSpaeter, teileIn } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Agendaansicht, Monatsansicht, Wochenansicht } from '@/modules/calendar/components/kalender-gitter';
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
      <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist derzeit deaktiviert." />
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

  /**
   * Die Liste ist die Gesamtuebersicht - das Raster ein Ausschnitt.
   *
   * Monat und Woche zeigen einen Zeitraum; das ist ihr Zweck, und der
   * Zeitraumfilter gehoert dazu. Die Liste beantwortet eine andere Frage:
   * «was gibt es?» Sie zeigt deshalb alle Termine, unabhaengig davon, welcher
   * Monat oben eingestellt ist.
   *
   * Beide Wege lesen dieselben Filter - Kategorie, Suche, «meine Events»,
   * «Plaetze frei» gelten hier wie dort. Nur der Zeitraum unterscheidet sie.
   */
  const istListe = query.view === 'agenda';

  // Entwuerfe sieht nur, wer sie verwalten darf - fuer alle anderen gibt es
  // sie nicht. Das ist keine Anzeigefrage: ein unveroeffentlichtes Event soll
  // auch nicht ueber die Kalenderabfrage sichtbar werden.
  const darfEntwuerfe = can(context, P.edit) || can(context, P.manageOwn);

  const sicht = { includeDrafts: darfEntwuerfe, viewerDiscordId: context.user.discordId };
  const [zeilen, kategorien] = await Promise.all([
    istListe
      ? calendar.listAlleEvents(query, sicht, heute)
      : calendar.listEventsInRange(von, bis, query, sicht),
    calendar.listCategories(true),
  ]);

  /**
   * Kommende und vergangene Termine der Liste.
   *
   * `listAlleEvents` liefert sie bereits in dieser Reihenfolge; hier werden
   * sie nur getrennt, damit zwischen beiden eine Ueberschrift stehen kann.
   * Ohne die Trennung stuende ein Termin von vorletztem Jahr zwischen zwei
   * kommenden, und die Liste laese sich nicht mehr ueberfliegen.
   */
  const vorbei = (zeile: (typeof zeilen)[number]): boolean =>
    (zeile.endAt ?? zeile.startAt).getTime() < heute.getTime();
  const kommend = istListe ? zeilen.filter((zeile) => !vorbei(zeile)) : zeilen;
  const vergangen = istListe ? zeilen.filter(vorbei) : [];

  const teile = teileIn(anker, zone);
  const titel = istListe
    ? 'Alle Events'
    : query.view === 'month'
      ? new Intl.DateTimeFormat('de-CH', { timeZone: zone, month: 'long', year: 'numeric' }).format(anker)
      : query.view === 'week'
        ? `${new Intl.DateTimeFormat('de-CH', { timeZone: zone, day: '2-digit', month: 'short' }).format(von)} – ${new Intl.DateTimeFormat('de-CH', { timeZone: zone, day: '2-digit', month: 'short' }).format(tageSpaeter(bis, zone, -1))}`
        : 'Die nächsten Wochen';

  const schritt = query.view === 'week' ? 7 : query.view === 'agenda' ? 30 : 0;
  const vorher =
    schritt > 0
      ? tageSpaeter(anker, zone, -schritt)
      : new Date(Date.UTC(teile.jahr, teile.monat - 2, 15, 12));
  const nachher =
    schritt > 0 ? tageSpaeter(anker, zone, schritt) : new Date(Date.UTC(teile.jahr, teile.monat, 15, 12));

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
        // In der Liste bewegt der Zeitraum nichts - sie zeigt ohnehin alles.
        // Eine Steuerung, die sichtbar ist und nichts bewirkt, ist schlimmer
        // als keine: man klickt, nichts passiert, und man sucht den Fehler
        // bei sich. In Monat und Woche bleibt sie unveraendert.
        zeitraumRelevant={!istListe}
      />

      {zeilen.length === 0 ? (
        <EmptyState
          title={istListe ? 'Noch keine Events' : 'Keine Events in diesem Zeitraum'}
          description={
            query.search || query.categoryId || query.mine || query.withRegistration || query.withFreeSeats
              ? 'Für diese Auswahl gibt es nichts. Setze die Filter zurück, um mehr zu sehen.'
              : 'Sobald ein Event angelegt wurde, erscheint es hier.'
          }
        />
      ) : istListe ? (
        /*
          Die Liste - auf jedem Bildschirm dieselbe.

          Kommende zuerst, vergangene darunter unter eigener Ueberschrift.
          Beide Bloecke sind dieselbe `Agendaansicht` wie zuvor; sie gruppiert
          nach Tagen und bekommt hier nur zweimal eine Teilmenge statt einmal
          alles.
        */
        <div className="space-y-8">
          {kommend.length > 0 ? <Agendaansicht {...gitterProps} zeilen={kommend} /> : null}

          {vergangen.length > 0 ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 border-t border-border/60 pt-6 text-sm font-semibold text-muted-foreground">
                <CalendarDays className="size-4" aria-hidden="true" />
                Vergangene Events
              </h2>
              <Agendaansicht {...gitterProps} zeilen={vergangen} />
            </section>
          ) : null}
        </div>
      ) : (
        <>
          {/* Auf dem Telefon immer die Agenda: ein zusammengequetschtes
              Monatsgitter laesst sich weder lesen noch treffen. */}
          <div className="md:hidden">
            <Agendaansicht {...gitterProps} />
          </div>
          <div className="hidden md:block">
            {query.view === 'month' ? <Monatsansicht {...gitterProps} /> : <Wochenansicht {...gitterProps} />}
          </div>
        </>
      )}

      {!istListe && zeilen.length > 0 ? (
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
        Alle Zeiten in {zone}. Events ohne Endzeit werden mit {settings.defaultDurationMinutes} Minuten
        dargestellt.
      </p>
    </>
  );
}
