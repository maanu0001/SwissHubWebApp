import type { Metadata } from 'next';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { KategorienVerwaltung } from '@/modules/calendar/components/kategorien-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Kalender – Kategorien' };
export const dynamic = 'force-dynamic';

/** Kategorien anlegen, einfärben und stilllegen. */
export default async function KategorienPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(calendar.CALENDAR_PERMISSIONS.categoriesManage);

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return (
      <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist deaktiviert." />
    );
  }

  const kategorien = await calendar.listCategories();

  return (
    <>
      <PageHeader
        title="Event-Kategorien"
        description="Farbe, Symbol und ein Vorgabe-Banner unterscheiden Events im Kalender. Eine stillgelegte Kategorie verschwindet aus der Auswahl, bleibt aber an ihren Events."
      />
      <KategorienVerwaltung
        csrfToken={csrfTokenFor(context)}
        kategorien={kategorien.map((eintrag) => ({
          id: eintrag.id,
          name: eintrag.name,
          description: eintrag.description ?? '',
          color: eintrag.color,
          icon: eintrag.icon ?? '',
          defaultBannerUrl: eintrag.defaultBannerUrl ?? '',
          active: eintrag.active,
          position: eintrag.position,
        }))}
      />
    </>
  );
}
