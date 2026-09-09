import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import { ADMIN_FULL } from './registry';
import { hasPermission } from './engine';

/**
 * Aussperrschutz.
 *
 * Ohne diese Prüfung liesse sich das Dashboard unbrauchbar machen: wer sich
 * selbst `permissions.manage` entzieht, könnte die Berechtigungen nie wieder
 * ändern. Vor jeder Änderung wird deshalb geprüft, ob danach noch jemand
 * verwalten darf.
 *
 * Seit es ausdrueckliche Ausnahmen gibt, reicht es nicht mehr, nach
 * vorhandenen Zeilen zu suchen: eine Rolle mit Vollzugriff, der
 * `permissions.manage` ausdruecklich verweigert wurde, verwaltet nichts mehr.
 * Deshalb entscheidet hier dieselbe Engine wie im laufenden Betrieb und nicht
 * eine zweite, einfachere Regel - eine, die «erlaubt» sagt, wo die echte
 * «verweigert» sagt, sperrt genau die Leute aus, die sie schuetzen soll.
 *
 * `SWISSHUB_OWNER_DISCORD_ID` gilt als Notzugang und zählt als gültiger
 * Verwalter - ist sie nicht gesetzt, muss mindestens eine Discord-Rolle die
 * Verwaltung behalten.
 */
export const MANAGE_PERMISSIONS = 'permissions.manage';

/** Alles, was Einfluss auf `permissions.manage` haben kann. */
const RELEVANTE_SCHLUESSEL = [ADMIN_FULL, MANAGE_PERMISSIONS, 'permissions.*'];

/**
 * Darf eine Rolle mit diesen Zuordnungen Berechtigungen verwalten?
 *
 * Bewusst über `hasPermission`, damit Wildcards, Vollzugriff und Ausnahmen
 * hier exakt so wirken wie bei jeder anderen Prüfung im System.
 */
const grantsManagement = (permissions: readonly string[], denied: readonly string[] = []): boolean =>
  hasPermission(
    {
      discordId: '',
      isOwner: false,
      granted: new Set(permissions),
      denied: new Set(denied),
      matchedRoleIds: [],
    },
    MANAGE_PERMISSIONS,
  );

export interface LockoutCheck {
  /** Wäre nach der Änderung niemand mehr berechtigt? */
  wouldLockOut: boolean;
  /** Anzahl Rollen, die danach noch verwalten dürfen. */
  remainingManagerRoles: number;
  /** Notzugang über die Umgebungsvariable vorhanden? */
  ownerFallback: boolean;
  reason?: string;
}

/** Rollen, die aktuell tatsächlich verwalten dürfen. */
async function currentManagerRoleIds(): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: { permission: { in: RELEVANTE_SCHLUESSEL } },
    select: { discordRoleId: true, permission: true, effect: true },
  });

  const proRolle = new Map<string, { granted: string[]; denied: string[] }>();
  for (const row of rows) {
    const eintrag = proRolle.get(row.discordRoleId) ?? { granted: [], denied: [] };
    if (row.effect === 'DENY') {
      eintrag.denied.push(row.permission);
    } else {
      eintrag.granted.push(row.permission);
    }
    proRolle.set(row.discordRoleId, eintrag);
  }

  const managers = new Set<string>();
  for (const [discordRoleId, eintrag] of proRolle) {
    if (grantsManagement(eintrag.granted, eintrag.denied)) {
      managers.add(discordRoleId);
    }
  }
  return managers;
}

/**
 * Prüft eine geplante Änderung an genau einer Rolle.
 * `nextPermissions === null` bedeutet: die Rolle wird gelöscht.
 */
export async function checkLockout(
  discordRoleId: string,
  nextPermissions: readonly string[] | null,
  nextDenied: readonly string[] = [],
): Promise<LockoutCheck> {
  const ownerFallback = Boolean(bootstrapConfig.ownerDiscordId);

  const managers = await currentManagerRoleIds();
  managers.delete(discordRoleId);
  if (nextPermissions !== null && grantsManagement(nextPermissions, nextDenied)) {
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
  return (await currentManagerRoleIds()).size === 0;
}
