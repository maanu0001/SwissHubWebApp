import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Users,
} from 'lucide-react';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { ErrorState } from '@/components/shared/states';
import { Markdown } from '@/components/shared/markdown';
import { StatCard } from '@/components/shared/stat-card';
import { AnmeldeBereich } from '@/modules/calendar/components/anmelde-bereich';
import { EventStatusBadge, KategorieBadge, datumLang, zeitspanne } from '@/modules/calendar/components/shared';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const dynamic = 'force-dynamic';

const P = calendar.CALENDAR_PERMISSIONS;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await calendar.findEvent(slug).catch(() => null);
  return { title: event ? `${event.title} – Kalender` : 'Event' };
}

/**
 * Die Detailseite eines Events.
 *
 * Erreichbar ueber Adressteil **oder** Kennung: Links aus Discord tragen den
 * Adressteil, Links aus der Verwaltung die Kennung.
 */
export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.create, P.manageOwn]);
  const { slug } = await params;

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return (
      <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist deaktiviert." />
    );
  }

  const event = await calendar.findEvent(slug);
  if (!event) {
    notFound();
  }

  const zustaendig = calendar.istZustaendig(event, context.user.discordId);
  const darfBearbeiten =
    can(context, P.edit) || (can(context, P.manageOwn) && zustaendig);

  // Ein Entwurf ist fuer gewoehnliche Mitglieder nicht vorhanden - nicht
  // «gesperrt». Wer ihn nicht verwalten darf, soll nicht einmal erfahren,
  // dass es ihn gibt.
  if (event.status === 'DRAFT' && !darfBearbeiten) {
    notFound();
  }

  const settings = await calendar.calendarSettings();
  const [belegung, meine, kategorie, fragen] = await Promise.all([
    calendar.belegung(event.id),
    calendar.meineAnmeldung(event.id, context.user.discordId),
    event.categoryId
      ? calendar
          .listCategories()
          .then((liste) => liste.find((eintrag) => eintrag.id === event.categoryId) ?? null)
      : Promise.resolve(null),
    calendar.listQuestions(event.id),
  ]);

  const darfTeilnehmerSehen =
    event.participantsPublic ||
    can(context, P.registrationsView) ||
    can(context, P.manageRegistrations) ||
    darfBearbeiten;

  const teilnehmer = darfTeilnehmerSehen
    ? await calendar.listRegistrations(event.id, {
        // Antworten auf Zusatzfragen gehen nur die Organisation etwas an -
        // sie stehen nie in der oeffentlichen Liste.
        withAnswers: can(context, P.manageRegistrations) || darfBearbeiten,
      })
    : [];

  const gesperrt = calendar.anmeldungGesperrt(event);

  return (
    <>
      <PageHeader
        title={event.title}
        description={event.shortDescription ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {darfBearbeiten && event.status !== 'COMPLETED' && event.status !== 'CANCELLED' ? (
              <Button variant="outline" asChild>
                <Link href={`/kalender/${event.slug}/bearbeiten`}>
                  <Pencil aria-hidden="true" />
                  Bearbeiten
                </Link>
              </Button>
            ) : null}
            {darfTeilnehmerSehen && event.registrationEnabled ? (
              <Button variant="outline" asChild>
                <Link href={`/kalender/${event.slug}/teilnehmer`}>
                  <Users aria-hidden="true" />
                  Teilnehmer
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              {/* Der Export ist ein Download, kein Seitenwechsel. */}
              <a href={`/api/kalender/${event.slug}/ics`} download>
                <CalendarDays aria-hidden="true" />
                Zum Kalender hinzufügen
              </a>
            </Button>
          </div>
        }
      />

      {/*
        Das eigene Banner zuerst, sonst das der Kategorie. Dieselbe Reihenfolge
        wie in der Discord-Ankündigung - ein Termin, der im Kanal ein Bild hat
        und auf der Seite keines, sähe nach zwei verschiedenen Terminen aus.
      */}
      {calendar.bannerFuer(event, kategorie) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={calendar.bannerFuer(event, kategorie)!}
          alt=""
          className="max-h-64 w-full rounded-xl border border-border object-cover"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <EventStatusBadge status={event.status} />
        <KategorieBadge kategorie={kategorie} />
        {event.registrationEnabled ? (
          <Badge variant="outline">Mit Anmeldung</Badge>
        ) : (
          <Badge variant="outline">Ohne Anmeldung</Badge>
        )}
      </div>

      {event.status === 'CANCELLED' ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            <strong>Dieses Event wurde abgesagt.</strong>
            {event.cancelReason ? ` ${event.cancelReason}` : null}
          </span>
        </p>
      ) : null}

      {event.discordMessageMissing && darfBearbeiten ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Die Discord-Ankündigung ist nicht mehr auffindbar. In der Verwaltung lässt sie sich
            erneut senden.
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Datum"
          value={datumLang(event.startAt, event.timezone)}
          hint={event.timezone}
          icon={<CalendarDays aria-hidden="true" />}
        />
        <StatCard
          label="Zeit"
          value={zeitspanne(event)}
          hint={event.endAt ? 'Beginn bis Ende' : 'Offenes Ende'}
          icon={<Clock aria-hidden="true" />}
        />
        <StatCard
          label="Ort"
          value={
            calendar.ortsArt(event) === 'DISCORD'
              ? 'Discord'
              : (event.locationName ?? 'Vor Ort')
          }
          hint={event.locationAddress ?? undefined}
          icon={<MapPin aria-hidden="true" />}
        />
        <StatCard
          label="Teilnehmer"
          value={
            event.registrationEnabled
              ? belegung.capacity > 0
                ? `${belegung.confirmed} / ${belegung.capacity}`
                : `${belegung.confirmed}`
              : '—'
          }
          hint={
            belegung.waitlist > 0 ? `${belegung.waitlist} auf der Warteliste` : 'Keine Warteliste'
          }
          icon={<Users aria-hidden="true" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Beschreibung">
            <Markdown text={event.description} />
          </Panel>

          {darfTeilnehmerSehen && event.registrationEnabled ? (
            <Panel
              title="Teilnehmende"
              description={
                event.participantsPublic
                  ? 'Diese Liste ist für alle Mitglieder sichtbar.'
                  : 'Diese Liste sehen nur Organisation und Verwaltung.'
              }
            >
              {teilnehmer.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch niemand angemeldet.</p>
              ) : (
                <ul className="space-y-2">
                  {teilnehmer.map((eintrag) => (
                    <li
                      key={eintrag.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">
                        {eintrag.displayName ?? eintrag.username ?? eintrag.discordId}
                      </span>
                      {eintrag.status === 'WAITLIST' ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-amber-500"
                        >
                          Warteliste {eintrag.waitlistPosition}
                        </Badge>
                      ) : null}
                      {eintrag.answers.length > 0 ? (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {eintrag.answers
                            .map((antwort) => `${antwort.question}: ${antwort.value}`)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          {event.registrationEnabled ? (
            <AnmeldeBereich
              csrfToken={csrfTokenFor(context)}
              eventId={event.id}
              darfTeilnehmen={can(context, P.participate)}
              gesperrtGrund={gesperrt}
              abmeldenGrund={calendar.abmeldungGesperrt(event)}
              meine={
                meine
                  ? { status: meine.status, position: meine.waitlistPosition }
                  : null
              }
              belegung={{
                confirmed: belegung.confirmed,
                capacity: belegung.capacity,
                waitlist: belegung.waitlist,
                full: belegung.full,
              }}
              wartelisteMoeglich={event.waitlistEnabled}
              fragen={fragen}
            />
          ) : null}

          <Panel title="Wo & Wer">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Ort</dt>
                <dd className="mt-0.5">
                  {event.locationChannelId ? (
                    <span>Discord-Kanal</span>
                  ) : event.locationName ? (
                    <span>{event.locationName}</span>
                  ) : (
                    <span>SwissHub Discord</span>
                  )}
                  {event.locationAddress ? (
                    <span className="block text-muted-foreground">{event.locationAddress}</span>
                  ) : null}
                </dd>
              </div>
              {event.locationUrl ? (
                <div>
                  <dt className="text-muted-foreground">Link</dt>
                  <dd className="mt-0.5">
                    <a
                      href={event.locationUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Öffnen
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Organisation</dt>
                <dd className="mt-0.5">
                  {event.contactNote ?? `${event.organizerDiscordIds.length + 1} Person(en)`}
                </dd>
              </div>
              {event.registrationClosesAt ? (
                <div>
                  <dt className="text-muted-foreground">Anmeldeschluss</dt>
                  <dd className="mt-0.5">
                    {datumLang(event.registrationClosesAt, event.timezone)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Panel>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Zeiten in {event.timezone}.
        {!event.endAt
          ? ` Ohne Endzeit rechnet der Kalenderexport mit ${settings.defaultDurationMinutes} Minuten.`
          : null}
      </p>
    </>
  );
}
