import type { Metadata } from 'next';
import Link from 'next/link';
import { getModuleHealth, listModuleStatus } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { NavIcon } from '@/components/layout/nav-icon';
import { ModuleToggle } from '@/modules/settings/components/module-toggle';
import { HealthChecks } from '@/modules/configuration/components/health-checks';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Module' };
export const dynamic = 'force-dynamic';

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>
      <div className="accent-rule w-24 rounded-full" aria-hidden="true" />
    </div>
  );
}

export default async function ModulesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('modules.manage', { allowDuringSetup: true });
  const [status, health] = await Promise.all([listModuleStatus(), getModuleHealth()]);
  const csrfToken = csrfTokenFor(context);
  const healthById = new Map(health.map((entry) => [entry.moduleId, entry]));

  const features = status.filter((entry) => !entry.definition.core && entry.definition.status !== 'planned');
  const planned = status.filter((entry) => entry.definition.status === 'planned');
  const core = status.filter((entry) => entry.definition.core);

  return (
    <>
      <section className="space-y-4">
        <SectionTitle>Feature-Module</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((entry) => (
            <article
              key={entry.definition.id}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="icon-chip size-11 shrink-0 [&_svg]:size-5">
                    <NavIcon name={entry.definition.icon} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{entry.definition.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.definition.description}</p>
                  </div>
                </div>
                <ModuleToggle
                  csrfToken={csrfToken}
                  moduleId={entry.definition.id}
                  moduleName={entry.definition.name}
                  enabled={entry.enabled}
                />
              </div>

              <div className="flex flex-wrap gap-1">
                {entry.definition.permissions.map((permission) => (
                  <Badge key={permission.key} variant="outline">
                    {permission.key}
                  </Badge>
                ))}
              </div>

              {(() => {
                const report = healthById.get(entry.definition.id);
                if (!report || report.checks.length === 0 || report.status === 'ok') {
                  return null;
                }
                return <HealthChecks checks={report.checks.filter((check) => check.status !== 'ok')} />;
              })()}

              <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn('size-1.5 rounded-full', entry.enabled ? 'bg-success' : 'bg-destructive')}
                    aria-hidden="true"
                  />
                  {entry.enabled ? 'Aktiv' : 'Deaktiviert'}
                </span>
                {entry.updatedAt ? <span>Zuletzt geändert: {formatDateTime(entry.updatedAt)}</span> : null}
                {entry.definition.navigation[0] ? (
                  <Link
                    href={entry.definition.navigation[0].href}
                    className="text-primary-bright hover:underline"
                  >
                    Zum Modul
                  </Link>
                ) : null}
                {entry.definition.settingsFields?.length ? (
                  <Link
                    href={`/modules/${entry.definition.id}`}
                    className="text-primary-bright hover:underline"
                  >
                    Einstellungen
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {planned.length > 0 ? (
        <section className="space-y-4">
          <SectionTitle>Geplante Module</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Diese Module sind in der Navigation als Ausblick sichtbar, aber noch nicht implementiert. Die
            technische Grundlage steht bereit - siehe{' '}
            <code className="font-mono text-xs">docs/MODULES.md</code>.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {planned.map((entry) => (
              <article
                key={entry.definition.id}
                className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-card/50 p-4"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted text-muted-foreground [&_svg]:size-4">
                  <NavIcon name={entry.definition.icon} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{entry.definition.name}</h3>
                    <Badge variant="secondary">Geplant</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{entry.definition.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionTitle>Kernbereiche</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {core.map((entry) => (
            <article
              key={entry.definition.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground [&_svg]:size-4">
                <NavIcon name={entry.definition.icon} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{entry.definition.name}</h3>
                  <Badge variant="secondary">Kern</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.definition.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
