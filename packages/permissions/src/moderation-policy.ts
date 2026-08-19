import type { GuildMember, GuildRole } from '@swisshub/discord';
import { highestRolePosition } from './hierarchy';

/**
 * Zentrale Moderation Policy.
 *
 * Sie beantwortet genau eine Frage: Darf `actor` die Moderationsaktion gegen
 * `target` ausführen? Die Prüfung ist rein funktional und damit vollständig
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
  /** Rollen, deren Träger nicht moderiert werden dürfen. */
  protectedRoleIds: readonly string[];
  /** Moderationsstufen pro Discord-Rolle. */
  moderationLevels: ReadonlyMap<string, number>;
  /** Höchste Rollenposition des Bots. */
  botHighestPosition: number;
  botUserId?: string | null;
  /** Discord Guild Owner - steht über der gesamten Rollenhierarchie. */
  guildOwnerId?: string | null;
}

export interface PolicyDecision {
  allowed: boolean;
  code?: PolicyDenyCode;
  /** Für Benutzer verständliche Begründung. */
  message?: string;
}

const DENY_MESSAGES: Record<PolicyDenyCode, string> = {
  SELF_TARGET: 'Du kannst diese Aktion nicht gegen dich selbst ausführen.',
  TARGET_IS_BOT: 'Bots können nicht moderiert werden.',
  TARGET_IS_OWNER: 'Der Server-Owner kann nicht moderiert werden.',
  TARGET_PROTECTED_ROLE: 'Dieses Mitglied trägt eine geschützte Rolle und kann nicht moderiert werden.',
  TARGET_HIGHER_OR_EQUAL_ROLE: 'Dieses Mitglied hat eine gleich hohe oder höhere Discord-Rolle als du.',
  TARGET_HIGHER_MODERATION_LEVEL: 'Dieses Mitglied besitzt eine gleich hohe oder höhere Moderationsstufe.',
  BOT_ROLE_TOO_LOW:
    'Die Rolle des Bots liegt nicht hoch genug, um dieses Mitglied zu verwalten. Bitte Rollenreihenfolge auf Discord prüfen.',
  TARGET_NOT_A_MEMBER: 'Das Mitglied befindet sich nicht (mehr) auf dem SwissHub Discord-Server.',
};

const deny = (code: PolicyDenyCode): PolicyDecision => ({
  allowed: false,
  code,
  message: DENY_MESSAGES[code],
});

/** Höchste Moderationsstufe der übergebenen Rollen. */
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

  // Der Bot muss über dem Ziel stehen, sonst schlägt die Discord-Aktion ohnehin fehl.
  if (targetPosition >= botHighestPosition) {
    return deny('BOT_ROLE_TOO_LOW');
  }

  // Der konfigurierte Owner darf oberhalb der Rollenhierarchie handeln, aber die
  // Schutzregeln oben (Bot, geschützte Rollen, Guild Owner) gelten weiterhin.
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
