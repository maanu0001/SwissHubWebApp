import type { Metadata } from 'next';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { EventFormular } from '@/modules/calendar/components/event-formular';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { formularAuswahl, leereWerte } from '@/server/kalender';

export const metadata: Metadata = { title: 'Neues Event' };
export const dynamic = 'force-dynamic';

/** Ein neues Event anlegen. Es entsteht als Entwurf. */
export default async function NeuesEventPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(calendar.CALENDAR_PERMISSIONS.create);

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist deaktiviert." />;
  }

  const [auswahl, werte] = await Promise.all([formularAuswahl(), leereWerte()]);

  return (
    <>
      <PageHeader
        title="Neues Event"
        description="Das Event entsteht als Entwurf - erst beim Veröffentlichen wird es sichtbar und angekündigt."
      />
      <EventFormular
        csrfToken={csrfTokenFor(context)}
        werte={werte}
        kategorien={auswahl.kategorien}
        kanaele={auswahl.kanaele}
        rollen={auswahl.rollen}
      />
    </>
  );
}
