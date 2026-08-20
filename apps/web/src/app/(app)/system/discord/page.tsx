import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { getSyncStatus } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/shared/states';
import { SyncButton } from '@/modules/configuration/components/sync-button';
import { csrfTokenFor, hasSetupAccess, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Discord-Sync' };
export const dynamic = 'force-dynamic';

/**
 * Discord-Abgleich.
 *
 * Der Bot synchronisiert beim Start, bei Discord-Ereignissen und regelmässig.
 * Hier lässt sich der Abgleich zusätzlich von Hand anstossen und nachvollziehen.
 */
export default async function DiscordSyncPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('settings.view', { allowDuringSetup: true });
  const csrfToken = csrfTokenFor(context);
  const canSync = can(context, 'settings.edit') || (await hasSetupAccess());

  const [status, runs] = await Promise.all([
    getSyncStatus(),
    prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);

  const stale =
    status.lastSyncedAt === null || Date.now() - status.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Abgleich mit Discord</CardTitle>
          <CardDescription>
            Rollen und Channels werden gespiegelt, damit Auswahllisten sofort verfügbar bleiben - auch wenn
            Discord kurzzeitig nicht erreichbar ist. Mitglieder werden bewusst nicht gespeichert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rollen</dt>
              <dd className="text-lg font-semibold tabular-nums">{status.roles}</dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Channels</dt>
              <dd className="text-lg font-semibold tabular-nums">{status.channels}</dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Letzter Abgleich</dt>
              <dd className="text-sm">
                {status.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : 'noch nie'}
              </dd>
            </div>
          </dl>

          {stale ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Der letzte Abgleich liegt lange zurück oder hat nie stattgefunden. Läuft der Bot?
            </p>
          ) : null}

          {canSync ? (
            <SyncButton csrfToken={csrfToken} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Zum Starten eines Abgleichs wird die Berechtigung „Einstellungen bearbeiten“ benötigt.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Letzte Läufe</CardTitle>
          <CardDescription>Auslöser, Ergebnis und Fehler der letzten zehn Abgleiche.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState title="Noch kein Abgleich" description="Es wurde bisher kein Abgleich ausgeführt." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeitpunkt</TableHead>
                  <TableHead>Auslöser</TableHead>
                  <TableHead className="text-right">Rollen</TableHead>
                  <TableHead className="text-right">Channels</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(run.startedAt)}</TableCell>
                    <TableCell>{run.trigger}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.roles}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.channels}</TableCell>
                    <TableCell>
                      {run.success ? (
                        <Badge variant="success">erfolgreich</Badge>
                      ) : (
                        <Badge variant="destructive" title={run.error ?? undefined}>
                          fehlgeschlagen
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
