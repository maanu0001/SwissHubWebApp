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
import type { JailEntry, JailSource, Prisma as PrismaTypes } from '@swisshub/database';
import type { DiscordGateway, GuildMember } from '@swisshub/discord';
import { JAIL_MODULE_ID } from './config';
import { loadJailContext, type JailExecutionContext } from './context';
import { planJailRoles, planReleaseRoles } from './roles';
import { buildJailEmbed, buildReleaseEmbed, postNotification, postTemplateMessage } from './notifications';
import { assertDurationWithinLimit } from './schemas';
import { renderJailTemplate, resolveGender, type JailGender } from './templates';

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

/**
 * Eingabe des Jail-Services.
 *
 * Bewusst etwas lockerer als das Zod-Schema: `type` ist optional, damit
 * bestehende Aufrufer unverändert einen zeitlich begrenzten Jail erzeugen.
 */
export interface CreateJailCommand {
  targetDiscordId: string;
  reason: string;
  idempotencyKey: string;
  type?: 'TEMPORARY' | 'PERMANENT';
  /** Nur bei `TEMPORARY` relevant. */
  durationSeconds?: number | null;
  /**
   * Herkunft. Reine Information für Historie und Audit - der Ablauf ist für
   * Dashboard, Slash Command und Abstimmung identisch.
   */
  source?: JailSource;
  /**
   * Still: keine öffentliche Ankündigung. Ohne Angabe entscheidet die
   * Einstellung `silentByDefault`.
   */
  silent?: boolean;
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
  command: CreateJailCommand,
  actor: JailActor,
  options: JailServiceOptions = {},
): Promise<CreateJailResult> {
  // Aufrufer dürfen `type` weglassen - zeitlich begrenzt bleibt der Normalfall.
  const input = {
    ...command,
    type: command.type ?? ('TEMPORARY' as const),
    durationSeconds: command.type === 'PERMANENT' ? null : (command.durationSeconds ?? null),
    source: command.source ?? ('DASHBOARD' as JailSource),
  };

  const gateway = options.gateway ?? defaultDiscord;
  const context = options.context ?? (await loadJailContext(gateway));
  const warnings: string[] = [];

  const jailRoleId = context.settings.jailRoleId;
  if (!jailRoleId) {
    throw configurationMissing(
      'Es ist keine Jail-Rolle konfiguriert. Bitte in den Einstellungen eine Jail-Rolle hinterlegen.',
    );
  }

  // Die Obergrenze gilt nur für zeitlich begrenzte Jails; ein permanenter
  // Jail hat bewusst keine Dauer und damit auch keine Obergrenze.
  const permanent = input.type === 'PERMANENT';
  if (!permanent) {
    assertDurationWithinLimit(input.durationSeconds ?? 0, context.settings.maxDurationSeconds);
  }

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
        metadata: { type: input.type, durationSeconds: input.durationSeconds },
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
  const endsAt = permanent ? null : new Date(now.getTime() + (input.durationSeconds ?? 0) * 1000);
  const plan = planJailRoles({
    currentRoleIds: target.roleIds,
    guildRoles: context.guildRoles,
    botHighestPosition: context.botHighestPosition,
    jailRoleId,
    keepRoleIds: context.keepRoleIds,
  });

  // Anrede rein aus den konfigurierten Rollen. Ohne Konfiguration bleibt der
  // Text neutral - es wird nichts aus dem Namen abgeleitet.
  const gender = resolveGender(target.roleIds, context.genderRoles);
  // Ohne ausdrückliche Angabe entscheidet die Einstellung.
  const silent = input.silent ?? context.settings.silentByDefault;

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
        type: input.type,
        durationSeconds: input.durationSeconds,
        startedAt: now,
        endsAt,
        roleSnapshot: plan.snapshotRoleIds,
        keptRoleIds: plan.keptRoleIds,
        status: 'PENDING',
        lifecycle: 'PENDING',
        source: input.source,
        silent,
        activeKey: target.discordId,
        idempotencyKey: `${IDEMPOTENCY_SCOPE_CREATE}:${input.idempotencyKey}`,
        // Strukturierter Snapshot: jede Rolle mit Name und Position zum
        // Zeitpunkt des Jails - dadurch bleibt die Historie lesbar, auch wenn
        // eine Rolle später umbenannt oder gelöscht wird.
        roleSnapshotEntries: {
          create: buildRoleSnapshotRows(plan.snapshotRoleIds, plan.keptRoleIds, context),
        },
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
        lifecycle: 'FAILED',
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
        metadata: { jailId: entry.id, type: input.type, durationSeconds: input.durationSeconds },
        ipHash: options.metadata?.ipHash,
        userAgent: options.metadata?.userAgent,
      }),
    ]);

    throw appError;
  }

  // Aus dem Sprachkanal trennen. Bewusst nach dem Rollenwechsel und bewusst
  // nicht kritisch: der Jail gilt auch dann, wenn Discord die Trennung
  // ablehnt.
  let voiceDisconnected = false;
  if (context.settings.disconnectFromVoice) {
    voiceDisconnected = await gateway.members
      .disconnectFromVoice(target.discordId, 'Mitglied wurde gejailt')
      .catch((error: unknown) => {
        log.warn('Sprachkanal-Trennung fehlgeschlagen', { error, target: target.discordId });
        return false;
      });
  }

  const completed = await prisma.jailEntry.update({
    where: { id: entry.id },
    data: {
      status: plan.untouchableRoleIds.length > 0 ? 'PARTIAL' : 'COMPLETED',
      lifecycle: 'ACTIVE',
      voiceDisconnected,
    },
  });

  await Promise.all([
    completeIdempotencyKey(IDEMPOTENCY_SCOPE_CREATE, input.idempotencyKey, completed.status, completed.id),
    prisma.moderationAction.create({
      data: {
        type: 'JAIL_CREATE',
        module: JAIL_MODULE_ID,
        // Ein Jail entsteht immer auf Veranlassung eines Menschen - ueber das
        // Dashboard oder einen Slash-Befehl. Beides ist SwissHub.
        source: 'WEBAPP',
        actorType: 'HUMAN',
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        targetDiscordId: target.discordId,
        targetUsername: target.username,
        reason: input.reason,
        status: completed.status,
        referenceId: completed.id,
        metadata: {
          type: input.type,
          durationSeconds: input.durationSeconds,
          endsAt: endsAt?.toISOString() ?? null,
        },
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
        type: input.type,
        durationSeconds: input.durationSeconds,
        endsAt: endsAt?.toISOString() ?? null,
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

  await announceJail({
    gateway,
    context,
    silent,
    fromVote: input.source === 'VOTE_JAIL',
    data: {
      targetDiscordId: target.discordId,
      targetLabel: target.displayName,
      moderatorLabel: actor.username,
      moderatorDiscordId: actor.discordId,
      reason: input.reason,
      durationSeconds: input.durationSeconds,
      endsAt,
      gender,
    },
  });

  return { jail: completed, warnings, duplicate: false };
}

/**
 * Baut die Zeilen des Rollen-Snapshots.
 *
 * Name und Position werden aus dem aktuellen Guild-Zustand gelesen. Ist eine
 * Rolle dort nicht (mehr) vorhanden, bleiben die Felder leer - das ist
 * ehrlicher als ein Platzhaltername.
 */
function buildRoleSnapshotRows(
  snapshotRoleIds: readonly string[],
  keptRoleIds: readonly string[],
  context: JailExecutionContext,
): PrismaTypes.JailRoleSnapshotCreateWithoutJailInput[] {
  const kept = new Set(keptRoleIds);
  return snapshotRoleIds.map((roleId) => {
    const role = context.guildRoles.find((entry) => entry.id === roleId);
    return {
      roleId,
      roleNameAtTime: role?.name ?? null,
      rolePositionAtTime: role?.position ?? null,
      managedAtTime: role?.managed ?? false,
      kept: kept.has(roleId),
    };
  });
}

/**
 * Öffentliche Meldungen zu einem Jail.
 *
 * Ankündigung und Ping sind getrennt: ein stiller Jail unterdrückt die
 * öffentliche Ankündigung, das betroffene Mitglied wird aber weiterhin
 * informiert - genau so verhielt sich der alte Bot auch.
 */
async function announceJail(input: {
  gateway: DiscordGateway;
  context: JailExecutionContext;
  silent: boolean;
  fromVote: boolean;
  data: {
    targetDiscordId: string;
    targetLabel: string;
    moderatorLabel: string;
    moderatorDiscordId: string;
    reason: string;
    durationSeconds: number | null;
    endsAt: Date | null;
    gender: JailGender;
  };
}): Promise<void> {
  const { context, data } = input;

  if (!input.silent && context.settings.announcePublicly) {
    const template =
      data.endsAt === null
        ? context.settings.publicPermanentJailTemplate
        : context.settings.publicJailTemplate;
    await postTemplateMessage(
      input.gateway,
      context.announcementChannelId,
      renderJailTemplate(template, data),
      { mentionDiscordId: data.targetDiscordId },
    );
  }

  if (context.settings.pingOnJail) {
    const template = input.fromVote
      ? context.settings.voteJailPingTemplate
      : context.settings.jailPingTemplate;
    await postTemplateMessage(input.gateway, context.jailPingChannelId, renderJailTemplate(template, data), {
      mentionDiscordId: data.targetDiscordId,
    });
  }
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

  // Mitglied hat den Server verlassen.
  //
  // Ist "Jail beim Wiedereintritt erneut anwenden" aktiv, wird die Strafe
  // NICHT stillschweigend beendet: sie bleibt offen und wartet auf den
  // Wiedereintritt. Das entspricht dem alten Bot, der solche Einträge als
  // `expired_pending_restore` stehen liess, statt sie zu löschen.
  if (!member && context.settings.reapplyOnRejoin && options.releaseType !== 'MANUAL') {
    const pending = await prisma.jailEntry.update({
      where: { id: jail.id },
      data: { lifecycle: 'PENDING_REJOIN', leftGuildAt: jail.leftGuildAt ?? new Date(), releaseStatus: null },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.JAIL_PENDING_REJOIN,
      module: JAIL_MODULE_ID,
      actorDiscordId: actor?.discordId ?? null,
      actorUsername: actor?.username ?? 'system',
      targetDiscordId: jail.targetDiscordId,
      targetLabel: jail.targetUsername,
      success: true,
      metadata: { jailId: jail.id, releaseType: options.releaseType },
    });
    return {
      jail: pending,
      restoredRoleIds: [],
      failedRoleIds: [],
      warnings: [
        'Das Mitglied ist nicht mehr auf dem Server. Der Jail bleibt offen und wird beim Wiedereintritt erneut angewendet.',
      ],
      memberLeftGuild: true,
    };
  }

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
        // Ohne Handelnden war es die Zeitsteuerung: eine abgelaufene Frist,
        // die der Worker beendet hat. Das ist keine Entscheidung eines
        // Menschen und soll auch nicht so aussehen.
        source: actor ? 'WEBAPP' : 'SYSTEM',
        actorType: actor ? 'HUMAN' : 'SYSTEM',
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
        permanent: jail.type === 'PERMANENT',
        restoredRoles: restored.length,
        failedRoles: failed.length,
      }),
    );
  }

  // Öffentliche Freilassungsmeldung. Ein still verhängter Jail wird auch
  // still beendet - sonst würde die Strafe nachträglich doch publik.
  if (!jail.silent && context.settings.announcePublicly) {
    await postTemplateMessage(
      gateway,
      context.announcementChannelId,
      renderJailTemplate(context.settings.publicReleaseTemplate, {
        targetDiscordId: jail.targetDiscordId,
        targetLabel: jail.targetDisplayName ?? jail.targetUsername,
        moderatorLabel: actor?.username ?? 'System',
        reason: jail.reason,
        durationSeconds: jail.durationSeconds,
        endsAt: jail.endsAt,
        gender: resolveGender(member.roleIds, context.genderRoles),
      }),
      { mentionDiscordId: jail.targetDiscordId },
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
  const releasedAt = new Date();

  // Der Snapshot hält fest, welche Rolle tatsächlich zurückkam. Damit lässt
  // sich später beantworten, was einem Mitglied fehlt - ohne Rätselraten.
  if (input.restored.length > 0) {
    await prisma.jailRoleSnapshot.updateMany({
      where: { jailId, roleId: { in: input.restored } },
      data: { restoredAt: releasedAt, restoreFailedCode: null },
    });
  }
  if (input.failed.length > 0) {
    await prisma.jailRoleSnapshot.updateMany({
      where: { jailId, roleId: { in: input.failed } },
      data: { restoreFailedCode: 'NOT_RESTORABLE' },
    });
  }

  return prisma.jailEntry.update({
    where: { id: jailId },
    data: {
      releasedAt,
      releaseType: input.releaseType,
      releasedByDiscordId: input.actor?.discordId ?? null,
      releasedByUsername: input.actor?.username ?? 'System',
      restoredRoleIds: input.restored,
      failedRoleIds: input.failed,
      releaseStatus: input.status,
      activeKey: null,
      // Abgelaufen oder aufgehoben - das ist ein fachlicher Unterschied und
      // wird deshalb unterschieden. Konnten Rollen nicht zurückgegeben
      // werden, bleibt das ebenfalls sichtbar.
      lifecycle:
        input.failed.length > 0
          ? 'RESTORE_FAILED'
          : input.releaseType === 'AUTOMATIC'
            ? 'EXPIRED'
            : 'RELEASED',
    },
  });
}

/**
 * Wendet einen offenen Jail beim Wiedereintritt erneut an.
 *
 * Ohne diese Behandlung wäre ein Jail durch Verlassen und erneutes Beitreten
 * beliebig umgehbar. Der alte Bot löste das im `on_member_join`-Event; hier
 * ist es ein Service, der von genau demselben Event aufgerufen wird - die
 * Entscheidung liegt aber in der Datenbank, nicht im Discord-Client.
 *
 * Drei Fälle:
 *   - kein offener Jail                 -> nichts zu tun
 *   - Jail bereits abgelaufen           -> regulär freilassen (Rollen zurück)
 *   - Jail läuft noch                   -> Jail-Rolle erneut setzen
 */
export async function reapplyJailOnRejoin(
  discordId: string,
  options: JailServiceOptions = {},
): Promise<'none' | 'reapplied' | 'released' | 'failed'> {
  const gateway = options.gateway ?? defaultDiscord;

  const open = await prisma.jailEntry.findFirst({
    where: {
      targetDiscordId: discordId,
      releasedAt: null,
      lifecycle: { in: ['ACTIVE', 'PENDING_REJOIN', 'RESTORE_FAILED'] },
    },
    orderBy: { startedAt: 'desc' },
  });
  if (!open) {
    return 'none';
  }

  const context = options.context ?? (await loadJailContext(gateway));
  if (!context.settings.reapplyOnRejoin) {
    return 'none';
  }

  // Die Strafe ist während der Abwesenheit abgelaufen: dann wird sie beim
  // Wiedereintritt sofort korrekt beendet statt erneut verhängt.
  if (open.type === 'TEMPORARY' && open.endsAt !== null && open.endsAt <= new Date()) {
    try {
      await releaseJail(open.id, { releaseType: 'AUTOMATIC', gateway, context });
      return 'released';
    } catch (error) {
      log.warn('Abgelaufener Jail konnte beim Wiedereintritt nicht beendet werden', {
        error,
        jailId: open.id,
      });
      return 'failed';
    }
  }

  const jailRoleId = context.settings.jailRoleId;
  const member = await gateway.members.get(discordId).catch(() => null);
  if (!jailRoleId || !member) {
    return 'failed';
  }

  const plan = planJailRoles({
    currentRoleIds: member.roleIds,
    guildRoles: context.guildRoles,
    botHighestPosition: context.botHighestPosition,
    jailRoleId,
    keepRoleIds: context.keepRoleIds,
  });

  try {
    await gateway.members.setRoles(discordId, plan.nextRoleIds, 'Wiedereintritt während eines Jails');
  } catch (error) {
    log.error('Jail konnte beim Wiedereintritt nicht erneut angewendet werden', {
      error,
      jailId: open.id,
      target: discordId,
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.JAIL_REAPPLY_FAILED,
      module: JAIL_MODULE_ID,
      actorUsername: 'system',
      targetDiscordId: discordId,
      targetLabel: open.targetUsername,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'unbekannt',
      metadata: { jailId: open.id },
    });
    return 'failed';
  }

  const updated = await prisma.jailEntry.update({
    where: { id: open.id },
    data: {
      lifecycle: 'ACTIVE',
      leftGuildAt: null,
      reappliedCount: { increment: 1 },
      activeKey: discordId,
      // Der Wiedereintritt bringt den Datensatz zurück in den Normalzustand.
      releaseStatus: null,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.JAIL_REAPPLIED,
    module: JAIL_MODULE_ID,
    actorUsername: 'system',
    targetDiscordId: discordId,
    targetLabel: open.targetUsername,
    success: true,
    metadata: {
      jailId: open.id,
      reappliedCount: updated.reappliedCount,
      endsAt: open.endsAt?.toISOString() ?? null,
    },
  });

  log.info('Jail beim Wiedereintritt erneut angewendet', { jailId: open.id, target: discordId });
  return 'reapplied';
}

/**
 * Vermerkt, dass ein gejailtes Mitglied den Server verlassen hat.
 *
 * Der Jail bleibt bestehen - er endet nicht dadurch, dass jemand geht.
 */
export async function markMemberLeftDuringJail(discordId: string): Promise<boolean> {
  const active = await prisma.jailEntry.findUnique({ where: { activeKey: discordId } });
  if (!active) {
    return false;
  }

  await prisma.jailEntry.update({
    where: { id: active.id },
    data: { lifecycle: 'PENDING_REJOIN', leftGuildAt: new Date() },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.JAIL_PENDING_REJOIN,
    module: JAIL_MODULE_ID,
    actorUsername: 'system',
    targetDiscordId: discordId,
    targetLabel: active.targetUsername,
    success: true,
    metadata: { jailId: active.id, reason: 'member-left' },
  });

  log.info('Mitglied hat den Server während eines Jails verlassen', { jailId: active.id });
  return true;
}
