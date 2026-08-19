import type { Metadata } from 'next';
import Link from 'next/link';
import { listModuleStatus } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { NavIcon } from '@/components/layout/nav-icon';
import { ModuleToggle } from '@/modules/settings/components/module-toggle';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Module' };
export const dynamic = 'force-dynamic';

export default async function ModulesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('modules.manage');
  const status = await listModuleStatus();
  const csrfToken = csrfTokenFor(context);

  const features = status.filter((entry) => !entry.definition.core);
  const core = status.filter((entry) => entry.definition.core);

  return (
    <>
      <PageHeader
        title="Module"
        description="SwissHub-Module aktivieren, deaktivieren und ihre Berechtigungen einsehen."
      />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Feature-Module
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((entry) => (
            <Card key={entry.definition.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-primary/15 p-2 text-primary ring-1 ring-primary/30">
                    <NavIcon name={entry.definition.icon} className="size-5" />
                  </span>
                  <div>
                    <CardTitle>{entry.definition.name}</CardTitle>
                    <CardDescription className="mt-1">{entry.definition.description}</CardDescription>
                  </div>
                </div>
                <ModuleToggle
                  csrfToken={csrfToken}
                  moduleId={entry.definition.id}
                  moduleName={entry.definition.name}
                  enabled={entry.enabled}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {entry.definition.permissions.map((permission) => (
                    <Badge key={permission.key} variant="outline">
                      {permission.key}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    Status:{' '}
                    <span className={entry.enabled ? 'text-success' : 'text-muted-foreground'}>
                      {entry.enabled ? 'aktiv' : 'inaktiv'}
                    </span>
                  </span>
                  {entry.updatedAt ? <span>Zuletzt geaendert: {formatDateTime(entry.updatedAt)}</span> : null}
                  {entry.definition.navigation[0] ? (
                    <Link href={entry.definition.navigation[0].href} className="text-primary hover:underline">
                      Zum Modul
                    </Link>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Kernbereiche</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {core.map((entry) => (
            <Card key={entry.definition.id}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-secondary p-2 text-muted-foreground">
                    <NavIcon name={entry.definition.icon} className="size-4" />
                  </span>
                  <CardTitle className="text-sm">{entry.definition.name}</CardTitle>
                </div>
                <Badge variant="secondary">Kern</Badge>
              </CardHeader>
              <CardContent>
                <CardDescription>{entry.definition.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
