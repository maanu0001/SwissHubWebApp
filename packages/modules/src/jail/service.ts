import {
  AUDIT_ACTIONS,
  Prisma,
  claimIdempotencyKey,
  completeIdempotencyKey,
  prisma,
  recordSecurityEvent,
  releaseIdempotencyKey,
  safeRecordAudit,
  SECURITY_EVENTS,
} from '@swisshub/database';
import {
  discord as defaultDiscord,
  isRecoverableRoleError,
  mapDiscordError,
  DiscordApiError,
} from '@swisshub/discord';
import { evaluateModerationPolicy } from '@swisshub/permissions';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict, configurationMissing, policyViolation } from '@swisshub/shared';
import type { JailEntry } from '@swisshub/database';
import type { DiscordGateway, GuildMember } from '@swisshub/discord';
import { JAIL_MODULE_ID } from './config';
import { loadJailContext, type JailExecutionContext } from './context';
import { planJailRoles, planReleaseRoles } from './roles';
import { buildJailEmbed, buildReleaseEmbed, postNotification } from './notifications';
import { assertDurationWithinLimit, type CreateJailInput } from './schemas';

const log = createLogger('jail:service');

/** Discord-Fehler in eine sichere, benutzerlesbare Form bringen. */
function toAppErrorFromDiscord(error: unknown): AppError {
  if (error instanceof DiscordApiError) {
    return mapDiscordError(error);
  }
  if (error instanceof AppError) {
    return error;
  }
  return new AppError('INTERNAL', {
    internalMessage: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

const IDEMPOTENCY_SCOPE_CREATE = 'jail.create';
const IDEMPOTENCY_SCOPE_RELEASE = 'jail.release';

/** Ausführender Moderator - bereits serverseitig authentifiziert und autorisiert. */
export interface JailActor {
  discordId: string;
  username: string;
  /** Avatar-Hash für die Darstellung in der Historie (optional). */
  avatarHash?: string | null;
  roleIds: string[];
  isOwner: boolean;
  moderationLevel: number;
}

export interface RequestMetadata {
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface JailServiceOptions {
  metadata?: RequestMetadata;
  gateway?: DiscordGateway;
  context?: JailExecutionContext;
}

export interface CreateJailResult {
  jail: JailEntry;
  /** Nicht blockierende Hinweise für das UI. */
  warnings: string[];
  /** True, wenn ein identischer Request bereits ausgeführt wurde. */
  duplicate: boolean;
}

/**
 * Erstellt einen Jail.
 *
 * Ablauf (Fail Closed, Datenbank als Source of Truth):
 *   Validierung -> Moderation Policy -> Idempotenz -> DB-Datensatz (PENDING)
 *   -> Discord-Rollen setzen -> COMPLETED + Audit + Benachrichtigung.
 * Schlägt Discord fehl, bleibt der Datensatz als FAILED erhalten und der
 * Jail gilt nicht als aktiv.
 */
export async function createJail(
  input: CreateJailInput,
  actor: JailActor,
  options: JailServiceOptions = {},
): Promise<CreateJailResult> {
  const gateway = options.gateway ?? defaultDiscord;
  const context = options.context ?? (await loadJailContext(gateway));
  const warnings: string[] = [];

  const jailRoleId = context.settings.jailRoleId;
  if (!jailRoleId) {
    throw configurationMissing(
      'Es ist keine Jail-Rolle konfiguriert. Bitte in den Einstellungen eine Jail-Rolle hinterlegen.',
    );
  }

  assertDurationWithinLimit(input.durationSeconds, context.settings.maxDurationSeconds);

  const jailRole = context.guildRoles.find((role) => role.id === jailRoleId);
  if (!jailRole) {
    throw configurationMissing(
      'Die konfigurierte Jail-Rolle existiert auf Discord nicht mehr. Bitte Einstellungen prüfen.',
    );
  }
  if (jailRole.position >= context.botHighestPosition) {
    throw new AppError('DISCORD_MISSING_PERMISSIONS', {
      userMessage:
        'Die Jail-Rolle liegt über der Rolle des Bots. Bitte die Bot-Rolle auf Discord höher einordnen.',
    });
  }

  // Zielmitglied immer frisch laden - Rollen können sich jederzeit geändert haben.
  const target = await gateway.members.get(input.targetDiscordId);
  const decision = evaluateModerationPolicy({
    actor: {
      discordId: actor.discordId,
      roleIds: actor.roleIds,
      isOwner: actor.isOwner,
      moderationLevel: actor.moderationLevel,
    },
    target,
    guildRoles: context.guildRoles,
    protectedRoleIds: context.protectedRoleIds,
    moderationLevels: context.moderationLevels,
    botHighestPosition: context.botHighestPosition,
    botUserId: context.botUserId,
    guildOwnerId: context.guildOwnerId,
  });

  if (!decision.allowed || !target) {
    await Promise.all([
      recordSecurityEvent({
        type: SECURITY_EVENTS.POLICY_VIOLATION,
        severity: 'MEDIUM',
        discordId: actor.discordId,
        ipHash: options.metadata?.ipHash,
        userAgent: options.metadata?.userAgent,
        metadata: { module: JAIL_MODULE_ID, code: decision.code, target: input.targetDiscordId },
      }),
      safeRecordAudit({
        action: AUDIT_ACTIONS.JAIL_FAILED,
        module: JAIL_MODULE_ID,
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        targetDiscordId: input.targetDiscordId,
        success: false,
        errorCode: decision.code ?? 'POLICY_VIOLATION',
        errorMessage: decision.message,
        metadata: { durationSeconds: input.durationSeconds },
        ipHash: options.metadata?.ipHash,
        userAgent: options.metadata?.userAgent,
      }),
    ]);
    throw policyViolation(decision.message ?? 'Diese Aktion ist nicht zulässig.');
  }

  // Idempotenz: doppelte Requests (Doppelklick, Retry, Refresh) abfangen.
  const claim = await claimIdempotencyKey(IDEMPOTENCY_SCOPE_CREATE, input.idempotencyKey, actor.discordId);
  if (claim.status === 'duplicate') {
    const existing = claim.existing?.resultRef
      ? await prisma.jailEntry.findUnique({ where: { id: claim.existing.resultRef } })
      : null;
    if (existing) {
      return { jail: existing, warnings: [], duplicate: true };
    }
    throw conflict('Diese Aktion wird bereits ausgeführt. Bitte einen Moment warten.');
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + input.durationSeconds * 1000);
  const plan = planJailRoles({
    currentRoleIds: target.roleIds,
    guildRoles: context.guildRoles,
    botHighestPosition: context.botHighestPosition,
    jailRoleId,
    keepRoleIds: context.keepRoleIds,
  });

  if (plan.untouchableRoleIds.length > 0) {
    warnings.push(
      `${plan.untouchableRoleIds.length} Rolle(n) konnten nicht entfernt werden, weil sie über der Rolle des Bots liegen.`,
    );
  }

  let entry: JailEntry;
  try {
    entry = await prisma.jailEntry.create({
      data: {
        targetDiscordId: target.discordId,
        targetUsername: target.username,
        targetDisplayName: target.displayName,
        targetAvatarHash: target.avatarHash,
        moderatorDiscordId: actor.discordId,
        moderatorUsername: actor.username,
        moderatorAvatarHash: actor.avatarHash ?? null,
        reason: input.reason,
        durationSeconds: input.durationSeconds,
        startedAt: now,
        endsAt,
        roleSnapshot: plan.snapshotRoleIds,
        keptRoleIds: plan.keptRoleIds,
        status: 'PENDING',
        activeKey: target.discordId,
        idempotencyKey: `${IDEMPOTENCY_SCOPE_CREATE}:${input.idempotencyKey}`,
      },
    });
  } catch (error) {
    await releaseIdempotencyKey(IDEMPOTENCY_SCOPE_CREATE, input.idempotencyKey);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('Dieses Mitglied ist bereits gejailt.');
    }
    throw error;
  }

  try {
    await prisma.jailEntry.update({ where: { id: entry.id }, data: { status: 'EXECUTING' } });
    await gateway.members.setRoles(
      target.discordId,
      plan.nextRoleIds,
      `Jail durch ${actor.username}: ${input.reason}`.slice(0, 400),
    );
  } catch (error) {
    const appError = toAppErrorFromDiscord(error);
    log.error('Jail konnte auf Discord nicht ausgeführt werden', {
      error,
      jailId: entry.id,
      target: target.discordId,
    });

    const failed = await prisma.jailEntry.update({
      where: { id: entry.id },
      data: {
        status: 'FAILED',
        activeKey: null,
        errorCode: appError.code,
        errorMessage: appError.internalMessage?.slice(0, 500) ?? appError.userMessage,
      },
    });

    await Promise.all([
      completeIdempotencyKey(IDEMPOTENCY_SCOPE_CREATE, input.idempotencyKey, 'FAILED', failed.id),
      safeRecordAudit({
        action: AUDIT_ACTIONS.JAIL_FAILED,
        module: JAIL_MODULE_ID,
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        targetDiscordId: target.discordId,
        targetLabel: target.displayName,
        success: false,
        errorCode: appError.code,
        errorMessage: appError.userMessage,
        metadata: { jailId: entry.id, durationSeconds: input.durationSeconds },
        ipHash: options.metadata?.ipHash,
        userAgent: options.metadata?.userAgent,
      }),
    ]);

    throw appError;
  }

  const completed = await prisma.jailEntry.update({
    where: { id: entry.id },
    data: { status: plan.untouchableRoleIds.length > 0 ? 'PARTIAL' : 'COMPLETED' },
  });

  await Promise.all([
    completeIdempotencyKey(IDEMPOTENCY_SCOPE_CREATE, input.idempotencyKey, completed.status, completed.id),
    prisma.moderationAction.create({
      data: {
        type: 'JAIL_CREATE',
        module: JAIL_MODULE_ID,
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        targetDiscordId: target.discordId,
        targetUsername: target.username,
        reason: input.reason,
        status: completed.status,
        referenceId: completed.id,
        metadata: { durationSeconds: input.durationSeconds, endsAt: endsAt.toISOString() },
      },
    }),
    safeRecordAudit({
      action: AUDIT_ACTIONS.JAIL_CREATED,
      module: JAIL_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      targetDiscordId: target.discordId,
      targetLabel: target.displayName,
      success: true,
      metadata: {
        jailId: completed.id,
        durationSeconds: input.durationSeconds,
        endsAt: endsAt.toISOString(),
        removedRoles: plan.removedRoleIds.length,
        keptRoles: plan.keptRoleIds.length,
      },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    }),
  ]);

  if (context.settings.postModerationLog) {
    await postNotification(
      gateway,
      context.moderationLogChannelId,
      buildJailEmbed({
        targetDiscordId: target.discordId,
        targetLabel: target.displayName,
        moderatorDiscordId: actor.discordId,
        moderatorLabel: actor.username,
        reason: input.reason,
        durationSeconds: input.durationSeconds,
        endsAt,
      }),
    );
  }
  if (context.settings.notifyInJailChannel) {
    await postNotification(
      gateway,
      context.jailChannelId,
      buildJailEmbed({
        targetDiscordId: target.discordId,
        targetLabel: target.displayName,
        moderatorDiscordId: actor.discordId,
        moderatorLabel: actor.username,
        reason: input.reason,
        durationSeconds: input.durationSeconds,
        endsAt,
      }),
      `<@${target.discordId}>`,
    );
  }

  return { jail: completed, warnings, duplicate: false };
}

export interface ReleaseJailOptions extends JailServiceOptions {
  /** Wer die Freilassung auslöst. `null` = automatisch durch den Bot. */
  actor?: JailActor | null;
  releaseType: 'MANUAL' | 'AUTOMATIC' | 'RECONCILED';
  /** Optionaler Idempotency Key (bei manuellen Aktionen aus dem UI). */
  idempotencyKey?: string;
  reason?: string;
}

export interface ReleaseJailResult {
  jail: JailEntry;
  restoredRoleIds: string[];
  failedRoleIds: string[];
  warnings: string[];
  memberLeftGuild: boolean;
}

/**
 * Lässt ein Mitglied frei.
 *
 * Die Freilassung wird per `updateMany` "beansprucht" - dadurch kann derselbe
 * Jail nicht gleichzeitig von zwei Moderatoren (oder vom Sweep-Job) beendet
 * werden. Einzelne nicht wiederherstellbare Rollen brechen den Vorgang nicht ab.
 */
export async function releaseJail(jailId: string, options: ReleaseJailOptions): Promise<ReleaseJailResult> {
  const gateway = options.gateway ?? defaultDiscord;
  const context = options.context ?? (await loadJailContext(gateway));
  const warnings: string[] = [];
  const actor = options.actor ?? null;

  if (options.idempotencyKey && actor) {
    const claim = await claimIdempotencyKey(
      IDEMPOTENCY_SCOPE_RELEASE,
      options.idempotencyKey,
      actor.discordId,
    );
    if (claim.status === 'duplicate') {
      const existing = await prisma.jailEntry.findUnique({ where: { id: jailId } });
      if (existing?.releasedAt) {
        return {
          jail: existing,
          restoredRoleIds: existing.restoredRoleIds,
          failedRoleIds: existing.failedRoleIds,
          warnings: [],
          memberLeftGuild: false,
        };
      }
      throw conflict('Diese Freilassung wird bereits ausgeführt.');
    }
  }

  // Atomar beanspruchen: nur ein Prozess darf den Release ausführen.
  const claimed = await prisma.jailEntry.updateMany({
    where: {
      id: jailId,
      releasedAt: null,
      OR: [{ releaseStatus: null }, { releaseStatus: { in: ['FAILED', 'PARTIAL'] } }],
    },
    data: { releaseStatus: 'EXECUTING' },
  });

  const jail = await prisma.jailEntry.findUnique({ where: { id: jailId } });
  if (!jail) {
    throw new AppError('NOT_FOUND', { userMessage: 'Der Jail-Eintrag wurde nicht gefunden.' });
  }
  if (claimed.count === 0) {
    if (jail.releasedAt) {
      throw conflict('Dieses Mitglied wurde bereits freigelassen.');
    }
    throw conflict('Die Freilassung wird bereits ausgeführt.');
  }

  const jailRoleId = context.settings.jailRoleId;
  if (!jailRoleId) {
    await prisma.jailEntry.update({ where: { id: jailId }, data: { releaseStatus: 'FAILED' } });
    throw configurationMissing('Es ist keine Jail-Rolle konfiguriert.');
  }

  let member: GuildMember | null = null;
  try {
    member = await gateway.members.get(jail.targetDiscordId);
  } catch (error) {
    await prisma.jailEntry.update({ where: { id: jailId }, data: { releaseStatus: 'FAILED' } });
    throw toAppErrorFromDiscord(error);
  }

  // Mitglied hat den Server verlassen: Jail wird beendet, damit die Datenbank
  // nicht dauerhaft einen aktiven Jail führt. Rollen kehren bei einem
  // erneuten Beitritt ohnehin nicht zurück.
  if (!member) {
    const closed = await finaliseRelease(jail.id, {
      releaseType: options.releaseType,
      actor,
      restored: [],
      failed: jail.roleSnapshot,
      status: 'PARTIAL',
    });
    warnings.push(
      'Das Mitglied befindet sich nicht mehr auf dem Server - es wurden keine Rollen wiederhergestellt.',
    );
    await safeRecordAudit({
      action: AUDIT_ACTIONS.JAIL_RELEASED,
      module: JAIL_MODULE_ID,
      actorDiscordId: actor?.discordId ?? null,
      actorUsername: actor?.username ?? 'system',
      targetDiscordId: jail.targetDiscordId,
      targetLabel: jail.targetUsername,
      success: true,
      metadata: { jailId: jail.id, releaseType: options.releaseType, memberLeftGuild: true },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    });
    return {
      jail: closed,
      restoredRoleIds: [],
      failedRoleIds: jail.roleSnapshot,
      warnings,
      memberLeftGuild: true,
    };
  }

  const plan = planReleaseRoles({
    currentRoleIds: member.roleIds,
    snapshotRoleIds: jail.roleSnapshot,
    guildRoles: context.guildRoles,
    botHighestPosition: context.botHighestPosition,
    jailRoleId,
  });

  const reason = `Jail-Ende (${options.releaseType === 'AUTOMATIC' ? 'automatisch' : (actor?.username ?? 'System')})`;
  let restored = plan.restorableRoleIds;
  const failed = [...plan.unrestorableRoleIds];

  try {
    await gateway.members.setRoles(member.discordId, plan.nextRoleIds, reason);
  } catch (error) {
    // Fallback: Jail-Rolle einzeln entfernen und Rollen einzeln zurückgeben,
    // damit eine einzelne problematische Rolle nicht den ganzen Release kippt.
    log.warn('Sammelaktualisierung der Rollen fehlgeschlagen - Einzelaktualisierung', {
      error,
      jailId: jail.id,
    });
    try {
      await gateway.roles.remove(member.discordId, jailRoleId, reason);
    } catch (removeError) {
      await prisma.jailEntry.update({
        where: { id: jailId },
        data: {
          releaseStatus: 'FAILED',
          errorCode: 'RELEASE_FAILED',
          errorMessage: 'Jail-Rolle konnte nicht entfernt werden.',
        },
      });
      await safeRecordAudit({
        action: AUDIT_ACTIONS.JAIL_FAILED,
        module: JAIL_MODULE_ID,
        actorDiscordId: actor?.discordId ?? null,
        actorUsername: actor?.username ?? 'system',
        targetDiscordId: jail.targetDiscordId,
        success: false,
        errorCode: 'RELEASE_FAILED',
        errorMessage: 'Jail-Rolle konnte nicht entfernt werden.',
        metadata: { jailId: jail.id },
      });
      throw toAppErrorFromDiscord(removeError);
    }

    const restoredIndividually: string[] = [];
    for (const roleId of plan.restorableRoleIds) {
      try {
        await gateway.roles.add(member.discordId, roleId, reason);
        restoredIndividually.push(roleId);
      } catch (roleError) {
        if (isRecoverableRoleError(roleError)) {
          failed.push(roleId);
          continue;
        }
        failed.push(roleId);
        log.warn('Rolle konnte nicht wiederhergestellt werden', {
          roleId,
          jailId: jail.id,
          error: roleError,
        });
      }
    }
    restored = restoredIndividually;
  }

  if (failed.length > 0) {
    warnings.push(`${failed.length} Rolle(n) konnten nicht wiederhergestellt werden.`);
  }

  const released = await finaliseRelease(jail.id, {
    releaseType: options.releaseType,
    actor,
    restored,
    failed,
    status: failed.length > 0 ? 'PARTIAL' : 'COMPLETED',
  });

  if (options.idempotencyKey && actor) {
    await completeIdempotencyKey(
      IDEMPOTENCY_SCOPE_RELEASE,
      options.idempotencyKey,
      released.releaseStatus ?? 'COMPLETED',
      released.id,
    );
  }

  await Promise.all([
    prisma.moderationAction.create({
      data: {
        type: 'JAIL_RELEASE',
        module: JAIL_MODULE_ID,
        actorDiscordId: actor?.discordId ?? 'system',
        actorUsername: actor?.username ?? 'System',
        targetDiscordId: jail.targetDiscordId,
        targetUsername: jail.targetUsername,
        reason: options.reason ?? null,
        status: released.releaseStatus ?? 'COMPLETED',
        referenceId: released.id,
        metadata: { releaseType: options.releaseType, restored: restored.length, failed: failed.length },
      },
    }),
    safeRecordAudit({
      action: AUDIT_ACTIONS.JAIL_RELEASED,
      module: JAIL_MODULE_ID,
      actorDiscordId: actor?.discordId ?? null,
      actorUsername: actor?.username ?? 'system',
      targetDiscordId: jail.targetDiscordId,
      targetLabel: jail.targetUsername,
      success: true,
      metadata: {
        jailId: jail.id,
        releaseType: options.releaseType,
        restoredRoles: restored.length,
        failedRoles: failed.length,
      },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    }),
  ]);

  if (context.settings.postModerationLog) {
    await postNotification(
      gateway,
      context.moderationLogChannelId,
      buildReleaseEmbed({
        targetDiscordId: jail.targetDiscordId,
        targetLabel: jail.targetDisplayName ?? jail.targetUsername,
        moderatorLabel: actor?.username ?? 'System',
        automatic: options.releaseType === 'AUTOMATIC',
        restoredRoles: restored.length,
        failedRoles: failed.length,
      }),
    );
  }

  return {
    jail: released,
    restoredRoleIds: restored,
    failedRoleIds: failed,
    warnings,
    memberLeftGuild: false,
  };
}

async function finaliseRelease(
  jailId: string,
  input: {
    releaseType: 'MANUAL' | 'AUTOMATIC' | 'RECONCILED';
    actor: JailActor | null;
    restored: string[];
    failed: string[];
    status: 'COMPLETED' | 'PARTIAL';
  },
): Promise<JailEntry> {
  return prisma.jailEntry.update({
    where: { id: jailId },
    data: {
      releasedAt: new Date(),
      releaseType: input.releaseType,
      releasedByDiscordId: input.actor?.discordId ?? null,
      releasedByUsername: input.actor?.username ?? 'System',
      restoredRoleIds: input.restored,
      failedRoleIds: input.failed,
      releaseStatus: input.status,
      activeKey: null,
    },
  });
}
