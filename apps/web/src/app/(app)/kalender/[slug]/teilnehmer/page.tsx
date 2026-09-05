import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { TeilnehmerListe } from '@/modules/calendar/components/teilnehmer-liste';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Event – Teilnehmer' };
export const dynamic = 'force-dynamic';

const P = calendar.CALENDAR_PERMISSIONS;

/** Teilnehmerverwaltung eines Events. */
export default async function TeilnehmerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([
    P.manageRegistrations,
    P.registrationsView,
    P.edit,
    P.manageOwn,
  ]);
  const { slug } = await params;

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist deaktiviert." />;
  }

  const event = await calendar.findEvent(slug);
  if (!event) {
    notFound();
  }

  const zustaendig = calendar.istZustaendig(event, context.user.discordId);
  const darfSehen =
    can(context, P.registrationsView) ||
    can(context, P.manageRegistrations) ||
    can(context, P.edit) ||
    (can(context, P.manageOwn) && zustaendig);
  if (!darfSehen) {
    return (
      <ErrorState
        title="Kein Zugriff"
        description="Für die Teilnehmerliste dieses Events fehlt dir die Berechtigung."
      />
    );
  }

  const darfVerwalten =
    can(context, P.manageRegistrations) || can(context, P.edit) || (can(context, P.manageOwn) && zustaendig);

  const [teilnehmer, belegung] = await Promise.all([
    calendar.listRegistrations(event.id, { withAnswers: true, includeCancelled: true }),
    calendar.belegung(event.id),
  ]);

  return (
    <>
      <PageHeader
        title={`Teilnehmer – ${event.title}`}
        description="Anmeldungen, Warteliste und Antworten auf Zusatzfragen."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/kalender/${event.slug}`}>
              <ArrowLeft aria-hidden="true" />
              Zum Event
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Teilnehmer"
          value={String(belegung.confirmed)}
          hint={belegung.capacity > 0 ? `von ${belegung.capacity} Plätzen` : 'Unbegrenzt'}
          icon={<Users aria-hidden="true" />}
        />
        <StatCard
          label="Warteliste"
          value={String(belegung.waitlist)}
          hint={belegung.waitlist > 0 ? 'Rücken bei Absagen nach' : 'Niemand wartet'}
        />
        <StatCard
          label="Freie Plätze"
          value={belegung.freeSeats === null ? '∞' : String(belegung.freeSeats)}
          hint={belegung.full ? 'Ausgebucht' : 'Anmeldung möglich'}
        />
      </div>

      {teilnehmer.length === 0 ? (
        <EmptyState
          title="Noch niemand angemeldet"
          description="Sobald sich jemand anmeldet, erscheint er hier."
        />
      ) : (
        <TeilnehmerListe
          csrfToken={csrfTokenFor(context)}
          darfVerwalten={darfVerwalten}
          eventTitel={event.title}
          zeilen={teilnehmer.map((eintrag) => ({
            id: eintrag.id,
            discordId: eintrag.discordId,
            name: eintrag.displayName ?? eintrag.username ?? eintrag.discordId,
            status: eintrag.status,
            waitlistPosition: eintrag.waitlistPosition,
            registeredAt: eintrag.registeredAt.toISOString(),
            promoted: eintrag.promotedAt !== null,
            answers: eintrag.answers,
          }))}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Gespeichert werden nur Discord-Kennung, Namensstand zum Zeitpunkt der Anmeldung und die Antworten auf
        die gestellten Fragen.
      </p>
    </>
  );
}
