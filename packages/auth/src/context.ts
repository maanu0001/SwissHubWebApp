import { bootstrapConfig, identityConfig } from '@swisshub/config';
import {
  AUDIT_ACTIONS,
  SECURITY_EVENTS,
  prisma,
  recordSecurityEvent,
  safeRecordAudit,
} from '@swisshub/database';
import {
  ADMIN_FULL,
  hasPermission,
  listPermissions,
  loadRoleConfiguration,
  moderationLevelOf,
  resolvePermissions,
  type PermissionResolution,
} from '@swisshub/permissions';
import { AppError } from '@swisshub/shared';
import type { AppRole, User } from '@swisshub/database';
import { getIdentity, type DiscordIdentity } from './identity';

/**
 * Aufgeloester Sicherheitskontext eines Requests.
 *
 * Er buendelt Identitaet, aktuelle Discord-Rollen und effektive Permissions.
 * Jede serverseitige Aktion arbeitet ausschliesslich mit diesem Kontext.
 */
export interface AuthUser {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  displayName: string;
  avatarHash: string | null;
  appRole: AppRole;
  isOwner: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  identity: DiscordIdentity;
  isMember: boolean;
  permissions: PermissionResolution;
  /** Ausgerollte Permission-Liste fuer das UI (nur UX, keine Sicherheit). */
  permissionKeys: string[];
  /** Hoechste Moderationsstufe der aktuellen Rollen. */
  moderationLevel: number;
  roleIds: string[];
}

export type Freshness = 'cached' | 'critical';

export interface BuildContextInput {
  user: User;
  sessionId: string;
  freshness?: Freshness;
}

export async function buildAuthContext({
  user,
  sessionId,
  freshness = 'cached',
}: BuildContextInput): Promise<AuthContext> {
  const identity = await getIdentity(user.discordId, {
    maxAgeMs: freshness === 'critical' ? identityConfig.criticalTtlMs : identityConfig.cacheTtlMs,
  });

  const isOwner = bootstrapConfig.ownerDiscordId === user.discordId;
  const configuration = await loadRoleConfiguration();
  const permissions = resolvePermissions(
    { discordId: user.discordId, roleIds: identity.roleIds, isOwner },
    configuration.mappings,
  );

  const permissionKeys = listPermissions()
    .map((definition) => definition.key)
    .filter((key) => hasPermission(permissions, key));

  const appRole = deriveAppRole({ isOwner, permissions });
  if (appRole !== user.appRole) {
    await prisma.user.update({ where: { id: user.id }, data: { appRole } }).catch(() => undefined);
  }

  return {
    user: {
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      globalName: user.globalName,
      displayName: identity.displayName ?? user.globalName ?? user.username,
      avatarHash: user.avatarHash,
      appRole,
      isOwner,
    },
    sessionId,
    identity,
    isMember: identity.isMember,
    permissions,
    permissionKeys,
    moderationLevel: moderationLevelOf(identity.roleIds, configuration.moderationLevels),
    roleIds: identity.roleIds,
  };
}

/**
 * Grobe Anwendungsgruppe - reine Anzeigeinformation. Massgeblich fuer
 * Entscheidungen sind ausschliesslich die Permissions.
 */
export function deriveAppRole(input: { isOwner: boolean; permissions: PermissionResolution }): AppRole {
  if (input.isOwner) {
    return 'OWNER';
  }
  if (input.permissions.granted.has(ADMIN_FULL) || hasPermission(input.permissions, 'settings.edit')) {
    return 'ADMIN';
  }
  if (hasPermission(input.permissions, 'moderation.execute')) {
    return 'MODERATOR';
  }
  if (input.permissions.granted.size > 0) {
    return 'TEAM';
  }
  return 'USER';
}

export interface GuardMetadata {
  ipHash?: string | null;
  userAgent?: string | null;
  path?: string | null;
  module?: string | null;
}

/** Stellt sicher, dass der Benutzer aktuell Mitglied der SwissHub Guild ist. */
export function assertMembership(context: AuthContext, metadata: GuardMetadata = {}): void {
  if (context.isMember) {
    return;
  }
  void recordSecurityEvent({
    type: SECURITY_EVENTS.NOT_A_MEMBER,
    severity: 'MEDIUM',
    discordId: context.user.discordId,
    ipHash: metadata.ipHash,
    userAgent: metadata.userAgent,
    path: metadata.path,
  });
  throw new AppError('NOT_A_MEMBER');
}

/**
 * Zentrale Berechtigungspruefung.
 *
 * Fail closed: fehlt die Permission, wird die Aktion abgebrochen, ein
 * Sicherheitsereignis erfasst und der Versuch im Audit Log vermerkt.
 */
export async function assertPermission(
  context: AuthContext,
  permission: string,
  metadata: GuardMetadata = {},
): Promise<void> {
  assertMembership(context, metadata);
  if (hasPermission(context.permissions, permission)) {
    return;
  }

  await Promise.all([
    recordSecurityEvent({
      type: SECURITY_EVENTS.PERMISSION_DENIED,
      severity: 'MEDIUM',
      discordId: context.user.discordId,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: metadata.path,
      metadata: { permission },
    }),
    safeRecordAudit({
      action: AUDIT_ACTIONS.PERMISSION_DENIED,
      module: metadata.module ?? null,
      actorDiscordId: context.user.discordId,
      actorUsername: context.user.username,
      success: false,
      errorCode: 'FORBIDDEN',
      metadata: { permission, path: metadata.path ?? null },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    }),
  ]);

  throw new AppError('FORBIDDEN', {
    internalMessage: `Permission ${permission} fehlt fuer ${context.user.discordId}`,
  });
}

export function can(context: AuthContext, permission: string): boolean {
  return context.isMember && hasPermission(context.permissions, permission);
}
