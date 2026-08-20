import {
  AUDIT_ACTIONS,
  Prisma,
  claimIdempotencyKey,
  completeIdempotencyKey,
  prisma,
  releaseIdempotencyKey,
  safeRecordAudit,
} from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict, configurationMissing } from '@swisshub/shared';
import type { SpielersucheMatch, SpielersucheParticipant, SpielersucheSource } from '@swisshub/database';
import { SPIELERSUCHE_MODULE_ID } from './config';
import { loadSpielersucheContext, type SpielersucheContext } from './context';
import { buildMatchMessage, totalSlots } from './embed';
import { createVoiceChannel, deleteVoiceChannel, grantVoiceAccess, revokeVoiceAccess } from './voice';
import { recordUsage } from './stats';
import type { CreateSearchInput } from './schemas';

const log = createLogger('spielersuche:service');

/**
 * Zentrale Spielersuche-Engine.
 *
 * Dies ist die einzige Stelle, an der eine Suche entsteht, wächst, schrumpft
 * oder endet. Slash Command, Discord-Buttons und Dashboard sind reine
 * Oberflächen darüber - sie liefern einen Akteur und eine Eingabe, alles
 * andere passiert hier. Dadurch gelten überall dieselbe Prüfung, dieselbe
 * Statuslogik, dasselbe Embed und dasselbe Audit Log.
 */

const IDEMPOTENCY_SCOPE = 'spielersuche.create';

/** Bereits authentifizierter und autorisierter Aufrufer. */
export interface SpielersucheActor {
  discordId: string;
  username: string;
  displayName?: string | null;
  avatarHash?: string | null;
}

export interface SpielersucheOptions {
  gateway?: DiscordGateway;
  context?: SpielersucheContext;
  metadata?: { ipHash?: string | null; userAgent?: string | null };
}

export interface CreateSearchResult {
  match: SpielersucheMatch;
  /** Nicht blockierende Hinweise für die Rückmeldung. */
  warnings: string[];
  /** True, wenn die Spielrolle tatsächlich erwähnt wurde. */
  rolePinged: boolean;
  /** Verbleibende Sperrfrist in Sekunden, falls nicht gepingt wurde. */
  pingCooldownSeconds: number;
  duplicate: boolean;
}

/** Teilnehmer, die aktuell dabei sind (Ausgetretene haben `leftAt`). */
async function activeParticipants(matchId: string): Promise<SpielersucheParticipant[]> {
  return prisma.spielersucheParticipant.findMany({
    where: { matchId, leftAt: null },
    orderBy: { joinedAt: 'asc' },
  });
}

/**
 * Startet eine Spielersuche.
 *
 * Ablauf (identisch für Dashboard und Slash Command):
 *   Konfiguration -> Spiel -> Limit offener Suchen -> Squad-Grösse ->
 *   Idempotenz -> Datensatz + Ersteller -> Sprachkanal -> Nachricht ->
 *   Rollen-Ping -> Statistik -> Audit.
 */
export async function createSearch(
  input: CreateSearchInput & { source?: SpielersucheSource },
  actor: SpielersucheActor,
  options: SpielersucheOptions = {},
): Promise<CreateSearchResult> {
  const gateway = options.gateway ?? defaultDiscord;
  const context = options.context ?? (await loadSpielersucheContext(gateway));
  const source: SpielersucheSource = input.source ?? 'SLASH_COMMAND';
  const warnings: string[] = [];

  if (!context.searchChannelId) {
    throw configurationMissing(
      'Es ist kein Spielersuche-Channel konfiguriert. Bitte in den Moduleinstellungen einen Channel wählen.',
    );
  }

  const game = await prisma.spielersucheGame.findUnique({ where: { id: input.gameId } });
  if (!game) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Das Spiel isch nüme konfiguriert. Bitte wähl es neus us.',
    });
  }
  if (!game.enabled) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `"${game.name}" isch momentan deaktiviert.`,
    });
  }

  // Squad-Grösse: der Ersteller zählt bereits mit. Bei "unbegrenzt" gilt die
  // allgemeine Obergrenze aus den Einstellungen.
  const limit = game.maxSquadSize ?? context.settings.maxRequestedPlayers + 1;
  if (input.requestedPlayers + 1 > limit) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: game.maxSquadSize
        ? `Bi "${game.name}" passed maximal ${game.maxSquadSize} Lüt i d Gruppe - du chasch also höchstens ${game.maxSquadSize - 1} sueche.`
        : `Du chasch höchstens ${context.settings.maxRequestedPlayers} zuesätzlichi Spieler sueche.`,
    });
  }

  // Idempotenz: Doppelklick im Dashboard oder ein Retry darf nur eine Suche
  // erzeugen.
  const claim = await claimIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey, actor.discordId);
  if (claim.status === 'duplicate') {
    const existing = claim.existing?.resultRef
      ? await prisma.spielersucheMatch.findUnique({ where: { id: claim.existing.resultRef } })
      : null;
    if (existing) {
      return {
        match: existing,
        warnings: [],
        rolePinged: existing.rolePinged,
        pingCooldownSeconds: 0,
        duplicate: true,
      };
    }
    throw conflict('Die Suechi wird grad scho erstellt. Bitte churz warte.');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + context.settings.expiryHours * 60 * 60 * 1000);

  let match: SpielersucheMatch;
  try {
    match = await claimSlotAndCreate({
      actor,
      game,
      input,
      source,
      now,
      expiresAt,
      maxActive: context.settings.maxActiveSearchesPerUser,
    });
  } catch (error) {
    await releaseIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey);
    throw error;
  }

  // --- Sprachkanal ---------------------------------------------------------
  const guild = await gateway.guild.get().catch(() => null);
  if (guild) {
    const voice = await createVoiceChannel(match, context, {
      guildId: guild.id,
      creatorLabel: actor.displayName ?? actor.username,
    });
    if (voice) {
      match = await prisma.spielersucheMatch.update({
        where: { id: match.id },
        data: { voiceChannelId: voice.channelId, voiceChannelName: voice.name },
      });
    } else if (context.settings.voiceEnabled) {
      warnings.push(
        'De Voice-Channel het nöd chöne erstellt werde. Prüef, öb de Bot i de Kategorie Kanäl verwalte darf.',
      );
    }
  }

  // --- Rollen-Ping ---------------------------------------------------------
  const ping = await evaluateRolePing(game.id, context);

  // --- Nachricht -----------------------------------------------------------
  const participants = await activeParticipants(match.id);
  const payload = buildMatchMessage({
    match,
    participants,
    accentColor: context.accentColor,
    footerText: context.settings.footerText,
    guildId: guild?.id ?? null,
  });

  try {
    const message = await gateway.channels.send(context.searchChannelId, {
      ...payload,
      ...(ping.shouldPing
        ? {
            content: `<@&${game.roleId}>`,
            // Ausschliesslich diese eine Rolle - nichts sonst wird erwähnt.
            allowedMentions: { parse: [], roles: [game.roleId] },
          }
        : {}),
    });

    match = await prisma.spielersucheMatch.update({
      where: { id: match.id },
      data: {
        channelId: context.searchChannelId,
        messageId: message.id,
        rolePinged: ping.shouldPing,
        pingRoleId: game.roleId,
      },
    });
  } catch (error) {
    // Ohne Nachricht ist die Suche unsichtbar und damit wertlos - sie wird
    // deshalb sofort wieder geschlossen und der Kanal aufgeräumt.
    log.error('Spielersuche konnte nicht veröffentlicht werden', { error, matchId: match.id });
    await deleteVoiceChannel(match.id, context, 'Spielersuche konnte nicht veröffentlicht werden').catch(
      () => undefined,
    );
    await prisma.spielersucheMatch.update({
      where: { id: match.id },
      data: { status: 'CLOSED', closedAt: new Date(), activeCreatorKey: null, closeReason: 'PUBLISH_FAILED' },
    });
    await completeIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey, 'FAILED', match.id);
    throw new AppError('DISCORD_UNAVAILABLE', {
      userMessage: 'D Suechi het nöd chöne poste werde. Darf de Bot im Spielersuche-Channel schriibe?',
    });
  }

  if (ping.shouldPing) {
    await recordRolePing(game.id, game.roleId);
  }

  await Promise.all([
    completeIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey, 'COMPLETED', match.id),
    recordUsage(actor.discordId, source),
    safeRecordAudit({
      action: AUDIT_ACTIONS.SPIELERSUCHE_CREATED,
      module: SPIELERSUCHE_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      success: true,
      metadata: {
        matchId: match.id,
        game: game.name,
        requestedPlayers: input.requestedPlayers,
        source,
        rolePinged: ping.shouldPing,
        voiceChannelId: match.voiceChannelId,
      },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    }),
  ]);

  log.info('Spielersuche erstellt', { matchId: match.id, game: game.name, source });
  return {
    match,
    warnings,
    rolePinged: ping.shouldPing,
    pingCooldownSeconds: ping.remainingSeconds,
    duplicate: false,
  };
}

/**
 * Legt die Suche an und belegt dabei einen Platz des Erstellers.
 *
 * Das Limit steckt im Unique-Index auf `activeCreatorKey`: pro Person gibt es
 * die Schlüssel `<id>#0` bis `<id>#(n-1)`. Zwei gleichzeitige Anfragen können
 * dadurch nicht beide denselben Platz belegen - die zweite scheitert an der
 * Datenbank, nicht an einer Prüfung im Anwendungscode.
 */
async function claimSlotAndCreate(input: {
  actor: SpielersucheActor;
  game: { id: string; name: string; roleId: string; bannerUrl: string | null; maxSquadSize: number | null };
  input: CreateSearchInput;
  source: SpielersucheSource;
  now: Date;
  expiresAt: Date;
  maxActive: number;
}): Promise<SpielersucheMatch> {
  const { actor, game } = input;

  for (let slot = 0; slot < input.maxActive; slot += 1) {
    try {
      return await prisma.spielersucheMatch.create({
        data: {
          creatorDiscordId: actor.discordId,
          creatorUsername: actor.username,
          creatorDisplayName: actor.displayName ?? null,
          creatorAvatarHash: actor.avatarHash ?? null,
          gameId: game.id,
          gameName: game.name,
          pingRoleId: game.roleId,
          bannerUrl: game.bannerUrl,
          maxSquadSize: game.maxSquadSize,
          requestedPlayers: input.input.requestedPlayers,
          comment: input.input.comment,
          status: 'OPEN',
          source: input.source,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          activeCreatorKey: `${actor.discordId}#${slot}`,
          idempotencyKey: `${IDEMPOTENCY_SCOPE}:${input.input.idempotencyKey}`,
          participants: {
            create: {
              discordId: actor.discordId,
              username: actor.username,
              displayName: actor.displayName ?? null,
              avatarHash: actor.avatarHash ?? null,
              isCreator: true,
              joinedAt: input.now,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target ?? []) as string[] | string;
        const fields = Array.isArray(target) ? target.join(',') : String(target);
        // Der Platz ist belegt - der nächste wird probiert.
        if (fields.includes('activeCreatorKey')) {
          continue;
        }
        if (fields.includes('idempotencyKey')) {
          throw conflict('Die Suechi wird grad scho erstellt.');
        }
      }
      throw error;
    }
  }

  throw conflict(
    input.maxActive === 1
      ? 'Du hesch bereits e Suechi aktiv.'
      : `Du hesch bereits ${input.maxActive} Suechine aktiv.`,
  );
}

interface RolePingDecision {
  shouldPing: boolean;
  remainingSeconds: number;
}

/**
 * Entscheidet über den Rollen-Ping.
 *
 * Wichtig: eine laufende Sperrfrist verhindert nur die Erwähnung, nie die
 * Suche selbst - genau wie beim alten Bot.
 */
async function evaluateRolePing(gameId: string, context: SpielersucheContext): Promise<RolePingDecision> {
  if (!context.settings.rolePingEnabled) {
    return { shouldPing: false, remainingSeconds: 0 };
  }
  const cooldownSeconds = context.settings.rolePingCooldownMinutes * 60;
  if (cooldownSeconds <= 0) {
    return { shouldPing: true, remainingSeconds: 0 };
  }

  const last = await prisma.spielersucheRolePing.findUnique({ where: { gameId } });
  if (!last) {
    return { shouldPing: true, remainingSeconds: 0 };
  }

  const elapsed = (Date.now() - last.pingedAt.getTime()) / 1000;
  if (elapsed >= cooldownSeconds) {
    return { shouldPing: true, remainingSeconds: 0 };
  }
  return { shouldPing: false, remainingSeconds: Math.ceil(cooldownSeconds - elapsed) };
}

async function recordRolePing(gameId: string, roleId: string): Promise<void> {
  await prisma.spielersucheRolePing.upsert({
    where: { gameId },
    create: { gameId, roleId, pingedAt: new Date() },
    update: { roleId, pingedAt: new Date() },
  });
}

export type JoinOutcome =
  | { result: 'joined'; match: SpielersucheMatch; participants: number; complete: boolean }
  | { result: 'already-in' }
  | { result: 'full' }
  | { result: 'not-active' };

/**
 * Nimmt jemanden in die Gruppe auf.
 *
 * Die Platzprüfung läuft in einer Transaktion mit Zeilensperre auf der Suche.
 * Zwei gleichzeitige Klicks auf den letzten Platz können dadurch nicht beide
 * gewinnen - es gibt nie 6 von 5.
 */
export async function joinSearch(
  matchId: string,
  actor: SpielersucheActor,
  options: SpielersucheOptions = {},
): Promise<JoinOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"::text AS "status"
      FROM "SpielersucheMatch"
      WHERE "id" = ${matchId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row || (row.status !== 'OPEN' && row.status !== 'COMPLETE')) {
      return { result: 'not-active' as const };
    }

    const match = await tx.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } });
    const existing = await tx.spielersucheParticipant.findUnique({
      where: { matchId_discordId: { matchId, discordId: actor.discordId } },
    });
    if (existing && existing.leftAt === null) {
      return { result: 'already-in' as const };
    }

    const active = await tx.spielersucheParticipant.count({ where: { matchId, leftAt: null } });
    if (active >= totalSlots(match)) {
      return { result: 'full' as const };
    }

    // Wer schon einmal dabei war, bekommt seine Zeile zurück statt einer
    // zweiten - der Unique-Index bleibt dadurch unangetastet.
    if (existing) {
      await tx.spielersucheParticipant.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date(), username: actor.username },
      });
    } else {
      await tx.spielersucheParticipant.create({
        data: {
          matchId,
          discordId: actor.discordId,
          username: actor.username,
          displayName: actor.displayName ?? null,
          avatarHash: actor.avatarHash ?? null,
        },
      });
    }

    const total = active + 1;
    const complete = total >= totalSlots(match);
    const updated = await tx.spielersucheMatch.update({
      where: { id: matchId },
      data: { status: complete ? 'COMPLETE' : 'OPEN' },
    });

    return { result: 'joined' as const, match: updated, participants: total, complete };
  });

  if (outcome.result !== 'joined') {
    return outcome;
  }

  const context = options.context ?? (await loadSpielersucheContext(options.gateway));
  await grantVoiceAccess(outcome.match, actor.discordId, context);
  await syncMatchMessage(matchId, context);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_JOINED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { matchId, participants: outcome.participants, complete: outcome.complete },
  });

  return outcome;
}

export type LeaveOutcome =
  | { result: 'left'; match: SpielersucheMatch; reopened: boolean }
  | { result: 'creator' }
  | { result: 'not-in' }
  | { result: 'not-active' };

/**
 * Entfernt jemanden aus der Gruppe.
 *
 * Der Ersteller kann nicht austreten - er beendet die Suche stattdessen.
 * Wird dadurch wieder ein Platz frei, geht eine vollständige Gruppe zurück
 * auf "offen".
 */
export async function leaveSearch(
  matchId: string,
  actor: SpielersucheActor,
  options: SpielersucheOptions = {},
): Promise<LeaveOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"::text AS "status"
      FROM "SpielersucheMatch"
      WHERE "id" = ${matchId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row || (row.status !== 'OPEN' && row.status !== 'COMPLETE')) {
      return { result: 'not-active' as const };
    }

    const match = await tx.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } });
    if (match.creatorDiscordId === actor.discordId) {
      return { result: 'creator' as const };
    }

    const participant = await tx.spielersucheParticipant.findUnique({
      where: { matchId_discordId: { matchId, discordId: actor.discordId } },
    });
    if (!participant || participant.leftAt !== null) {
      return { result: 'not-in' as const };
    }

    await tx.spielersucheParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });

    const active = await tx.spielersucheParticipant.count({ where: { matchId, leftAt: null } });
    const reopened = match.status === 'COMPLETE' && active < totalSlots(match);
    const updated = await tx.spielersucheMatch.update({
      where: { id: matchId },
      data: { status: reopened ? 'OPEN' : match.status },
    });

    return { result: 'left' as const, match: updated, reopened };
  });

  if (outcome.result !== 'left') {
    return outcome;
  }

  const context = options.context ?? (await loadSpielersucheContext(options.gateway));
  await revokeVoiceAccess(outcome.match, actor.discordId, context);
  await syncMatchMessage(matchId, context);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_LEFT,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { matchId, reopened: outcome.reopened },
  });

  return outcome;
}

export interface CloseSearchOptions extends SpielersucheOptions {
  /** `null` = automatisch durch den Ablauf-Job. */
  actor?: SpielersucheActor | null;
  status?: 'CLOSED' | 'EXPIRED';
  reason?: string;
  /**
   * Sprachkanal in jedem Fall löschen. Standard ist zurückhaltend: sind noch
   * Leute drin, bleibt der Kanal bestehen und verschwindet, sobald er leer ist.
   */
  forceDeleteVoice?: boolean;
}

export interface CloseSearchResult {
  match: SpielersucheMatch;
  voiceDeleted: boolean;
}

/**
 * Beendet eine Suche.
 *
 * Die Beanspruchung läuft über `updateMany` mit Statusfilter: derselbe Vorgang
 * kann dadurch nicht gleichzeitig vom Ersteller, einem Moderator und dem
 * Ablauf-Job beendet werden.
 */
export async function closeSearch(
  matchId: string,
  options: CloseSearchOptions = {},
): Promise<CloseSearchResult> {
  const actor = options.actor ?? null;
  const status = options.status ?? 'CLOSED';

  const claimed = await prisma.spielersucheMatch.updateMany({
    where: { id: matchId, status: { in: ['OPEN', 'COMPLETE'] } },
    data: {
      status,
      closedAt: new Date(),
      closedByDiscordId: actor?.discordId ?? null,
      closeReason: options.reason ?? null,
      // Gibt den Platz des Erstellers wieder frei.
      activeCreatorKey: null,
    },
  });

  const match = await prisma.spielersucheMatch.findUnique({ where: { id: matchId } });
  if (!match) {
    throw new AppError('NOT_FOUND', { userMessage: 'Die Suechi isch nöd gfunde worde.' });
  }
  if (claimed.count === 0) {
    throw conflict('Die Suechi isch bereits beendet.');
  }

  const context = options.context ?? (await loadSpielersucheContext(options.gateway));
  await syncMatchMessage(matchId, context);

  // Sprachkanal nur räumen, wenn niemand mehr drin ist. Der Bot erkennt den
  // leeren Kanal ohnehin über das Voice-Ereignis und löscht ihn dann.
  let voiceDeleted = false;
  if (match.voiceChannelId && context.settings.voiceAutoCleanup) {
    voiceDeleted = options.forceDeleteVoice
      ? await deleteVoiceChannel(matchId, context, 'Spielersuche beendet')
      : false;
  }

  await safeRecordAudit({
    action: status === 'EXPIRED' ? AUDIT_ACTIONS.SPIELERSUCHE_EXPIRED : AUDIT_ACTIONS.SPIELERSUCHE_CLOSED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor?.discordId ?? null,
    actorUsername: actor?.username ?? 'system',
    success: true,
    metadata: { matchId, status, game: match.gameName, reason: options.reason ?? null },
    ipHash: options.metadata?.ipHash,
    userAgent: options.metadata?.userAgent,
  });

  log.info('Spielersuche beendet', { matchId, status });
  return {
    match: await prisma.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } }),
    voiceDeleted,
  };
}

/**
 * Beendet abgelaufene Suchen.
 *
 * Die Datenbank ist Source of Truth - es wird nicht auf Timer im Speicher
 * vertraut. Ein Neustart verliert dadurch keine Ablaufzeit.
 */
export async function expireSearches(
  limit = 25,
  gateway: DiscordGateway = defaultDiscord,
): Promise<{ expired: number }> {
  const due = await prisma.spielersucheMatch.findMany({
    where: { status: { in: ['OPEN', 'COMPLETE'] }, expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  if (due.length === 0) {
    return { expired: 0 };
  }

  const context = await loadSpielersucheContext(gateway);
  let expired = 0;
  for (const entry of due) {
    try {
      await closeSearch(entry.id, { status: 'EXPIRED', context, gateway });
      expired += 1;
    } catch (error) {
      log.warn('Abgelaufene Suche konnte nicht beendet werden', { error, matchId: entry.id });
    }
  }

  log.info('Abgelaufene Spielersuchen beendet', { expired });
  return { expired };
}

/**
 * Schreibt die Discord-Nachricht neu.
 *
 * Best effort: eine gelöschte Nachricht darf keine Aktion scheitern lassen -
 * massgeblich ist die Datenbank.
 */
export async function syncMatchMessage(matchId: string, context: SpielersucheContext): Promise<boolean> {
  const match = await prisma.spielersucheMatch.findUnique({ where: { id: matchId } });
  if (!match?.channelId || !match.messageId) {
    return false;
  }

  const participants = await activeParticipants(matchId);
  const guild = await context.gateway.guild.get().catch(() => null);

  try {
    await context.gateway.channels.edit(
      match.channelId,
      match.messageId,
      buildMatchMessage({
        match,
        participants,
        accentColor: context.accentColor,
        footerText: context.settings.footerText,
        guildId: guild?.id ?? null,
      }),
    );
    return true;
  } catch (error) {
    log.warn('Spielersuche-Nachricht konnte nicht aktualisiert werden', { error, matchId });
    return false;
  }
}

/** Eine Suche anhand ihrer Discord-Nachricht finden (für Button-Klicks). */
export async function getSearchByMessage(messageId: string): Promise<SpielersucheMatch | null> {
  return prisma.spielersucheMatch.findUnique({ where: { messageId } });
}

export async function getSearch(matchId: string): Promise<SpielersucheMatch | null> {
  return prisma.spielersucheMatch.findUnique({ where: { id: matchId } });
}

/** Offene Suchen einer Person - Grundlage für die Limitmeldung. */
export async function getActiveSearchesForCreator(discordId: string): Promise<SpielersucheMatch[]> {
  return prisma.spielersucheMatch.findMany({
    where: { creatorDiscordId: discordId, status: { in: ['OPEN', 'COMPLETE'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getActiveSearches(limit = 50): Promise<SpielersucheMatch[]> {
  return prisma.spielersucheMatch.findMany({
    where: { status: { in: ['OPEN', 'COMPLETE'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

export { activeParticipants };
