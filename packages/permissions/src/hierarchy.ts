import type { GuildRole } from '@swisshub/discord';

/** Höchste Rollenposition eines Mitglieds (0 = @everyone). */
export function highestRolePosition(roleIds: readonly string[], roles: readonly GuildRole[]): number {
  let highest = 0;
  for (const roleId of roleIds) {
    const role = roles.find((entry) => entry.id === roleId);
    if (role && role.position > highest) {
      highest = role.position;
    }
  }
  return highest;
}

/**
 * Rollen, die der Bot verwalten darf: strikt unterhalb seiner höchsten Rolle
 * und nicht von Discord verwaltet (Integrations-/Booster-Rollen).
 */
export function isRoleManageableByBot(role: GuildRole | undefined, botHighestPosition: number): boolean {
  if (!role) {
    return false;
  }
  if (role.managed) {
    return false;
  }
  return role.position < botHighestPosition;
}

/** Filtert eine Rollenliste auf die vom Bot verwaltbaren Rollen. */
export function filterManageableRoles(
  roleIds: readonly string[],
  roles: readonly GuildRole[],
  botHighestPosition: number,
): { manageable: string[]; blocked: string[] } {
  const manageable: string[] = [];
  const blocked: string[] = [];
  for (const roleId of roleIds) {
    const role = roles.find((entry) => entry.id === roleId);
    if (isRoleManageableByBot(role, botHighestPosition)) {
      manageable.push(roleId);
    } else {
      blocked.push(roleId);
    }
  }
  return { manageable, blocked };
}
