import type { Metadata } from 'next';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { listModuleDefinitions, loadAvatarHashes } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buttonVariants } from '@/components/ui/button';
import { PageToolbar } from '@/components/shared/page-header';
import { Pagination } from '@/components/shared/pagination';
import { AuditEntry, auditActionLabel } from '@/components/shared/audit-entry';
import { EmptyState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';
import { AUDIT_ACTION_OPTIONS, auditFilterSchema, checkAuditIntegrity, loadAuditLog } from '@/server/audit';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Audit Log' };
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  await requirePagePermission('audit.view');
  const params = await searchParams;
  const filter = auditFilterSchema.parse(params);

  const [result, integrity] = await Promise.all([loadAuditLog(filter), checkAuditIntegrity()]);
  // Avatare der Ausführenden gesammelt nachschlagen.
  const avatarHashes = await loadAvatarHashes(result.items.map((entry) => entry.actorDiscordId));
  const modules = listModuleDefinitions();

  const buildHref = (page: number): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') {
        search.set(key, value);
      }
    }
    if (page > 1) {
      search.set('page', String(page));
    }
    const queryString = search.toString();
    return queryString ? `/audit?${queryString}` : '/audit';
  };

  return (
    <>
      <PageToolbar
        actions={
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
              integrity.valid
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {integrity.valid ? (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldX className="size-3.5" aria-hidden="true" />
            )}
            {integrity.valid
              ? `Hash-Chain intakt (${integrity.checked} geprüft)`
              : 'Hash-Chain verletzt - bitte prüfen'}
          </span>
        }
      >
        <p className="text-sm text-muted-foreground">
          Einträge können über die Oberfläche weder bearbeitet noch gelöscht werden.
        </p>
      </PageToolbar>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>Einträge nach Benutzer, Aktion, Modul oder Zeitraum eingrenzen.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="filter-actor">Moderator</Label>
              <Input
                id="filter-actor"
                name="actor"
                defaultValue={params.actor ?? ''}
                placeholder="Username oder ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-target">Zielbenutzer</Label>
              <Input
                id="filter-target"
                name="target"
                defaultValue={params.target ?? ''}
                placeholder="Username oder ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-action">Aktion</Label>
              <select
                id="filter-action"
                name="action"
                defaultValue={params.action ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="">Alle</option>
                {AUDIT_ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {auditActionLabel(action)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-module">Modul</Label>
              <select
                id="filter-module"
                name="module"
                defaultValue={params.module ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="">Alle</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-from">Von</Label>
              <Input id="filter-from" name="from" type="date" defaultValue={params.from ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-to">Bis</Label>
              <Input id="filter-to" name="to" type="date" defaultValue={params.to ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-outcome">Ergebnis</Label>
              <select
                id="filter-outcome"
                name="outcome"
                defaultValue={params.outcome ?? 'all'}
                className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="all">Alle</option>
                <option value="success">Erfolgreich</option>
                <option value="error">Fehler</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className={cn(buttonVariants({ variant: 'default' }), 'flex-1')}>
                Filtern
              </button>
              <a href="/audit" className={cn(buttonVariants({ variant: 'outline' }))}>
                Zurücksetzen
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {result.items.length === 0 ? (
            <EmptyState
              title="Keine Einträge"
              description="Für die gewählten Filter gibt es keine Einträge."
            />
          ) : (
            <ul>
              {result.items.map((entry) => (
                <AuditEntry
                  key={entry.id}
                  entry={{
                    id: entry.id,
                    createdAt: entry.createdAt,
                    action: entry.action,
                    module: entry.module,
                    actorUsername: entry.actorUsername,
                    actorDiscordId: entry.actorDiscordId,
                    actorAvatarHash: avatarHashes.get(entry.actorDiscordId ?? '') ?? null,
                    targetLabel: entry.targetLabel,
                    targetDiscordId: entry.targetDiscordId,
                    success: entry.success,
                    errorCode: entry.errorCode,
                    metadata: entry.metadata,
                  }}
                />
              ))}
            </ul>
          )}
          {result.totalPages > 1 ? (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              buildHref={buildHref}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
