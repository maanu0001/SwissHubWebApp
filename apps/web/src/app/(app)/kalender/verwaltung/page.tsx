import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarCheck, CalendarClock, CalendarX, FileEdit, Plus, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { VerwaltungsTabelle } from '@/modules/calendar/components/verwaltungs-tabelle';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Kalender – Verwaltung' };
export const dynamic = 'force-dynamic';

const P = calendar.CALENDAR_PERMISSIONS;

const TABS = [
  { id: 'SCHEDULED', label: 'Geplant' },
  { id: 'DRAFT', label: 'Entwürfe' },
  { id: 'ONGOING', label: 'Laufend' },
  { id: 'COMPLETED', label: 'Beendet' },
  { id: 'CANCELLED', label: 'Abgesagt' },
] as const;

/** Verwaltungsansicht: Events nach Zustand, mit Kennzahlen. */
export default async function KalenderVerwaltungPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.edit, P.manageOwn, P.create]);
  const params = await searchParams;

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist deaktiviert." />;
  }

  const roh = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = TABS.some((eintrag) => eintrag.id === roh) ? (roh as (typeof TABS)[number]['id']) : 'SCHEDULED';

  const [zeilen, zahlen] = await Promise.all([
    calendar.listForManagement(tab),
    can(context, P.statsView) ? calendar.kennzahlen() : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Kalender-Verwaltung"
        description="Events anlegen, veröffentlichen, absagen und Teilnehmer verwalten."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(context, P.categoriesManage) ? (
              <Button variant="outline" asChild>
                <Link href="/kalender/kategorien">Kategorien</Link>
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
        }
      />

      {zahlen ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Kommende Events"
              value={String(zahlen.kommend)}
              hint={`${zahlen.gesamt} insgesamt`}
              icon={<CalendarClock aria-hidden="true" />}
            />
            <StatCard
              label="Anmeldungen"
              value={String(zahlen.anmeldungenGesamt)}
              hint="Bestätigt und Warteliste"
              icon={<Users aria-hidden="true" />}
            />
            <StatCard
              label="Ø Teilnehmer"
              value={zahlen.schnittTeilnehmer === null ? '—' : String(zahlen.schnittTeilnehmer)}
              hint={
                zahlen.schnittBasis > 0
                  ? `über ${zahlen.schnittBasis} beendete Events mit Anmeldung`
                  : 'Noch kein beendetes Event mit Anmeldung'
              }
              icon={<CalendarCheck aria-hidden="true" />}
            />
            <StatCard
              label="Entwürfe"
              value={String(zahlen.entwuerfe)}
              hint={`${zahlen.abgesagt} abgesagt`}
              icon={<FileEdit aria-hidden="true" />}
            />
          </div>

          {zahlen.beliebtesteKategorien.length > 0 || zahlen.bestBesucht.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {zahlen.beliebtesteKategorien.length > 0 ? (
                <Panel title="Häufigste Kategorien">
                  <ul className="space-y-2">
                    {zahlen.beliebtesteKategorien.map((eintrag) => (
                      <li key={eintrag.name} className="flex items-center gap-2 text-sm">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{ backgroundColor: eintrag.color }}
                        />
                        <span className="min-w-0 flex-1 truncate">{eintrag.name}</span>
                        <span className="tabular-nums text-muted-foreground">{eintrag.anzahl}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
              {zahlen.bestBesucht.length > 0 ? (
                <Panel title="Bestbesuchte Events">
                  <ul className="space-y-2">
                    {zahlen.bestBesucht.map((eintrag) => (
                      <li key={eintrag.id} className="flex items-center gap-2 text-sm">
                        <Link
                          href={`/kalender/${eintrag.slug}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          {eintrag.title}
                        </Link>
                        <span className="tabular-nums text-muted-foreground">{eintrag.teilnehmer}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
        {TABS.map((eintrag) => (
          <Link
            key={eintrag.id}
            href={`/kalender/verwaltung?tab=${eintrag.id}`}
            aria-current={tab === eintrag.id}
            className={
              tab === eintrag.id
                ? 'min-h-9 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                : 'min-h-9 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'
            }
          >
            {eintrag.label}
          </Link>
        ))}
      </div>

      {zeilen.length === 0 ? (
        <EmptyState
          title="Nichts in dieser Ansicht"
          description="Wähle einen anderen Zustand oder lege ein neues Event an."
        />
      ) : (
        <VerwaltungsTabelle
          csrfToken={csrfTokenFor(context)}
          zeilen={zeilen.map((zeile) => ({
            id: zeile.id,
            slug: zeile.slug,
            title: zeile.title,
            status: zeile.status,
            startAt: zeile.startAt.toISOString(),
            timezone: zeile.timezone,
            confirmed: zeile.confirmed,
            waitlist: zeile.waitlist,
            capacity: zeile.capacity,
            registrationEnabled: zeile.registrationEnabled,
          }))}
          rechte={{
            publish: can(context, P.publish),
            cancel: can(context, P.cancel),
            delete: can(context, P.delete),
            duplicate: can(context, P.create),
          }}
        />
      )}

      {tab === 'CANCELLED' ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarX className="size-3.5" aria-hidden="true" />
          Abgesagte Events bleiben erhalten - so sehen Angemeldete, dass der Abend nicht stattfindet, statt
          ihn spurlos zu vermissen.
        </p>
      ) : null}
    </>
  );
}
