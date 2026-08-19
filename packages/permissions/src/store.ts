import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import { ADMIN_FULL } from './registry';
import type { RolePermissionMapping } from './engine';

/**
 * Laedt die Rollen-/Permission-Konfiguration aus der Datenbank.
 *
 * Ein kurzer In-Memory-Cache haelt die Last klein; Aenderungen ueber die
 * Einstellungen invalidieren ihn sofort. Die TTL begrenzt zusaetzlich, wie lange
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
 * Legt beim ersten Start die Administratorrolle an, damit sich ueberhaupt
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
