import type { Metadata } from 'next';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { can } from '@swisshub/auth';
import { bootstrapConfig } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { PERMISSION_PRESETS, isRecoveryNeeded, listPermissions } from '@swisshub/permissions';
import { listModuleDefinitions } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PermissionMatrix } from '@/modules/configuration/components/permission-matrix';
import { csrfTokenFor, hasSetupAccess, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Berechtigungen' };
export const dynamic = 'force-dynamic';

/**
 * Berechtigungsverwaltung.
 *
 * Ordnet Discord-Rollen die Berechtigungen des Dashboards zu. Die Anwendung
 * fragt nie nach Rollen-IDs, sondern immer nach Berechtigungen - hier wird die
 * Zuordnung gepflegt.
 */
export default async function ServerPermissionsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('permissions.manage', { allowDuringSetup: true });
  const csrfToken = csrfTokenFor(context);

  const [options, managedRoles, recoveryNeeded, setupAccess] = await Promise.all([
    loadDiscordOptions(),
    prisma.managedRole.findMany({
      orderBy: { moderationLevel: 'desc' },
      include: { permissions: { select: { permission: true } } },
    }),
    isRecoveryNeeded(),
    hasSetupAccess(),
  ]);

  const moduleLabels: Record<string, string> = { core: 'Grundfunktionen' };
  for (const definition of listModuleDefinitions()) {
    moduleLabels[definition.id] = definition.name;
  }

  return (
    <>
      {recoveryNeeded ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              Keine Rolle darf aktuell verwalten
            </CardTitle>
            <CardDescription>
              Solange keiner Rolle „Berechtigungen verwalten“ oder „Vollzugriff“ zugewiesen ist, kommt nach
              einer Abmeldung niemand mehr in diesen Bereich.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {bootstrapConfig.ownerDiscordId
                ? 'Der Notzugang über SWISSHUB_OWNER_DISCORD_ID ist gesetzt - dieses Konto behält in jedem Fall Vollzugriff.'
                : 'Es ist kein Notzugang gesetzt. Bitte jetzt einer Rolle Vollzugriff geben.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Alternativ auf dem Server: <code>npm run grant:admin -- &lt;ROLLEN_ID&gt;</code>
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Rollen und Berechtigungen
          </CardTitle>
          <CardDescription>
            Discord-Rollen bestimmen, wer im Dashboard was darf. Die letzte verwaltende Rolle lässt sich nicht
            entwerten - dadurch kann sich niemand versehentlich aussperren.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionMatrix
            csrfToken={csrfToken}
            canEdit={can(context, 'permissions.manage') || setupAccess}
            roles={options.roles}
            managed={managedRoles.map((role) => ({
              discordRoleId: role.discordRoleId,
              label: role.label,
              permissions: role.permissions.map((entry) => entry.permission),
              isProtected: role.isProtected,
              keepOnJail: role.keepOnJail,
              moderationLevel: role.moderationLevel,
            }))}
            permissions={listPermissions().map((permission) => ({
              key: permission.key,
              label: permission.label,
              description: permission.description,
              module: permission.module,
              critical: permission.critical,
            }))}
            presets={PERMISSION_PRESETS.map((preset) => ({
              id: preset.id,
              label: preset.label,
              description: preset.description,
              critical: preset.critical,
            }))}
            moduleLabels={moduleLabels}
          />
        </CardContent>
      </Card>
    </>
  );
}
