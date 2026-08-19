import type { GuildMember, GuildRole } from '@swisshub/discord';
import { highestRolePosition } from './hierarchy';

/**
 * Zentrale Moderation Policy.
 *
 * Sie beantwortet genau eine Frage: Darf `actor` die Moderationsaktion gegen
 * `target` ausfuehren? Die Pruefung ist rein funktional und damit vollstaendig
 * testbar - jedes Modul verwendet dieselbe Policy.
 */
export type PolicyDenyCode =
  | 'SELF_TARGET'
  | 'TARGET_IS_BOT'
  | 'TARGET_IS_OWNER'
  | 'TARGET_PROTECTED_ROLE'
  | 'TARGET_HIGHER_OR_EQUAL_ROLE'
  | 'TARGET_HIGHER_MODERATION_LEVEL'
  | 'BOT_ROLE_TOO_LOW'
  | 'TARGET_NOT_A_MEMBER';

export interface PolicyActor {
  discordId: string;
  roleIds: string[];
  isOwner: boolean;
  /** Interne Moderationsstufe (Maximum der zugeordneten Rollen). */
  moderationLevel: number;
}

export interface PolicyEvaluationInput {
  actor: PolicyActor;
  target: GuildMember | null;
  guildRoles: readonly GuildRole[];
  /** Rollen, deren Traeger nicht moderiert werden duerfen. */
  protectedRoleIds: readonly string[];
  /** Moderationsstufen pro Discord-Rolle. */
  moderationLevels: ReadonlyMap<string, number>;
  /** Hoechste Rollenposition des Bots. */
  botHighestPosition: number;
  botUserId?: string | null;
  /** Discord Guild Owner - steht ueber der gesamten Rollenhierarchie. */
  guildOwnerId?: string | null;
}

export interface PolicyDecision {
  allowed: boolean;
  code?: PolicyDenyCode;
  /** Fuer Benutzer verstaendliche Begruendung. */
  message?: string;
}

const DENY_MESSAGES: Record<PolicyDenyCode, string> = {
  SELF_TARGET: 'Du kannst diese Aktion nicht gegen dich selbst ausfuehren.',
  TARGET_IS_BOT: 'Bots koennen nicht moderiert werden.',
  TARGET_IS_OWNER: 'Der Server-Owner kann nicht moderiert werden.',
  TARGET_PROTECTED_ROLE: 'Dieses Mitglied traegt eine geschuetzte Rolle und kann nicht moderiert werden.',
  TARGET_HIGHER_OR_EQUAL_ROLE: 'Dieses Mitglied hat eine gleich hohe oder hoehere Discord-Rolle als du.',
  TARGET_HIGHER_MODERATION_LEVEL: 'Dieses Mitglied besitzt eine gleich hohe oder hoehere Moderationsstufe.',
  BOT_ROLE_TOO_LOW:
    'Die Rolle des Bots liegt nicht hoch genug, um dieses Mitglied zu verwalten. Bitte Rollenreihenfolge auf Discord pruefen.',
  TARGET_NOT_A_MEMBER: 'Das Mitglied befindet sich nicht (mehr) auf dem SwissHub Discord-Server.',
};

const deny = (code: PolicyDenyCode): PolicyDecision => ({
  allowed: false,
  code,
  message: DENY_MESSAGES[code],
});

/** Hoechste Moderationsstufe der uebergebenen Rollen. */
export function moderationLevelOf(roleIds: readonly string[], levels: ReadonlyMap<string, number>): number {
  return roleIds.reduce((highest, roleId) => Math.max(highest, levels.get(roleId) ?? 0), 0);
}

export function evaluateModerationPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { actor, target, guildRoles, protectedRoleIds, moderationLevels, botHighestPosition } = input;

  if (!target) {
    return deny('TARGET_NOT_A_MEMBER');
  }
  if (target.discordId === actor.discordId) {
    return deny('SELF_TARGET');
  }
  if (target.isBot || (input.botUserId && target.discordId === input.botUserId)) {
    return deny('TARGET_IS_BOT');
  }
  if (input.guildOwnerId && target.discordId === input.guildOwnerId) {
    return deny('TARGET_IS_OWNER');
  }

  const protectedSet = new Set(protectedRoleIds);
  if (target.roleIds.some((roleId) => protectedSet.has(roleId))) {
    return deny('TARGET_PROTECTED_ROLE');
  }

  const targetPosition = highestRolePosition(target.roleIds, guildRoles);

  // Der Bot muss ueber dem Ziel stehen, sonst schlaegt die Discord-Aktion ohnehin fehl.
  if (targetPosition >= botHighestPosition) {
    return deny('BOT_ROLE_TOO_LOW');
  }

  // Der konfigurierte Owner darf oberhalb der Rollenhierarchie handeln, aber die
  // Schutzregeln oben (Bot, geschuetzte Rollen, Guild Owner) gelten weiterhin.
  if (actor.isOwner) {
    return { allowed: true };
  }

  const actorPosition = highestRolePosition(actor.roleIds, guildRoles);
  const isActorGuildOwner = input.guildOwnerId !== undefined && input.guildOwnerId === actor.discordId;
  if (!isActorGuildOwner && targetPosition >= actorPosition) {
    return deny('TARGET_HIGHER_OR_EQUAL_ROLE');
  }

  const targetLevel = moderationLevelOf(target.roleIds, moderationLevels);
  if (targetLevel > 0 && targetLevel >= actor.moderationLevel) {
    return deny('TARGET_HIGHER_MODERATION_LEVEL');
  }

  return { allowed: true };
}
