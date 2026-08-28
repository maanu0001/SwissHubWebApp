import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, CheckCircle2, Clock, ListChecks, MessageSquare, XCircle } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, verification } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { SetupPruefung } from '@/modules/verification/components/setup-pruefung';
import { AiBadge, StatusBadge, dauer } from '@/modules/verification/components/shared';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Verifikation' };
export const dynamic = 'force-dynamic';

const P = verification.VERIFICATION_PERMISSIONS;

/** Übersicht: Kennzahlen, Einrichtungstest und die letzten Entscheidungen. */
export default async function VerifikationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.review, P.settingsManage]);

  if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="Die Verifikation ist derzeit ausgeschaltet. Neue Mitglieder erhalten keine Rolle und werden nicht geprüft."
      />
    );
  }

  const [zahlen, verlauf, settings] = await Promise.all([
    verification.kennzahlen(),
    can(context, P.historyView) ? verification.listHistory('ALL', { limit: 8 }) : Promise.resolve([]),
    verification.verificationSettings(),
  ]);

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {can(context, P.review) ? (
          <Button asChild>
            <Link href="/verifikation/warteschlange">
              <ListChecks aria-hidden="true" />
              Warteschlange
              {zahlen.wartetAufModeration > 0 ? ` (${zahlen.wartetAufModeration})` : ''}
            </Link>
          </Button>
        ) : null}
        {can(context, P.historyView) ? (
          <Button variant="outline" asChild>
            <Link href="/verifikation/verlauf">Verlauf</Link>
          </Button>
        ) : null}
        {can(context, P.settingsManage) ? (
          <Button variant="outline" asChild>
            <Link href={`/modules/${verification.VERIFICATION_MODULE_ID}`}>Einstellungen</Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Wartet auf Nachricht"
          value={String(zahlen.wartetAufNachricht)}
          hint="Beigetreten, noch nichts geschrieben"
          icon={<MessageSquare aria-hidden="true" />}
        />
        <StatCard
          label="Wartet auf Moderation"
          value={String(zahlen.wartetAufModeration)}
          hint="Nachricht da, Entscheidung offen"
          icon={<ListChecks aria-hidden="true" />}
        />
        <StatCard
          label="Ø Wartezeit heute"
          value={zahlen.schnittWartezeit === null ? '—' : dauer(zahlen.schnittWartezeit)}
          hint={
            zahlen.schnittBasis > 0
              ? `Median ${zahlen.medianWartezeit === null ? '—' : dauer(zahlen.medianWartezeit)} · ${zahlen.schnittBasis} Fälle`
              : 'Heute noch nichts entschieden'
          }
          icon={<Clock aria-hidden="true" />}
        />
        <StatCard
          label="Heute verifiziert"
          value={String(zahlen.heuteVerifiziert)}
          hint={`davon ${zahlen.heuteAiVerifiziert} durch die AI`}
          icon={<CheckCircle2 aria-hidden="true" />}
        />
        <StatCard
          label="Heute abgelehnt"
          value={String(zahlen.heuteAbgelehnt)}
          hint="Ausschliesslich durch Menschen"
          icon={<XCircle aria-hidden="true" />}
        />
        <StatCard
          label="AI-Prüfung"
          value={
            !settings.aiEnabled
              ? 'Aus'
              : settings.aiAutoVerify
                ? `ab ${Math.round(settings.aiThreshold * 100)} %`
                : 'nur Vorschlag'
          }
          hint={
            settings.aiEnabled
              ? `${zahlen.aiAnfragenHeute} Anfragen heute · ${zahlen.aiFehlerHeute} Fehler`
              : 'Es entscheiden ausschliesslich Menschen'
          }
          icon={<Bot aria-hidden="true" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="7 Tage"
          description="Quoten über die letzten sieben Tage."
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Von der AI freigeschaltet</dt>
              <dd className="tabular-nums">
                {zahlen.aiQuote7Tage === null ? '—' : `${zahlen.aiQuote7Tage} %`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Abgelehnt</dt>
              <dd className="tabular-nums">
                {zahlen.ablehnQuote7Tage === null ? '—' : `${zahlen.ablehnQuote7Tage} %`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Ohne Nachricht abgelaufen</dt>
              <dd className="tabular-nums">{zahlen.ohneNachricht7Tage}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Ein «—» heisst, dass es in diesem Zeitraum nichts zu rechnen gab - nicht null Prozent.
          </p>
        </Panel>

        {can(context, P.settingsManage) ? (
          <SetupPruefung csrfToken={csrfTokenFor(context)} />
        ) : null}
      </div>

      {can(context, P.historyView) ? (
        <Panel
          title="Zuletzt entschieden"
          action={{ label: 'Ganzer Verlauf', href: '/verifikation/verlauf' }}
        >
          {verlauf.length === 0 ? (
            <EmptyState title="Noch nichts entschieden" className="border-0" />
          ) : (
            <ul className="space-y-2">
              {verlauf.map((eintrag) => (
                <li
                  key={eintrag.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {eintrag.displayName ?? eintrag.username ?? eintrag.discordId}
                  </span>
                  <StatusBadge status={eintrag.status} />
                  <AiBadge verdict={eintrag.aiVerdict} confidence={eintrag.aiConfidence} />
                  <span className="text-xs text-muted-foreground">
                    {eintrag.decidedBy === 'AI'
                      ? 'AI'
                      : (eintrag.decidedByUsername ?? eintrag.decidedBy ?? '—')}
                    {eintrag.dauer !== null ? ` · ${dauer(eintrag.dauer)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </>
  );
}
