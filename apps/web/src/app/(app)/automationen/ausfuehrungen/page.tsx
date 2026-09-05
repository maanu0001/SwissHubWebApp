import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveGuildId } from '@swisshub/discord';
import { automation, isModuleEnabled } from '@swisshub/modules';
import { holeVerlauf } from '@swisshub/automation';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Ausführungen' };
export const dynamic = 'force-dynamic';

const P = automation.AUTOMATION_PERMISSIONS;

/**
 * Der Verlauf.
 *
 * Die einzige Antwort auf «warum hat das Ding das getan?». Deshalb steht hier
 * jeder Lauf mit seinem Ausgang - auch die übersprungenen: dass eine
 * Automation *nicht* gehandelt hat, ist genauso oft die Frage.
 */
export default async function AusfuehrungenPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}): Promise<React.JSX.Element> {
  await requirePagePermission([P.historyView]);
  const { cursor, status } = await searchParams;

  if (!(await isModuleEnabled(automation.AUTOMATION_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Automation Engine ist ausgeschaltet." />;
  }

  const guildId = await resolveGuildId();
  const verlauf = await holeVerlauf({
    guildId,
    limit: 50,
    ...(cursor ? { cursor } : {}),
    ...(status === 'fehler' ? { status: ['FAILED', 'DEAD_LETTER'] as const } : {}),
  });

  return (
    <Panel
      title="Ausführungen"
      description="Jeder Lauf mit seinem Ausgang. Ein übersprungener Lauf heisst: die Bedingungen trafen nicht zu."
    >
      {verlauf.eintraege.length === 0 ? (
        <EmptyState title="Noch keine Ausführung" className="border-0" />
      ) : (
        <ul className="space-y-2">
          {verlauf.eintraege.map((lauf) => (
            <li
              key={lauf.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              <Link
                href={`/automationen/${lauf.automationId}`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {lauf.automationName}
              </Link>
              <span className="text-xs text-muted-foreground">{lauf.eventType ?? lauf.trigger}</span>
              <StatusText status={lauf.status} />
              <span className="text-xs tabular-nums text-muted-foreground">
                {lauf.createdAt.toLocaleString('de-CH')}
                {lauf.durationMs !== null ? ` · ${Math.round(lauf.durationMs)} ms` : ''}
                {lauf.dryRun ? ' · Probelauf' : ''}
              </span>
              {lauf.error ? (
                <span className="w-full truncate text-xs text-destructive">{lauf.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/automationen">Zurück</Link>
        </Button>
        {verlauf.naechsterCursor ? (
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/automationen/ausfuehrungen?cursor=${verlauf.naechsterCursor}${status ? `&status=${status}` : ''}`}
            >
              Ältere anzeigen
            </Link>
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

const FARBE: Record<string, string> = {
  SUCCESS: 'text-emerald-500',
  SKIPPED: 'text-muted-foreground',
  FAILED: 'text-destructive',
  DEAD_LETTER: 'text-destructive',
  CANCELLED: 'text-muted-foreground',
  WAITING: 'text-amber-500',
  AWAITING_APPROVAL: 'text-amber-500',
  RUNNING: 'text-primary',
  PENDING: 'text-muted-foreground',
};

function StatusText({ status }: { status: string }): React.JSX.Element {
  return <span className={`text-xs ${FARBE[status] ?? 'text-muted-foreground'}`}>{status}</span>;
}
