import { ADMIN_FULL } from './registry';

/**
 * Permission Engine.
 *
 * Business-Logik fragt niemals direkt nach Discord-Role-IDs, sondern immer nach
 * Permissions. Die Zuordnung Rolle -> Permission ist zentral konfigurierbar.
 */
export interface RolePermissionMapping {
  discordRoleId: string;
  permission: string;
}

export interface PermissionSubject {
  discordId: string;
  /** Aktuelle Discord-Rollen (frisch geladen, nicht aus einer alten Session). */
  roleIds: string[];
  /** Fest konfigurierte Owner-ID aus der Umgebung. */
  isOwner: boolean;
}

export interface PermissionResolution {
  discordId: string;
  isOwner: boolean;
  /** Direkt zugewiesene Permissions (inkl. Wildcards wie `jail.*`). */
  granted: ReadonlySet<string>;
  /** Rollen, die mindestens eine Permission beigesteuert haben. */
  matchedRoleIds: string[];
}

/** Löst die effektiven Permissions eines Benutzers auf. */
export function resolvePermissions(
  subject: PermissionSubject,
  mappings: readonly RolePermissionMapping[],
): PermissionResolution {
  const roleIds = new Set(subject.roleIds);
  const granted = new Set<string>();
  const matchedRoleIds = new Set<string>();

  for (const mapping of mappings) {
    if (roleIds.has(mapping.discordRoleId)) {
      granted.add(mapping.permission);
      matchedRoleIds.add(mapping.discordRoleId);
    }
  }

  return {
    discordId: subject.discordId,
    isOwner: subject.isOwner,
    granted,
    matchedRoleIds: [...matchedRoleIds],
  };
}

/**
 * Prüft eine einzelne Permission.
 *
 * Unterstützt `admin.full` (Vollzugriff) sowie Wildcards pro Präfix
 * (`jail.*` deckt `jail.create`, `jail.release`, ... ab).
 */
export function hasPermission(resolution: PermissionResolution, permission: string): boolean {
  if (resolution.isOwner) {
    return true;
  }
  if (resolution.granted.has(ADMIN_FULL)) {
    return true;
  }
  if (resolution.granted.has(permission)) {
    return true;
  }
  const prefix = permission.split('.')[0];
  return prefix !== undefined && resolution.granted.has(`${prefix}.*`);
}

export function hasAnyPermission(resolution: PermissionResolution, permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(resolution, permission));
}

export function hasAllPermissions(resolution: PermissionResolution, permissions: string[]): boolean {
  return permissions.every((permission) => hasPermission(resolution, permission));
}

/**
 * Erweitert die aufgelösten Permissions zu einer konkreten Liste.
 * Wird ans Frontend gegeben, damit `PermissionGuard` Elemente ausblenden kann.
 * Sicherheitsrelevant ist ausschliesslich die serverseitige Prüfung.
 */
export function expandPermissions(resolution: PermissionResolution, knownPermissions: string[]): string[] {
  return knownPermissions.filter((permission) => hasPermission(resolution, permission));
}
