import { filterManageableRoles } from '@swisshub/permissions';
import type { GuildRole } from '@swisshub/discord';

/**
 * Reine Rollenberechnung für Jail und Release.
 *
 * Bewusst ohne Seiteneffekte, damit die Logik vollständig testbar ist -
 * hier entscheidet sich, welche Rollen ein Mitglied verliert und zurückerhält.
 */
export interface JailRolePlanInput {
  currentRoleIds: readonly string[];
  guildRoles: readonly GuildRole[];
  botHighestPosition: number;
  jailRoleId: string;
  /** Rollen, die während des Jails erhalten bleiben sollen. */
  keepRoleIds: ReadonlySet<string>;
}

export interface JailRolePlan {
  /** Vollständige Rollenliste, die auf Discord gesetzt wird. */
  nextRoleIds: string[];
  /** Snapshot der Rollen vor dem Jail (für die Wiederherstellung). */
  snapshotRoleIds: string[];
  /** Rollen, die entfernt werden. */
  removedRoleIds: string[];
  /** Rollen, die absichtlich erhalten bleiben. */
  keptRoleIds: string[];
  /**
   * Von Discord verwaltete Rollen (Booster, Integrationen). Sie lassen sich
   * grundsätzlich von niemandem entfernen und gelten deshalb nicht als Fehler.
   */
  managedRoleIds: string[];
  /**
   * Rollen, die der Bot wegen seiner Rollenposition nicht entfernen kann.
   * Das ist ein Konfigurationsproblem und wird als Warnung gemeldet.
   */
  untouchableRoleIds: string[];
}

export function planJailRoles(input: JailRolePlanInput): JailRolePlan {
  const current = [...new Set(input.currentRoleIds)].filter((roleId) => roleId !== input.jailRoleId);
  const { manageable, blocked } = filterManageableRoles(current, input.guildRoles, input.botHighestPosition);

  // Bewusst behaltene Rollen zählen als "kept" - auch wenn sie ohnehin nicht
  // entfernt werden könnten (z.B. von Discord verwaltete Booster-Rollen).
  const kept = current.filter((roleId) => input.keepRoleIds.has(roleId));
  const removed = manageable.filter((roleId) => !input.keepRoleIds.has(roleId));
  const remaining = blocked.filter((roleId) => !input.keepRoleIds.has(roleId));
  const isManaged = (roleId: string): boolean =>
    input.guildRoles.find((role) => role.id === roleId)?.managed === true;
  const managedRoleIds = remaining.filter(isManaged);
  const untouchable = remaining.filter((roleId) => !isManaged(roleId));
  const nextRoleIds = [...new Set([...blocked, ...kept, input.jailRoleId])];

  return {
    nextRoleIds,
    snapshotRoleIds: current,
    removedRoleIds: removed,
    keptRoleIds: kept,
    managedRoleIds,
    untouchableRoleIds: untouchable,
  };
}

export interface ReleaseRolePlanInput {
  /** Rollen, die das Mitglied aktuell auf Discord trägt. */
  currentRoleIds: readonly string[];
  /** Snapshot aus dem Jail-Datensatz. */
  snapshotRoleIds: readonly string[];
  guildRoles: readonly GuildRole[];
  botHighestPosition: number;
  jailRoleId: string;
}

export interface ReleaseRolePlan {
  nextRoleIds: string[];
  /** Rollen, die wiederhergestellt werden können. */
  restorableRoleIds: string[];
  /** Rollen, die nicht wiederhergestellt werden können (gelöscht, zu hoch, managed). */
  unrestorableRoleIds: string[];
}

/**
 * Stellt Rollen nur wieder her, wenn sie weiterhin existieren und vom Bot
 * verwaltet werden dürfen. Gelöschte oder zu hohe Rollen werden ausgelassen
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
