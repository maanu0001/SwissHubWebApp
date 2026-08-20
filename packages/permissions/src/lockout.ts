import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import { ADMIN_FULL } from './registry';

/**
 * Aussperrschutz.
 *
 * Ohne diese Prüfung liesse sich das Dashboard unbrauchbar machen: wer sich
 * selbst `permissions.manage` entzieht, könnte die Berechtigungen nie wieder
 * ändern. Vor jeder Änderung wird deshalb geprüft, ob danach noch jemand
 * verwalten darf.
 *
 * `SWISSHUB_OWNER_DISCORD_ID` gilt als Notzugang und zählt als gültiger
 * Verwalter - ist sie nicht gesetzt, muss mindestens eine Discord-Rolle die
 * Verwaltung behalten.
 */
export const MANAGE_PERMISSIONS = 'permissions.manage';

const grantsManagement = (permissions: readonly string[]): boolean =>
  permissions.includes(ADMIN_FULL) ||
  permissions.includes(MANAGE_PERMISSIONS) ||
  permissions.includes('permissions.*');

export interface LockoutCheck {
  /** Wäre nach der Änderung niemand mehr berechtigt? */
  wouldLockOut: boolean;
  /** Anzahl Rollen, die danach noch verwalten dürfen. */
  remainingManagerRoles: number;
  /** Notzugang über die Umgebungsvariable vorhanden? */
  ownerFallback: boolean;
  reason?: string;
}

/**
 * Prüft eine geplante Änderung an genau einer Rolle.
 * `nextPermissions === null` bedeutet: die Rolle wird gelöscht.
 */
export async function checkLockout(
  discordRoleId: string,
  nextPermissions: readonly string[] | null,
): Promise<LockoutCheck> {
  const ownerFallback = Boolean(bootstrapConfig.ownerDiscordId);

  const rows = await prisma.rolePermission.findMany({
    where: { permission: { in: [ADMIN_FULL, MANAGE_PERMISSIONS, 'permissions.*'] } },
    select: { discordRoleId: true },
  });

  const managers = new Set(rows.map((row) => row.discordRoleId));
  managers.delete(discordRoleId);
  if (nextPermissions !== null && grantsManagement(nextPermissions)) {
    managers.add(discordRoleId);
  }

  const wouldLockOut = managers.size === 0 && !ownerFallback;
  return {
    wouldLockOut,
    remainingManagerRoles: managers.size,
    ownerFallback,
    reason: wouldLockOut
      ? 'Danach könnte niemand mehr Berechtigungen verwalten. Bitte zuerst einer anderen Rolle "Berechtigungen verwalten" oder "Vollzugriff" geben.'
      : undefined,
  };
}

/** Anzahl konfigurierter Rollen-Berechtigungen (für die Einrichtungsprüfung). */
export async function countRolePermissionMappings(): Promise<number> {
  return prisma.rolePermission.count();
}

/**
 * Notzugang: trägt die Owner-ID als Vollzugriff-Rolle nach.
 *
 * Wird ausschliesslich vom Wiederherstellungsbereich verwendet, wenn tatsächlich
 * niemand mehr verwalten kann.
 */
export async function isRecoveryNeeded(): Promise<boolean> {
  const managers = await prisma.rolePermission.count({
    where: { permission: { in: [ADMIN_FULL, MANAGE_PERMISSIONS, 'permissions.*'] } },
  });
  return managers === 0;
}
