import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@swisshub/auth';
import {
  buildHealthContext,
  getModuleDefinition,
  groupFields,
  isModuleEnabled,
  readModuleSettings,
} from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import { SettingsForm } from '@/modules/configuration/components/settings-form';
import { HealthChecks } from '@/modules/configuration/components/health-checks';
import { csrfTokenFor, hasSetupAccess, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}): Promise<Metadata> {
  const { moduleId } = await params;
  const definition = getModuleDefinition(moduleId);
  return { title: definition ? `${definition.name} – Einstellungen` : 'Modul' };
}

/**
 * Einstellungsseite eines Moduls.
 *
 * Die Seite ist generisch: sie entsteht aus der Feldbeschreibung des Moduls.
 * Ein neues Modul benötigt deshalb keine eigene Seite mehr.
 */
export default async function ModuleSettingsPage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}): Promise<React.JSX.Element> {
  const { moduleId } = await params;
  const definition = getModuleDefinition(moduleId);
  if (!definition || definition.status === 'planned') {
    notFound();
  }

  const settingsPermission = definition.permissions.some(
    (entry) => entry.key === `${definition.permissionPrefix}.settings`,
  )
    ? `${definition.permissionPrefix}.settings`
    : 'modules.manage';

  const context = await requirePagePermission('settings.view', { allowDuringSetup: true });
  const csrfToken = csrfTokenFor(context);
  const canEdit = can(context, settingsPermission) || (await hasSetupAccess());

  const [enabled, options, values, healthContext] = await Promise.all([
    isModuleEnabled(moduleId),
    loadDiscordOptions(),
    readModuleSettings<Record<string, unknown>>(moduleId),
    buildHealthContext(),
  ]);

  const checks = definition.healthChecks ? await definition.healthChecks(healthContext).catch(() => []) : [];
  const fields = definition.settingsFields ?? [];

  return (
    <>
      <Link
        href="/modules"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Zurück zur Modulübersicht
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {definition.name}
            <Badge variant={enabled ? 'success' : 'outline'}>{enabled ? 'Aktiv' : 'Deaktiviert'}</Badge>
          </CardTitle>
          <CardDescription>{definition.description}</CardDescription>
        </CardHeader>
        {checks.length > 0 ? (
          <CardContent>
            <HealthChecks checks={checks} />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Einstellungen</CardTitle>
          <CardDescription>
            Rollen und Channels werden aus dem letzten Discord-Abgleich angeboten. Änderungen wirken sofort -
            der Bot muss dafür nicht neu gestartet werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <EmptyState
              title="Keine Einstellungen"
              description="Dieses Modul benötigt keine Konfiguration."
            />
          ) : (
            <SettingsForm
              moduleId={moduleId}
              csrfToken={csrfToken}
              groups={groupFields(fields)}
              values={values}
              roles={options.roles}
              channels={options.channels}
              disabled={!canEdit}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
