import {
  AUDIT_ACTIONS,
  Prisma,
  SECURITY_EVENTS,
  prisma,
  recordSecurityEvent,
  safeRecordAudit,
} from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { evaluateModerationPolicy } from '@swisshub/permissions';
import { AppError, sanitizeText } from '@swisshub/shared';
import type { VoteJail } from '@swisshub/database';
import { JAIL_MODULE_ID, JAIL_PERMISSIONS, type JailSettings } from '../config';
import { getModuleSettings } from '../../module-state';
import { loadJailContext, type JailExecutionContext } from '../context';
import { createJail } from '../service';
import { buildVoteJailMessage } from './embed';

const log = createLogger('jail:vote');

/**
 * Vote Jail.
 *
 * Die Abstimmung ist eine eigene Ebene über dem bestehenden Jail-Modul: sie
 * sammelt Stimmen und ruft bei Erfolg den regulären `createJail`-Service auf.
 * Es gibt bewusst keinen zweiten Weg, einen Jail auszusprechen - Moderation
 * Policy, Rollen-Snapshot, Audit Log und Discord-Fehlerbehandlung gelten
 * dadurch unverändert.
 */
export interface VoteJailActor {
  discordId: string;
  username: string;
  avatarHash?: string | null;
  roleIds: string[];
  isOwner: boolean;
  moderationLevel: number;
  /**
   * Darf die Sperrfrist überspringen (`jail.vote.bypassCooldown`).
   *
   * Wird vom Aufrufer aus dem Permission-System bestimmt - der alte Bot hatte
   * dafür eine feste Admin-Rolle.
   */
  bypassCooldown?: boolean;
}

export interface StartVoteJailInput {
  targetDiscordId: string;
  reason?: string | null;
}

export interface VoteJailOptions {
  gateway?: DiscordGateway;
  context?: JailExecutionContext;
  metadata?: { ipHash?: string | null; userAgent?: string | null };
}

/** Konfiguration der Abstimmung (Standard: 5 Stimmen, 5 Minuten, 30 Minuten Jail). */
export interface VoteJailConfig {
  enabled: boolean;
  channelId: string | null;
  requiredVotes: number;
  durationSeconds: number;
  resultSeconds: number;
  /** Sperrfrist des Initiators nach einer erfolgreichen Abstimmung. */
  cooldownHours: number;
}

export async function getVoteJailConfig(): Promise<VoteJailConfig> {
  const settings = await getModuleSettings<JailSettings>(JAIL_MODULE_ID);
  return {
    enabled: settings.voteJailEnabled,
    channelId: settings.voteJailChannelId ?? null,
    requiredVotes: settings.voteJailRequiredVotes,
    durationSeconds: settings.voteJailDurationSeconds,
    resultSeconds: settings.voteJailResultSeconds,
    cooldownHours: settings.voteJailCooldownHours,
  };
}

/**
 * Laufende Sperrfrist eines Initiators.
 *
 * `null` bedeutet: darf sofort starten. Abgelaufene Einträge werden dabei
 * gleich entfernt, damit die Tabelle nicht wächst.
 */
export async function getVoteCooldown(discordId: string): Promise<Date | null> {
  const entry = await prisma.voteJailCooldown.findUnique({ where: { discordId } });
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= new Date()) {
    await prisma.voteJailCooldown.deleteMany({ where: { discordId, expiresAt: entry.expiresAt } });
    return null;
  }
  return entry.expiresAt;
}

/** Setzt die Sperrfrist nach einer erfolgreichen Abstimmung. */
async function applyVoteCooldown(
  actor: { discordId: string; username: string },
  voteJailId: string,
  hours: number,
): Promise<void> {
  if (hours <= 0) {
    return;
  }
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await prisma.voteJailCooldown.upsert({
    where: { discordId: actor.discordId },
    create: {
      discordId: actor.discordId,
      username: actor.username,
      lastVoteJailId: voteJailId,
      expiresAt,
    },
    update: { username: actor.username, lastVoteJailId: voteJailId, startedAt: new Date(), expiresAt },
  });
}

/** Entfernt abgelaufene Sperrfristen (Aufräumjob). */
export async function purgeExpiredVoteCooldowns(): Promise<number> {
  const result = await prisma.voteJailCooldown.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}

/**
 * Startet eine Abstimmung.
 *
 * Geprüft wird vorab dasselbe wie bei einem direkten Jail (Moderation Policy),
 * damit eine Abstimmung gar nicht erst gegen jemanden laufen kann, den der Bot
 * anschliessend nicht jailen dürfte.
 */
export async function startVoteJail(
  input: StartVoteJailInput,
  actor: VoteJailActor,
  options: VoteJailOptions = {},
): Promise<VoteJail> {
  const gateway = options.gateway ?? defaultDiscord;
  const config = await getVoteJailConfig();

  if (!config.enabled) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Vote Jail ist deaktiviert. Bitte zuerst in den Jail-Einstellungen aktivieren.',
    });
  }
  if (!config.channelId) {
    throw new AppError('CONFIGURATION_MISSING', {
      userMessage: 'Es ist kein Vote-Jail-Channel konfiguriert.',
    });
  }

  const context = options.context ?? (await loadJailContext(gateway));
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
    await recordSecurityEvent({
      type: SECURITY_EVENTS.POLICY_VIOLATION,
      severity: 'MEDIUM',
      discordId: actor.discordId,
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
      metadata: {
        module: JAIL_MODULE_ID,
        action: 'vote',
        code: decision.code,
        target: input.targetDiscordId,
      },
    });
    throw new AppError('POLICY_VIOLATION', {
      userMessage: decision.message ?? 'Diese Aktion ist nicht zulässig.',
    });
  }

  // Bereits gejailt? Dann ist eine Abstimmung sinnlos.
  const activeJail = await prisma.jailEntry.findUnique({ where: { activeKey: target.discordId } });
  if (activeJail) {
    throw new AppError('CONFLICT', { userMessage: 'Dieses Mitglied ist bereits gejailt.' });
  }

  // Sperrfrist des Initiators. Sie verhindert, dass dieselbe Person Vote Jail
  // als Dauerwerkzeug einsetzt.
  if (!actor.bypassCooldown && config.cooldownHours > 0) {
    const until = await getVoteCooldown(actor.discordId);
    if (until) {
      await safeRecordAudit({
        action: AUDIT_ACTIONS.VOTE_JAIL_BLOCKED,
        module: JAIL_MODULE_ID,
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        targetDiscordId: target.discordId,
        success: false,
        errorCode: 'COOLDOWN',
        metadata: { until: until.toISOString() },
        ipHash: options.metadata?.ipHash,
        userAgent: options.metadata?.userAgent,
      });
      throw new AppError('RATE_LIMITED', {
        userMessage: `Du chasch erscht ${formatCooldownRemaining(until)} wieder es Voting starte.`,
      });
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.durationSeconds * 1000);
  const reason = input.reason ? sanitizeText(input.reason, 500) : null;

  let vote: VoteJail;
  try {
    vote = await prisma.voteJail.create({
      data: {
        targetDiscordId: target.discordId,
        targetUsername: target.username,
        targetDisplayName: target.displayName,
        targetAvatarHash: target.avatarHash,
        startedByDiscordId: actor.discordId,
        startedByUsername: actor.username,
        startedByAvatarHash: actor.avatarHash ?? null,
        reason,
        requiredVotes: config.requiredVotes,
        resultingJailMinutes: Math.round(config.resultSeconds / 60),
        discordChannelId: config.channelId,
        expiresAt,
        // Unique-Index: verhindert zwei gleichzeitige Abstimmungen gegen dieselbe Person.
        activeKey: target.discordId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', {
        userMessage: 'Gegen dieses Mitglied läuft bereits eine Abstimmung.',
      });
    }
    throw error;
  }

  // Discord-Nachricht mit Button. Schlägt sie fehl, ist die Abstimmung
  // wertlos - sie wird deshalb sofort wieder abgebrochen.
  try {
    const message = await gateway.channels.send(config.channelId, buildVoteJailMessage(vote));
    vote = await prisma.voteJail.update({
      where: { id: vote.id },
      data: { discordMessageId: message.id },
    });
  } catch (error) {
    await prisma.voteJail.update({
      where: { id: vote.id },
      data: { status: 'CANCELLED', activeKey: null, finishedAt: new Date() },
    });
    log.error('Vote Jail konnte nicht veröffentlicht werden', { error, voteJailId: vote.id });
    throw new AppError('DISCORD_UNAVAILABLE', {
      userMessage:
        'Die Abstimmung konnte auf Discord nicht veröffentlicht werden. Darf der Bot in diesem Channel schreiben?',
    });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VOTE_JAIL_STARTED,
    module: JAIL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: target.discordId,
    targetLabel: target.displayName,
    success: true,
    metadata: {
      voteJailId: vote.id,
      requiredVotes: vote.requiredVotes,
      expiresAt: expiresAt.toISOString(),
      reason,
    },
    ipHash: options.metadata?.ipHash,
    userAgent: options.metadata?.userAgent,
  });

  log.info('Vote Jail gestartet', { voteJailId: vote.id, target: target.discordId });
  return vote;
}

export type CastVoteOutcome =
  | { result: 'counted'; vote: VoteJail; votes: number; reachedThreshold: boolean }
  | { result: 'already-voted'; votes: number }
  | { result: 'not-active' }
  | { result: 'self-vote' };

/**
 * Zählt eine Stimme.
 *
 * Die gesamte Zählung läuft in einer Transaktion mit Zeilensperre auf der
 * Abstimmung (`SELECT ... FOR UPDATE`). Zwei gleichzeitige Klicks auf die
 * fünfte Stimme können dadurch nicht beide "Schwelle erreicht" sehen - genau
 * einer gewinnt und löst den Jail aus.
 */
export async function castVote(
  voteJailId: string,
  voter: { discordId: string; username?: string | null; canMultivote: boolean },
): Promise<CastVoteOutcome> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"::text AS "status"
      FROM "VoteJail"
      WHERE "id" = ${voteJailId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row || row.status !== 'ACTIVE') {
      return { result: 'not-active' as const };
    }

    const vote = await tx.voteJail.findUniqueOrThrow({ where: { id: voteJailId } });
    if (vote.expiresAt <= new Date()) {
      return { result: 'not-active' as const };
    }
    // Wer zur Abstimmung steht, stimmt nicht über sich selbst ab.
    if (vote.targetDiscordId === voter.discordId) {
      return { result: 'self-vote' as const };
    }

    const existing = await tx.voteJailVote.count({
      where: { voteJailId, voterDiscordId: voter.discordId },
    });
    if (existing > 0 && !voter.canMultivote) {
      return { result: 'already-voted' as const, votes: vote.voteCount };
    }

    await tx.voteJailVote.create({
      data: {
        voteJailId,
        voterDiscordId: voter.discordId,
        voterUsername: voter.username ?? null,
        voteNumber: existing + 1,
        isAdminVote: voter.canMultivote,
      },
    });

    const votes = vote.voteCount + 1;
    const reachedThreshold = votes >= vote.requiredVotes;

    const updated = await tx.voteJail.update({
      where: { id: voteJailId },
      data: {
        voteCount: votes,
        // Der Status wechselt innerhalb derselben Transaktion. Ein zweiter
        // gleichzeitiger Klick sieht danach nicht mehr ACTIVE und zählt nicht.
        ...(reachedThreshold ? { status: 'SUCCEEDED' as const, finishedAt: new Date() } : {}),
      },
    });

    return { result: 'counted' as const, vote: updated, votes, reachedThreshold };
  });
}

/**
 * Führt den Jail nach erfolgreicher Abstimmung aus.
 *
 * Läuft ausserhalb der Vote-Transaktion, weil dabei Discord angesprochen wird.
 * `resultingJailId` ist unique - selbst bei einem doppelten Aufruf entsteht
 * höchstens ein Jail.
 */
export async function completeSuccessfulVote(
  voteJailId: string,
  options: VoteJailOptions = {},
): Promise<VoteJail> {
  const gateway = options.gateway ?? defaultDiscord;
  const vote = await prisma.voteJail.findUniqueOrThrow({ where: { id: voteJailId } });

  if (vote.resultingJailId) {
    return vote;
  }

  const config = await getVoteJailConfig();
  let jailId: string | null = null;
  let failure: string | null = null;

  try {
    const result = await createJail(
      {
        targetDiscordId: vote.targetDiscordId,
        type: 'TEMPORARY',
        durationSeconds: config.resultSeconds,
        reason: vote.reason ? `Vote Jail: ${vote.reason}` : 'Vote Jail',
        idempotencyKey: voteJailIdempotencyKey(vote.id),
        // Herkunft: dadurch verwendet der Jail-Service die Vote-Vorlage für
        // den Ping und die Historie zeigt, woher die Strafe kam.
        source: 'VOTE_JAIL',
      },
      // Ausgelöst hat die Community, ausgeführt wird im Namen des Initiators.
      // Die Moderation Policy wurde bereits beim Start geprüft; hier zählt nur
      // noch, dass der Bot die Rollen technisch setzen kann.
      {
        discordId: vote.startedByDiscordId,
        username: `${vote.startedByUsername} (Vote Jail)`,
        roleIds: [],
        isOwner: true,
        moderationLevel: 1000,
      },
      { gateway, context: options.context },
    );
    jailId = result.jail.id;
  } catch (error) {
    failure = error instanceof AppError ? error.userMessage : 'Unbekannter Fehler';
    log.error('Jail nach erfolgreicher Abstimmung fehlgeschlagen', { error, voteJailId });
  }

  const finished = await prisma.voteJail.update({
    where: { id: voteJailId },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      activeKey: null,
      resultingJailId: jailId,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VOTE_JAIL_SUCCEEDED,
    module: JAIL_MODULE_ID,
    actorDiscordId: vote.startedByDiscordId,
    actorUsername: vote.startedByUsername,
    targetDiscordId: vote.targetDiscordId,
    targetLabel: vote.targetDisplayName ?? vote.targetUsername,
    success: failure === null,
    errorMessage: failure,
    metadata: {
      voteJailId: vote.id,
      votes: finished.voteCount,
      requiredVotes: finished.requiredVotes,
      jailId,
      jailSeconds: config.resultSeconds,
    },
  });

  // Sperrfrist erst nach dem Ergebnis: eine gescheiterte oder abgebrochene
  // Abstimmung sperrt niemanden.
  if (jailId) {
    const bypass = await initiatorMayBypassCooldown(vote.startedByDiscordId);
    if (!bypass) {
      await applyVoteCooldown(
        { discordId: vote.startedByDiscordId, username: vote.startedByUsername },
        vote.id,
        config.cooldownHours,
      );
    }
  }

  await updateVoteMessage(finished, gateway);
  return finished;
}

/**
 * Prüft die Sperrfrist-Ausnahme anhand der aktuellen Rollen des Initiators.
 *
 * Der Abschluss läuft im Hintergrund, es gibt also keinen Request-Kontext -
 * deshalb wird die Berechtigung hier frisch aufgelöst.
 */
async function initiatorMayBypassCooldown(discordId: string): Promise<boolean> {
  try {
    const { loadRoleConfiguration, resolvePermissions, hasPermission } =
      await import('@swisshub/permissions');
    const { discord } = await import('@swisshub/discord');
    const [configuration, member] = await Promise.all([
      loadRoleConfiguration(),
      discord.members.get(discordId).catch(() => null),
    ]);
    const resolution = resolvePermissions(
      { discordId, roleIds: member?.roleIds ?? [], isOwner: false },
      configuration.mappings,
    );
    return hasPermission(resolution, JAIL_PERMISSIONS.voteBypassCooldown);
  } catch (error) {
    // Im Zweifel gilt die Sperrfrist - das ist die zurückhaltendere Annahme.
    log.warn('Sperrfrist-Ausnahme konnte nicht geprüft werden', { error, discordId });
    return false;
  }
}

/** "in 11 Stunden und 20 Minuten" - für die Rückmeldung an den Initiator. */
export function formatCooldownRemaining(until: Date, now: Date = new Date()): string {
  const totalMinutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `i ${minutes} Minute`;
  }
  if (minutes === 0) {
    return `i ${hours} Stund`;
  }
  return `i ${hours} Stund und ${minutes} Minute`;
}

/** Beendet abgelaufene Abstimmungen ohne Ergebnis (Worker im Bot). */
export async function expireVoteJails(
  limit = 25,
  gateway: DiscordGateway = defaultDiscord,
): Promise<{ expired: number }> {
  const due = await prisma.voteJail.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  });

  let expired = 0;
  for (const vote of due) {
    const finished = await prisma.voteJail.update({
      where: { id: vote.id },
      data: { status: 'FAILED', finishedAt: new Date(), activeKey: null },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.VOTE_JAIL_FAILED,
      module: JAIL_MODULE_ID,
      actorDiscordId: vote.startedByDiscordId,
      actorUsername: vote.startedByUsername,
      targetDiscordId: vote.targetDiscordId,
      targetLabel: vote.targetDisplayName ?? vote.targetUsername,
      success: true,
      metadata: {
        voteJailId: vote.id,
        votes: finished.voteCount,
        requiredVotes: finished.requiredVotes,
      },
    });

    await updateVoteMessage(finished, gateway);
    expired += 1;
  }

  if (expired > 0) {
    log.info('Abgelaufene Abstimmungen beendet', { expired });
  }
  return { expired };
}

/**
 * Aktualisiert das Discord-Embed.
 *
 * Best effort: eine fehlgeschlagene Aktualisierung darf das Ergebnis der
 * Abstimmung nicht in Frage stellen - massgeblich ist die Datenbank.
 */
export async function updateVoteMessage(
  vote: VoteJail,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  if (!vote.discordChannelId || !vote.discordMessageId) {
    return;
  }
  try {
    await gateway.channels.edit(vote.discordChannelId, vote.discordMessageId, buildVoteJailMessage(vote));
  } catch (error) {
    log.warn('Vote-Embed konnte nicht aktualisiert werden', { error, voteJailId: vote.id });
  }
}

/** Stabiler Idempotency Key: pro Abstimmung entsteht höchstens ein Jail. */
function voteJailIdempotencyKey(voteJailId: string): string {
  // Der Jail-Service erwartet eine UUID-Form; aus der Abstimmungs-ID wird
  // deterministisch eine erzeugt.
  const hex = Buffer.from(voteJailId).toString('hex').padEnd(32, '0').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
