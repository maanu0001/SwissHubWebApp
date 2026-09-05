import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRightLeft } from 'lucide-react';
import { migration } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { formatDateTime } from '@swisshub/shared';
import { can } from '@swisshub/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { PageToolbar } from '@/components/shared/page-header';
import { NeueUebertragung } from '@/modules/migration/components/neue-uebertragung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Migrate' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'outline' | 'destructive' }> =
  {
    DRAFT: { label: 'Entwurf', variant: 'outline' },
    VALIDATING: { label: 'Wird geprüft', variant: 'outline' },
    READY: { label: 'Bereit', variant: 'warning' },
    RUNNING: { label: 'Läuft', variant: 'warning' },
    PARTIAL: { label: 'Teilweise', variant: 'destructive' },
    COMPLETED: { label: 'Abgeschlossen', variant: 'success' },
    FAILED: { label: 'Gescheitert', variant: 'destructive' },
    ROLLED_BACK: { label: 'Zurückgenommen', variant: 'outline' },
  };

/**
 * Die Übersicht der Übertragungen.
 *
 * Ein Werkzeug, das man selten braucht und dann genau versteht haben will.
 * Deshalb steht hier nicht mehr als nötig: was zuletzt lief, in welchem
 * Zustand es endete, und der Weg zu einer neuen.
 */
export default async function MigratePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(migration.MIGRATION_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);

  const guildId = await resolveGuildId().catch(() => '');
  const laeufe = guildId ? await migration.listeLaeufe(guildId) : [];
  const darfAnlegen = can(context, migration.MIGRATION_PERMISSIONS.import);

  return (
    <div className="space-y-6">
      <PageToolbar>{darfAnlegen ? <NeueUebertragung csrfToken={csrfToken} /> : null}</PageToolbar>

      <Card>
        <CardHeader>
          <CardTitle>Was hier geschieht</CardTitle>
          <CardDescription>
            Eine Übertragung nimmt die Konfiguration dieser Installation - Module, Einstellungen,
            Berechtigungen, Automationen - und schreibt sie auf eine andere Discord-Guild. Rollen und Kanäle
            werden dabei zugeordnet, nicht kopiert: eine Rolle der einen Guild gibt es in der anderen nicht.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Zugangsdaten werden nie übertragen.</strong> Weder Tokens noch
            Schlüssel noch der Schlüssel der Geheimnisverwaltung. Was am Ziel neu einzurichten ist, steht im
            Probelauf.
          </p>
          <p>
            <strong className="text-foreground">Historie bleibt, wo sie ist.</strong> Tickets, Massnahmen,
            Anträge und Statistiken werden nicht mitgenommen - sie gehören zu der Guild, in der sie entstanden
            sind.
          </p>
          <p>
            <strong className="text-foreground">Automationen kommen ausgeschaltet an.</strong> Eine Automation
            des Testservers soll nicht auf einem öffentlichen Server handeln, bevor jemand sie gelesen hat.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Übertragungen</CardTitle>
        </CardHeader>
        <CardContent>
          {laeufe.length === 0 ? (
            <EmptyState
              title="Noch keine Übertragung"
              description="Eine neue Übertragung beginnt mit dem Ziel und endet mit einem Probelauf, bevor irgendetwas geschrieben wird."
            />
          ) : (
            <ul className="space-y-2">
              {laeufe.map((lauf) => {
                const status = STATUS[lauf.status] ?? { label: lauf.status, variant: 'outline' as const };
                return (
                  <li key={lauf.id}>
                    <Link
                      href={`/migrate/${lauf.id}`}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:bg-accent"
                    >
                      <ArrowRightLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">nach {lauf.targetGuildId}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatDateTime(lauf.createdAt)} · {lauf.createdByUsername}
                          {lauf.phase ? ` · ${lauf.phase}` : ''}
                        </span>
                      </span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
