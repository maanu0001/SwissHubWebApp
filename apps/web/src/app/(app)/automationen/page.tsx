import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Activity, Clock, ListChecks, Plus, ShieldQuestion } from 'lucide-react';
import { can } from '@swisshub/auth';
import { automation, isModuleEnabled } from '@swisshub/modules';
import {
  getTrigger,
  holeOffeneFreigaben,
  laufGesundheit,
  listeAutomationen,
} from '@swisshub/automation';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { ErrorState } from '@/components/shared/states';
import { AutomationListe } from '@/modules/automation/components/automation-liste';
import { Freigaben } from '@/modules/automation/components/freigaben';
import { Vorlagen } from '@/modules/automation/components/vorlagen';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeBausteine } from '@/server/automation';
import { resolveGuildId } from '@swisshub/discord';

export const metadata: Metadata = { title: 'Automationen' };
export const dynamic = 'force-dynamic';

const P = automation.AUTOMATION_PERMISSIONS;

/** Übersicht: Zustand, die Automationen selbst, offene Freigaben und Vorlagen. */
export default async function AutomationenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.create, P.historyView]);

  if (!(await isModuleEnabled(automation.AUTOMATION_MODULE_ID))) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="Die Automation Engine ist ausgeschaltet. Es werden keine Ereignisse verteilt und keine Automationen ausgeführt."
      />
    );
  }

  const guildId = await resolveGuildId();
  const [automationen, gesundheit, freigaben, bausteine] = await Promise.all([
    listeAutomationen(guildId),
    laufGesundheit(guildId),
    can(context, P.approve) ? holeOffeneFreigaben(guildId, 10) : Promise.resolve([]),
    ladeBausteine(),
  ]);

  const csrfToken = csrfTokenFor(context);
  const aktive = automationen.filter((eintrag) => eintrag.enabled).length;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {can(context, P.create) ? (
          <Button asChild>
            <Link href="/automationen/neu">
              <Plus aria-hidden="true" />
              Neue Automation
            </Link>
          </Button>
        ) : null}
        {can(context, P.historyView) ? (
          <Button variant="outline" asChild>
            <Link href="/automationen/ausfuehrungen">Ausführungen</Link>
          </Button>
        ) : null}
        {can(context, P.historyView) ? (
          <Button variant="outline" asChild>
            <Link href="/automationen/fehler">
              Fehler
              {gesundheit.fehler24h > 0 ? ` (${gesundheit.fehler24h})` : ''}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Eingeschaltet"
          value={`${aktive} / ${automationen.length}`}
          hint="Nur eingeschaltete reagieren auf Ereignisse"
          icon={<ListChecks aria-hidden="true" />}
        />
        <StatCard
          label="Läufe (24 h)"
          value={String(gesundheit.laeufe24h)}
          hint={`${gesundheit.laufend} laufen gerade`}
          icon={<Activity aria-hidden="true" />}
        />
        <StatCard
          label="Wartend"
          value={String(gesundheit.wartend)}
          hint="Läufe in einer Wartezeit - sie überstehen einen Neustart"
          icon={<Clock aria-hidden="true" />}
        />
        <StatCard
          label="Fehler (24 h)"
          value={String(gesundheit.fehler24h)}
          hint={
            gesundheit.aufFreigabe > 0
              ? `${gesundheit.aufFreigabe} warten auf eine Freigabe`
              : 'Gescheiterte Läufe bleiben im Posteingang'
          }
          icon={<AlertTriangle aria-hidden="true" />}
        />
      </div>

      {freigaben.length > 0 ? (
        <Panel
          title="Warten auf eine Freigabe"
          description="Diese Läufe stehen still, bis ein Mensch entscheidet."
          icon={<ShieldQuestion className="size-4" aria-hidden="true" />}
        >
          <Freigaben
            csrfToken={csrfToken}
            darfEntscheiden={can(context, P.approve)}
            freigaben={freigaben.map((freigabe) => ({
              id: freigabe.id,
              automationName: freigabe.run.automation.name,
              title: freigabe.title,
              summary: freigabe.summary,
              angefragtAm: freigabe.requestedAt.toLocaleString('de-CH'),
            }))}
          />
        </Panel>
      ) : null}

      <Panel title="Automationen" description="Der Schalter entscheidet, ob sie von selbst handeln.">
        <AutomationListe
          csrfToken={csrfToken}
          darfSchalten={can(context, P.enable)}
          darfLoeschen={can(context, P.delete)}
          darfStarten={can(context, P.execute)}
          darfBearbeiten={can(context, P.edit)}
          automationen={automationen.map((eintrag) => ({
            id: eintrag.id,
            name: eintrag.name,
            description: eintrag.description,
            enabled: eintrag.enabled,
            istSystem: eintrag.kind === 'SYSTEM',
            triggerLabel: getTrigger(eintrag.triggerType)?.label ?? eintrag.triggerType,
            lastStatus: eintrag.lastStatus,
            lastRunAt: eintrag.lastRunAt?.toISOString() ?? null,
            laeufe24h: eintrag.laeufe24h,
            fehler24h: eintrag.fehler24h,
          }))}
        />
      </Panel>

      {bausteine.vorlagen.length > 0 ? (
        <Panel
          title="Vorlagen"
          description="Ein fertiger Entwurf zum Ansehen, Anpassen und Einschalten."
        >
          <Vorlagen
            csrfToken={csrfToken}
            vorlagen={bausteine.vorlagen}
            darfUebernehmen={can(context, P.create)}
          />
        </Panel>
      ) : null}
    </>
  );
}
