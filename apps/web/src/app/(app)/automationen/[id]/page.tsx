import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { automation, isModuleEnabled } from '@swisshub/modules';
import { holeAutomation, holeVerlauf, type ConditionNode, type StepNode } from '@swisshub/automation';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Builder } from '@/modules/automation/components/builder';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeBausteine } from '@/server/automation';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Automation' };
export const dynamic = 'force-dynamic';

const P = automation.AUTOMATION_PERMISSIONS;

/**
 * Eine Automation ansehen und bearbeiten.
 *
 * Eine Systemautomation wird gezeigt, aber nicht zum Bearbeiten freigegeben:
 * sie gehoert SwissHub und wird beim Start abgeglichen. Was hier jemand
 * aenderte, waere nach dem naechsten Deployment wieder weg - und das waere
 * die verwirrendste Art, eine Aenderung zu verlieren.
 */
export default async function AutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.edit]);
  const { id } = await params;

  if (!(await isModuleEnabled(automation.AUTOMATION_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Automation Engine ist ausgeschaltet." />;
  }

  const guildId = await resolveGuildId();
  const eintrag = await holeAutomation(guildId, id);
  if (!eintrag || eintrag.archivedAt) {
    notFound();
  }

  const [bausteine, discordOptions, verlauf] = await Promise.all([
    ladeBausteine(),
    loadDiscordOptions(),
    can(context, P.historyView)
      ? holeVerlauf({ guildId, automationId: id, limit: 10 })
      : Promise.resolve({ eintraege: [], naechsterCursor: null }),
  ]);

  const istSystem = eintrag.kind === 'SYSTEM';
  const darfSpeichern = can(context, P.edit) && !istSystem;

  return (
    <>
      {istSystem ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Eine Systemautomation von SwissHub. Sie lässt sich ein- und ausschalten, aber nicht
          bearbeiten - beim nächsten Deployment würde die Änderung überschrieben.
        </div>
      ) : null}

      <Builder
        csrfToken={csrfTokenFor(context)}
        bausteine={bausteine}
        roles={discordOptions.roles}
        channels={discordOptions.channels}
        eigeneRechte={context.permissionKeys}
        darfSpeichern={darfSpeichern}
        entwurf={{
          id: eintrag.id,
          name: eintrag.name,
          description: eintrag.description ?? '',
          triggerType: eintrag.triggerType,
          triggerConfig: (eintrag.triggerConfig ?? {}) as Record<string, unknown>,
          conditions: (eintrag.conditions ?? null) as ConditionNode | null,
          steps: (eintrag.steps ?? []) as StepNode[],
          concurrency: eintrag.concurrency,
          concurrencyKey: eintrag.concurrencyKey ?? '',
          maxRunsPerMinute: eintrag.maxRunsPerMinute,
        }}
      />

      {can(context, P.historyView) ? (
        <Panel
          title="Letzte Läufe"
          action={{ label: 'Ganzer Verlauf', href: '/automationen/ausfuehrungen' }}
        >
          {verlauf.eintraege.length === 0 ? (
            <EmptyState title="Noch nicht gelaufen" className="border-0" />
          ) : (
            <ul className="space-y-2">
              {verlauf.eintraege.map((lauf) => (
                <li
                  key={lauf.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {lauf.createdAt.toLocaleString('de-CH')}
                    {lauf.dryRun ? ' · Probelauf' : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">{lauf.status}</span>
                  {lauf.error ? (
                    <span className="w-full truncate text-xs text-destructive">{lauf.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Button variant="outline" size="sm" asChild>
              <Link href="/automationen">Zurück zur Übersicht</Link>
            </Button>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
