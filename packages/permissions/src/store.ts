import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import { ADMIN_FULL } from './registry';
import type { RolePermissionMapping } from './engine';

/**
 * Lädt die Rollen-/Permission-Konfiguration aus der Datenbank.
 *
 * Ein kurzer In-Memory-Cache hält die Last klein; Änderungen über die
 * Einstellungen invalidieren ihn sofort. Die TTL begrenzt zusätzlich, wie lange
 * eine zweite Instanz veraltete Daten sehen kann.
 */
export interface RoleConfiguration {
  mappings: RolePermissionMapping[];
  protectedRoleIds: string[];
  keepOnJailRoleIds: string[];
  moderationLevels: Map<string, number>;
  roleLabels: Map<string, string>;
}

const CACHE_TTL_MS = 15_000;

let cache: { value: RoleConfiguration; expiresAt: number } | null = null;

export function invalidateRoleConfiguration(): void {
  cache = null;
}

export async function loadRoleConfiguration(force = false): Promise<RoleConfiguration> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const [permissions, managedRoles] = await Promise.all([
    prisma.rolePermission.findMany({ select: { discordRoleId: true, permission: true } }),
    prisma.managedRole.findMany({
      select: {
        discordRoleId: true,
        label: true,
        isProtected: true,
        keepOnJail: true,
        moderationLevel: true,
      },
    }),
  ]);

  const value: RoleConfiguration = {
    mappings: permissions,
    protectedRoleIds: managedRoles.filter((role) => role.isProtected).map((role) => role.discordRoleId),
    keepOnJailRoleIds: managedRoles.filter((role) => role.keepOnJail).map((role) => role.discordRoleId),
    moderationLevels: new Map(managedRoles.map((role) => [role.discordRoleId, role.moderationLevel])),
    roleLabels: new Map(managedRoles.map((role) => [role.discordRoleId, role.label])),
  };

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * Die «Bezeichnung im Dashboard» einer Person.
 *
 * Im Berechtigungseditor traegt jede verwaltete Rolle neben ihrem
 * Discord-Namen eine eigene Bezeichnung - eine Rolle kann auf Discord
 * «Moderator» heissen und im Dashboard «Teamleitung». Genau diese Bezeichnung
 * gehoert oben rechts ins Profil, und zwar aus derselben Konfiguration, die
 * sie verwaltet: eine zweite Kopie am Benutzer liefe irgendwann auseinander.
 *
 * Traegt jemand mehrere verwaltete Rollen, gewinnt die mit der hoechsten
 * Moderationsstufe - das ist die Rangfolge, die diese Anwendung ohnehin
 * kennt. Bei Gleichstand entscheidet die Reihenfolge nicht der Zufall,
 * sondern der Name, damit dieselbe Person nicht bei jedem Seitenaufruf eine
 * andere Bezeichnung traegt.
 *
 * Gibt es keine verwaltete Rolle - oder ist keine benannt - bleibt es beim
 * bisherigen Text. Eine leere Anzeige waere schlechter als eine ungenaue.
 */
export async function dashboardRoleLabel(roleIds: readonly string[]): Promise<string | null> {
  if (roleIds.length === 0) {
    return null;
  }
  const configuration = await loadRoleConfiguration();

  const benannt = roleIds
    .flatMap((roleId) => {
      const label = configuration.roleLabels.get(roleId)?.trim();
      return label
        ? [{ label, stufe: configuration.moderationLevels.get(roleId) ?? 0 }]
        : [];
    })
    .sort((a, b) => b.stufe - a.stufe || a.label.localeCompare(b.label));

  return benannt[0]?.label ?? null;
}

/**
 * Legt beim ersten Start die Administratorrolle an, damit sich überhaupt
 * jemand anmelden und die restliche Konfiguration vornehmen kann.
 */
export async function ensureBootstrapRoles(): Promise<void> {
  const adminRoleId = bootstrapConfig.adminRoleId;
  if (!adminRoleId) {
    return;
  }

  await prisma.managedRole.upsert({
    where: { discordRoleId: adminRoleId },
    create: {
      discordRoleId: adminRoleId,
      label: 'Administrator',
      isProtected: true,
      moderationLevel: 100,
      notes: 'Automatisch aus DISCORD_ADMIN_ROLE_ID angelegt.',
    },
    update: {},
  });

  await prisma.rolePermission.upsert({
    where: { discordRoleId_permission: { discordRoleId: adminRoleId, permission: ADMIN_FULL } },
    create: { discordRoleId: adminRoleId, permission: ADMIN_FULL, createdBy: 'bootstrap' },
    update: {},
  });

  invalidateRoleConfiguration();
}
