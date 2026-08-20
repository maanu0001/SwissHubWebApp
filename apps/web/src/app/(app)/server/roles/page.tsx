import type { Metadata } from 'next';
import { AlertTriangle, Bot, Lock } from 'lucide-react';
import { getModuleSettings, getRoleHierarchy, jail } from '@swisshub/modules';
import { prisma } from '@swisshub/database';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Rollen' };
export const dynamic = 'force-dynamic';

/**
 * Rollenhierarchie.
 *
 * Zeigt die Rollen in derselben Reihenfolge wie Discord und markiert, welche
 * der Bot vergeben kann. Rollen, die die Anwendung verwendet, sind
 * gekennzeichnet - dadurch wird sofort sichtbar, wenn die Bot-Rolle zu tief
 * einsortiert ist.
 */
export default async function ServerRolesPage(): Promise<React.JSX.Element> {
  await requirePagePermission('settings.view', { allowDuringSetup: true });

  const [jailSettings, managedRoles] = await Promise.all([
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    prisma.managedRole.findMany({ include: { permissions: { select: { permission: true } } } }),
  ]);

  // Wofür wird eine Rolle in der Anwendung verwendet?
  const usage = new Map<string, string[]>();
  const addUsage = (roleId: string | undefined, label: string): void => {
    if (!roleId) {
      return;
    }
    usage.set(roleId, [...(usage.get(roleId) ?? []), label]);
  };

  // Nur diese Rollen muss der Bot tatsächlich vergeben können - Rollen mit
  // Dashboard-Berechtigungen dürfen ruhig über der Bot-Rolle liegen.
  const mustBeManageable = new Set<string>();

  addUsage(jailSettings.jailRoleId, 'Jail-Rolle');
  if (jailSettings.jailRoleId) {
    mustBeManageable.add(jailSettings.jailRoleId);
  }
  for (const roleId of jailSettings.keepRoleIds) {
    addUsage(roleId, 'bleibt beim Jail erhalten');
  }
  for (const role of managedRoles) {
    if (role.permissions.length > 0) {
      addUsage(role.discordRoleId, `${role.permissions.length} Dashboard-Berechtigung(en)`);
    }
    if (role.isProtected) {
      addUsage(role.discordRoleId, 'geschützt');
    }
  }

  const hierarchy = await getRoleHierarchy(usage, mustBeManageable);

  return (
    <>
      {hierarchy.problems.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              Rollen, die der Bot nicht verwalten kann
            </CardTitle>
            <CardDescription>
              Diese Rollen werden von der Anwendung verwendet, lassen sich aber nicht vergeben oder entziehen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {hierarchy.problems.map((problem) => (
                <li
                  key={problem.roleId}
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <p className="font-medium">{problem.roleName}</p>
                  <p className="text-xs text-muted-foreground">{problem.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Verwendet als: {problem.usage.join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Rollenhierarchie</CardTitle>
          <CardDescription>
            Reihenfolge wie auf Discord. Der Bot kann nur Rollen unterhalb seiner eigenen Rolle vergeben
            {hierarchy.botPosition > 0 ? ` (Position ${hierarchy.botPosition})` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hierarchy.entries.length === 0 ? (
            <EmptyState
              title="Keine Rollen synchronisiert"
              description="Bitte unter System → Discord-Sync einen Abgleich starten."
            />
          ) : (
            <ol className="space-y-1">
              {hierarchy.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span
                    className="size-3 shrink-0 rounded-full border border-border"
                    style={{
                      backgroundColor:
                        entry.color === 0 ? 'transparent' : `#${entry.color.toString(16).padStart(6, '0')}`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="font-medium">{entry.name}</span>
                  {entry.isBotRole ? (
                    <Badge variant="default">
                      <Bot className="size-3" aria-hidden="true" />
                      Bot-Rolle
                    </Badge>
                  ) : null}
                  {entry.managed ? <Badge variant="outline">von Discord verwaltet</Badge> : null}
                  {!entry.manageableByBot && !entry.isBotRole ? (
                    <Badge variant="warning">
                      <Lock className="size-3" aria-hidden="true" />
                      nicht vergebbar
                    </Badge>
                  ) : null}
                  {entry.usage.map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">#{entry.position}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
