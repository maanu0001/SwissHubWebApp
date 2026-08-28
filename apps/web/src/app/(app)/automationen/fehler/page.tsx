import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { automation, isModuleEnabled } from '@swisshub/modules';
import { holeFehler, holeOffeneFreigaben } from '@swisshub/automation';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Freigaben } from '@/modules/automation/components/freigaben';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Fehler' };
export const dynamic = 'force-dynamic';

const P = automation.AUTOMATION_PERMISSIONS;

/**
 * Der Fehler-Posteingang (§26).
 *
 * Gescheiterte Läufe verschwinden nicht. Sie stehen hier, bis jemand
 * hinsieht - denn eine Automation, die still scheitert, ist schlimmer als
 * eine, die gar nicht existiert: man verlässt sich auf sie.
 */
export default async function FehlerPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.historyView]);

  if (!(await isModuleEnabled(automation.AUTOMATION_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Automation Engine ist ausgeschaltet." />;
  }

  const guildId = await resolveGuildId();
  const [fehler, freigaben] = await Promise.all([
    holeFehler(guildId, 50),
    can(context, P.approve) ? holeOffeneFreigaben(guildId, 20) : Promise.resolve([]),
  ]);

  return (
    <>
      {freigaben.length > 0 ? (
        <Panel title="Warten auf eine Freigabe">
          <Freigaben
            csrfToken={csrfTokenFor(context)}
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

      <Panel
        title="Gescheiterte Läufe"
        description="Sie bleiben stehen, bis jemand hinsieht - still zu verschwinden wäre das Schlimmste."
        icon={<AlertTriangle className="size-4" aria-hidden="true" />}
      >
        {fehler.length === 0 ? (
          <EmptyState title="Nichts gescheitert" className="border-0" />
        ) : (
          <ul className="space-y-2">
            {fehler.map((lauf) => (
              <li key={lauf.id} className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/automationen/${lauf.automationId}`}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  >
                    {lauf.automation.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {lauf.eventType ?? lauf.trigger} · {lauf.createdAt.toLocaleString('de-CH')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-destructive">
                  {lauf.error ?? 'Ohne nähere Angabe.'}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/automationen">Zurück</Link>
          </Button>
        </div>
      </Panel>
    </>
  );
}
