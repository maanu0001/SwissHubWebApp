import { filterManageableRoles } from '@swisshub/permissions';
import type { GuildRole } from '@swisshub/discord';

/**
 * Reine Rollenberechnung fuer Jail und Release.
 *
 * Bewusst ohne Seiteneffekte, damit die Logik vollstaendig testbar ist -
 * hier entscheidet sich, welche Rollen ein Mitglied verliert und zurueckerhaelt.
 */
export interface JailRolePlanInput {
  currentRoleIds: readonly string[];
  guildRoles: readonly GuildRole[];
  botHighestPosition: number;
  jailRoleId: string;
  /** Rollen, die waehrend des Jails erhalten bleiben sollen. */
  keepRoleIds: ReadonlySet<string>;
}

export interface JailRolePlan {
  /** Vollstaendige Rollenliste, die auf Discord gesetzt wird. */
  nextRoleIds: string[];
  /** Snapshot der Rollen vor dem Jail (fuer die Wiederherstellung). */
  snapshotRoleIds: string[];
  /** Rollen, die entfernt werden. */
  removedRoleIds: string[];
  /** Rollen, die absichtlich erhalten bleiben. */
  keptRoleIds: string[];
  /** Rollen, die der Bot nicht verwalten kann und die deshalb bleiben. */
  untouchableRoleIds: string[];
}

export function planJailRoles(input: JailRolePlanInput): JailRolePlan {
  const current = [...new Set(input.currentRoleIds)].filter((roleId) => roleId !== input.jailRoleId);
  const { manageable, blocked } = filterManageableRoles(current, input.guildRoles, input.botHighestPosition);

  // Bewusst behaltene Rollen zaehlen als "kept" - auch wenn sie ohnehin nicht
  // entfernt werden koennten (z.B. von Discord verwaltete Booster-Rollen).
  const kept = current.filter((roleId) => input.keepRoleIds.has(roleId));
  const removed = manageable.filter((roleId) => !input.keepRoleIds.has(roleId));
  const untouchable = blocked.filter((roleId) => !input.keepRoleIds.has(roleId));
  const nextRoleIds = [...new Set([...blocked, ...kept, input.jailRoleId])];

  return {
    nextRoleIds,
    snapshotRoleIds: current,
    removedRoleIds: removed,
    keptRoleIds: kept,
    untouchableRoleIds: untouchable,
  };
}

export interface ReleaseRolePlanInput {
  /** Rollen, die das Mitglied aktuell auf Discord traegt. */
  currentRoleIds: readonly string[];
  /** Snapshot aus dem Jail-Datensatz. */
  snapshotRoleIds: readonly string[];
  guildRoles: readonly GuildRole[];
  botHighestPosition: number;
  jailRoleId: string;
}

export interface ReleaseRolePlan {
  nextRoleIds: string[];
  /** Rollen, die wiederhergestellt werden koennen. */
  restorableRoleIds: string[];
  /** Rollen, die nicht wiederhergestellt werden koennen (geloescht, zu hoch, managed). */
  unrestorableRoleIds: string[];
}

/**
 * Stellt Rollen nur wieder her, wenn sie weiterhin existieren und vom Bot
 * verwaltet werden duerfen. Geloeschte oder zu hohe Rollen werden ausgelassen
 * statt den gesamten Release scheitern zu lassen.
 */
export function planReleaseRoles(input: ReleaseRolePlanInput): ReleaseRolePlan {
  const existingRoleIds = new Set(input.guildRoles.map((role) => role.id));
  const candidates = [...new Set(input.snapshotRoleIds)].filter(
    (roleId) => roleId !== input.jailRoleId && existingRoleIds.has(roleId),
  );
  const missing = [...new Set(input.snapshotRoleIds)].filter(
    (roleId) => roleId !== input.jailRoleId && !existingRoleIds.has(roleId),
  );

  const { manageable, blocked } = filterManageableRoles(
    candidates,
    input.guildRoles,
    input.botHighestPosition,
  );

  const next = new Set(input.currentRoleIds.filter((roleId) => roleId !== input.jailRoleId));
  for (const roleId of manageable) {
    next.add(roleId);
  }

  return {
    nextRoleIds: [...next],
    restorableRoleIds: manageable,
    unrestorableRoleIds: [...new Set([...missing, ...blocked])],
  };
}
