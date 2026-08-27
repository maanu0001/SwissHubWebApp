import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { EventFormular } from '@/modules/calendar/components/event-formular';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { alsEingabewert, formularAuswahl } from '@/server/kalender';

export const metadata: Metadata = { title: 'Event bearbeiten' };
export const dynamic = 'force-dynamic';

const P = calendar.CALENDAR_PERMISSIONS;

/**
 * Ein bestehendes Event bearbeiten.
 *
 * Zwei Wege fuehren her: die allgemeine Bearbeitungsberechtigung, oder
 * Zustaendigkeit fuer genau dieses Event. Die Server Action prueft dasselbe
 * noch einmal - diese Seite entscheidet nur, was gezeigt wird.
 */
export default async function EventBearbeitenPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.edit, P.manageOwn]);
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

  const darf =
    can(context, P.edit) ||
    (can(context, P.manageOwn) && calendar.istZustaendig(event, context.user.discordId));
  if (!darf) {
    return (
      <ErrorState
        title="Kein Zugriff"
        description="Du bist für dieses Event nicht als Organisation eingetragen."
      />
    );
  }
  if (event.status === 'COMPLETED' || event.status === 'CANCELLED') {
    return (
      <ErrorState
        title="Nicht mehr bearbeitbar"
        description="Ein beendetes oder abgesagtes Event lässt sich nicht mehr ändern. Dupliziere es, um einen neuen Termin anzulegen."
      />
    );
  }

  const [auswahl, fragen, erinnerungen] = await Promise.all([
    formularAuswahl(),
    calendar.listQuestions(event.id),
    calendar.listReminders(event.id),
  ]);

  return (
    <>
      <PageHeader
        title={`${event.title} bearbeiten`}
        description="Änderungen an Zeit oder Ort lassen sich anschliessend den Angemeldeten mitteilen."
      />
      <EventFormular
        csrfToken={csrfTokenFor(context)}
        werte={{
          eventId: event.id,
          title: event.title,
          description: event.description,
          shortDescription: event.shortDescription ?? '',
          categoryId: event.categoryId ?? '',
          startAt: alsEingabewert(event.startAt, event.timezone),
          endAt: alsEingabewert(event.endAt, event.timezone),
          timezone: event.timezone,
          allDay: event.allDay,
          locationKind: event.locationKind,
          locationChannelId: event.locationChannelId ?? '',
          locationVoiceId: event.locationVoiceId ?? '',
          locationUrl: event.locationUrl ?? '',
          locationName: event.locationName ?? '',
          locationAddress: event.locationAddress ?? '',
          bannerUrl: event.bannerUrl ?? '',
          iconUrl: event.iconUrl ?? '',
          organizerDiscordIds: event.organizerDiscordIds,
          contactNote: event.contactNote ?? '',
          registrationEnabled: event.registrationEnabled,
          capacity: event.capacity,
          registrationClosesAt: alsEingabewert(event.registrationClosesAt, event.timezone),
          waitlistEnabled: event.waitlistEnabled,
          allowSelfCancel: event.allowSelfCancel,
          cancelDeadlineAt: alsEingabewert(event.cancelDeadlineAt, event.timezone),
          participantsPublic: event.participantsPublic,
          announceOnDiscord: event.announceOnDiscord,
          announcementChannelId: event.announcementChannelId ?? '',
          mentionRoleId: event.mentionRoleId ?? '',
          reminderMinutes: erinnerungen.map((eintrag) => eintrag.minutesBefore),
          reminderChannelId: erinnerungen[0]?.channelId ?? '',
          reminderMentionRoleId: erinnerungen[0]?.mentionRoleId ?? '',
          reminderMentionRegistrants: erinnerungen[0]?.mentionRegistrants ?? false,
          questions: fragen.map((frage) => ({
            id: frage.id,
            label: frage.label,
            hint: frage.hint ?? '',
            required: frage.required,
            choices: frage.choices,
          })),
        }}
        kategorien={auswahl.kategorien}
        kanaele={auswahl.kanaele}
        rollen={auswahl.rollen}
      />
    </>
  );
}
