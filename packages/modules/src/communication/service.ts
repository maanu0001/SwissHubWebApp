import {
  AUDIT_ACTIONS,
  claimIdempotencyKey,
  completeIdempotencyKey,
  prisma,
  releaseIdempotencyKey,
  safeRecordAudit,
} from '@swisshub/database';
import {
  discord as defaultDiscord,
  messageLink,
  missingPermissions,
  tryResolveGuildId,
  type DiscordGateway,
  type DiscordPermissionName,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import type {
  CommunicationMentionType,
  CommunicationMessage,
  CommunicationSource,
  CommunicationType,
  Prisma,
} from '@swisshub/database';
import { COMMUNICATION_MODULE_ID, COMMUNICATION_PERMISSIONS, type CommunicationSettings } from './config';
import { getModuleSettings } from '../module-state';
import { listCachedChannels } from '../discord/sync';
import {
  POLL_REACTIONS,
  buildEventPayload,
  buildNewsPayload,
  buildPollPayload,
  type CommunicationPayloadBase,
  type RegistrationInfo,
  type ResolvedMention,
} from './embeds';
import type { SendEventInput, SendNewsInput, SendPollInput } from './schemas';

const log = createLogger('communication');

const IDEMPOTENCY_SCOPE = 'communication.send';

/**
 * Wie lange auf Discord gewartet wird, bevor abgebrochen wird.
 *
 * Die Discord-Anbindung wiederholt bei Fehlern und wartet bei Ratenbegrenzung -
 * im schlechtesten Fall über eine Minute. So lange darf die Oberfläche nicht
 * blockieren. Nach dieser Frist wird abgebrochen und eine verständliche
 * Meldung ausgegeben.
 */
const SEND_TIMEOUT_MS = 15_000;

/** Meldet sich nach `ms` mit einem Abbruch, statt unbegrenzt zu warten. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Discord hat innerhalb der Frist nicht geantwortet. */
class TimeoutError extends Error {
  constructor(label: string) {
    super(`${label} hat nicht innerhalb von ${SEND_TIMEOUT_MS} ms geantwortet`);
    this.name = 'TimeoutError';
  }
}

/** Rechte, die der Bot im Zielchannel je Nachrichtenart braucht. */
const REQUIRED_PERMISSIONS: Record<CommunicationType, DiscordPermissionName[]> = {
  NEWS: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS'],
  EVENT: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS'],
  POLL: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'ADD_REACTIONS', 'READ_MESSAGE_HISTORY'],
};

export interface CommunicationActor {
  discordId: string;
  username: string;
  avatarHash?: string | null;
  /** Effektive Berechtigungen - entscheidet über Erwähnungen. */
  permissionKeys: readonly string[];
  isOwner: boolean;
}

export interface SendOptions {
  gateway?: DiscordGateway;
  metadata?: { ipHash?: string | null; userAgent?: string | null };
  /** Woher der Versand kommt - WebApp oder Slash Command. */
  source?: CommunicationSource;
  /** Verbindet Browser-Anfrage, Server Action, Discord-Aufruf und Audit-Eintrag. */
  correlationId?: string | null;
  /** Nur für Tests: kürzere Frist, um einen Timeout nachzustellen. */
  timeoutMs?: number;
}

export interface SendResult {
  message: CommunicationMessage;
  /** Nicht blockierende Hinweise (z.B. Reaktionen nicht setzbar). */
  warnings: string[];
  duplicate: boolean;
  discordUrl: string | null;
}

/**
 * Channels, in die der Bot tatsächlich senden darf.
 *
 * Grundlage ist der Sync-Cache; die Berechtigungen werden live bei Discord
 * geprüft. Fällt Discord aus, wird der Channel angeboten (statt die Seite
 * unbenutzbar zu machen) - das Senden prüft ohnehin erneut.
 */
export interface SendableChannel {
  id: string;
  name: string;
  parentName: string | null;
  /** Fehlende Rechte; leer = alles vorhanden. */
  missing: DiscordPermissionName[];
}

export async function listSendableChannels(
  type: CommunicationType = 'NEWS',
  gateway: DiscordGateway = defaultDiscord,
): Promise<SendableChannel[]> {
  const channels = await listCachedChannels({ kinds: ['text'] }).catch(() => []);
  const required = REQUIRED_PERMISSIONS[type];

  // Eine Sammelabfrage statt einer je Channel.
  //
  // Vorher wurde für jeden Textkanal einzeln bei Discord nachgefragt. Auf
  // einem Server mit vielen Kanälen sind das ebenso viele Anfragen, bevor die
  // Seite überhaupt erscheint - unter Discords Ratenbegrenzung dauert das
  // zehn Sekunden bis Minuten. In der Seitenleiste sah es dann so aus, als
  // liesse sich "Kommunikation" nicht anklicken.
  //
  // Ist Discord nicht erreichbar, ist die Übersicht leer: die Kanäle
  // erscheinen dann ohne Angaben zu den Berechtigungen, statt dass die Seite
  // gar nicht lädt.
  const permissions = await gateway.channels.botPermissionsForAll().catch(() => new Map<string, bigint>());

  return channels.map((channel) => {
    const bits = permissions.get(channel.id);
    return {
      id: channel.id,
      name: channel.name,
      parentName: channel.parentName,
      missing: bits === undefined ? [] : missingPermissions(bits, required),
    };
  });
}

/** Wirft, wenn der Bot im Zielchannel nicht senden darf. */
async function assertChannelUsable(
  channelId: string,
  type: CommunicationType,
  gateway: DiscordGateway,
): Promise<{ name: string; warnings: string[] }> {
  const channels = await listCachedChannels({ kinds: ['text'], includeDeleted: true });
  const channel = channels.find((entry) => entry.id === channelId);
  if (!channel || channel.deleted) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieser Channel existiert nicht (mehr) oder ist kein Textkanal.',
    });
  }

  const permissions = await gateway.channels.botPermissions(channelId).catch(() => null);
  if (permissions === null) {
    // Discord nicht erreichbar: Senden versuchen, Fehler wird dort behandelt.
    return { name: channel.name, warnings: [] };
  }

  // Reaktionen sind kein Grund, die Nachricht zu blockieren - sie werden
  // separat als Warnung gemeldet.
  const blocking = missingPermissions(
    permissions,
    REQUIRED_PERMISSIONS[type].filter(
      (permission) => permission !== 'ADD_REACTIONS' && permission !== 'READ_MESSAGE_HISTORY',
    ),
  );
  if (blocking.length > 0) {
    throw new AppError('DISCORD_MISSING_PERMISSIONS', {
      userMessage: `Der Bot darf in #${channel.name} nicht senden. Fehlend: ${blocking.join(', ')}.`,
    });
  }

  const warnings: string[] = [];
  if (type === 'POLL' && missingPermissions(permissions, ['ADD_REACTIONS']).length > 0) {
    warnings.push(
      `Der Bot darf in #${channel.name} keine Reaktionen setzen - die Umfrage wird ohne 👍/👎 gesendet.`,
    );
  }
  return { name: channel.name, warnings };
}

/**
 * Erwähnung auflösen.
 *
 * Ein Ping entsteht nur, wenn die Berechtigung vorliegt UND die Einstellung
 * ihn zulässt. Ohne beides wird still auf "keine Erwähnung" zurückgefallen -
 * die Nachricht geht raus, sie pingt nur niemanden.
 */
export interface MentionRequest {
  type: 'none' | 'everyone' | 'here' | 'role' | 'user';
  /** Rollen- oder Benutzer-ID, je nach `type`. */
  target?: string | null;
}

export function resolveMention(
  requested: MentionRequest,
  actor: CommunicationActor,
  settings: CommunicationSettings,
  warnings: string[],
): ResolvedMention | null {
  if (requested.type === 'none') {
    return null;
  }

  const has = (permission: string): boolean =>
    actor.isOwner || actor.permissionKeys.includes(permission) || actor.permissionKeys.includes('admin.full');

  if (!has(COMMUNICATION_PERMISSIONS.mention)) {
    warnings.push('Erwähnungen wurden entfernt - dafür fehlt dir die Berechtigung.');
    return null;
  }

  if (requested.type === 'role') {
    return requested.target ? { kind: 'role', roleId: requested.target } : null;
  }
  if (requested.type === 'user') {
    return requested.target ? { kind: 'user', userId: requested.target } : null;
  }

  // @everyone und @here brauchen eine eigene Berechtigung: eine Rolle
  // betrifft eine Gruppe, der ganze Server betrifft alle.
  if (!has(COMMUNICATION_PERMISSIONS.mentionEveryone)) {
    warnings.push('@everyone/@here wurde entfernt - dafür fehlt dir die Berechtigung.');
    return null;
  }
  if (!settings.allowEveryoneMention) {
    warnings.push('@everyone/@here ist in den Moduleinstellungen deaktiviert - es wurde niemand gepingt.');
    return null;
  }
  return { kind: requested.type };
}

/**
 * Die Felder eines Verlaufseintrags.
 *
 * An einer Stelle gebaut, damit ein gescheiterter und ein erfolgreicher
 * Versand dieselben Angaben festhalten - sonst fehlten ausgerechnet dort
 * Angaben, wo man sie am dringendsten braucht.
 */
function historyFields(
  type: CommunicationType,
  input: SendNewsInput | SendEventInput | SendPollInput,
  actor: CommunicationActor,
  channelName: string,
  mention: ResolvedMention | null,
): Omit<Prisma.CommunicationMessageUncheckedCreateInput, 'status' | 'source'> {
  const event = type === 'EVENT' ? (input as SendEventInput) : null;

  return {
    type,
    title: input.title,
    content: input.content,
    bannerUrl: input.bannerUrl ?? null,
    discordChannelId: input.channelId,
    discordChannelName: channelName,
    sentByDiscordId: actor.discordId,
    sentByUsername: actor.username,
    sentByAvatarHash: actor.avatarHash ?? null,
    mentionType: mentionTypeOf(mention),
    mentionTarget:
      mention?.kind === 'role' ? mention.roleId : mention?.kind === 'user' ? mention.userId : null,
    eventLocation: event?.location ?? null,
    eventStartsAt: event?.startsAt ?? null,
    eventDateText: event?.startsAtText ?? null,
    eventResponsibleId: event?.responsibleDiscordId ?? null,
    registrationType: event?.registrationType ?? 'NONE',
    registrationValue: event?.registrationValue ?? null,
  };
}

const mentionTypeOf = (mention: ResolvedMention | null): CommunicationMentionType => {
  if (!mention) {
    return 'NONE';
  }
  switch (mention.kind) {
    case 'everyone':
      return 'EVERYONE';
    case 'here':
      return 'HERE';
    case 'role':
      return 'ROLE';
    case 'user':
      return 'USER';
  }
};

/** Das Standardbanner der jeweiligen Nachrichtenart, sofern hinterlegt. */
function defaultBannerFor(type: CommunicationType, settings: CommunicationSettings): string | null {
  const configured =
    type === 'EVENT'
      ? settings.defaultEventBannerUrl
      : type === 'POLL'
        ? settings.defaultPollBannerUrl
        : settings.defaultNewsBannerUrl;
  return configured && configured.length > 0 ? configured : null;
}

/**
 * Die Anmeldeangabe eines Events.
 *
 * Beim Vorgänger stand hier freier Text, und das Wort `ticket` zeigte auf eine
 * fest im Code eingetragene Channel-ID. Der Channel kommt jetzt aus den
 * Einstellungen; ist dort keiner hinterlegt, wird die Angabe weggelassen und
 * gemeldet, statt auf einen Channel zu verweisen, den es nicht gibt.
 */
function resolveRegistration(
  input: SendEventInput,
  settings: CommunicationSettings,
  warnings: string[],
): RegistrationInfo {
  switch (input.registrationType) {
    case 'TICKET': {
      if (!settings.ticketChannelId) {
        warnings.push('Es ist kein Ticket-Channel konfiguriert - die Anmeldeangabe wurde weggelassen.');
        return { kind: 'none' };
      }
      return { kind: 'channel', channelId: settings.ticketChannelId };
    }
    case 'CHANNEL':
      return input.registrationValue
        ? { kind: 'channel', channelId: input.registrationValue }
        : { kind: 'none' };
    case 'URL':
      return input.registrationValue ? { kind: 'url', value: input.registrationValue } : { kind: 'none' };
    case 'TEXT':
      return input.registrationValue ? { kind: 'text', value: input.registrationValue } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

async function send(
  type: CommunicationType,
  input: SendNewsInput | SendEventInput | SendPollInput,
  actor: CommunicationActor,
  options: SendOptions,
): Promise<SendResult> {
  const gateway = options.gateway ?? defaultDiscord;
  const settings = await getModuleSettings<CommunicationSettings>(COMMUNICATION_MODULE_ID);
  const warnings: string[] = [];

  const channel = await assertChannelUsable(input.channelId, type, gateway);
  warnings.push(...channel.warnings);

  // Idempotenz: Doppelklick oder Retry darf nicht zweimal posten.
  const claim = await claimIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey, actor.discordId);
  if (claim.status === 'duplicate') {
    const existing = claim.existing?.resultRef
      ? await prisma.communicationMessage.findUnique({ where: { id: claim.existing.resultRef } })
      : null;
    if (existing) {
      return {
        message: existing,
        warnings: [],
        duplicate: true,
        discordUrl: await buildLink(existing),
      };
    }
    throw new AppError('CONFLICT', {
      userMessage: 'Diese Nachricht wird bereits gesendet. Bitte einen Moment warten.',
    });
  }

  const mention = resolveMention(
    { type: input.mention, target: input.mentionTarget ?? input.mentionRoleId ?? null },
    actor,
    settings,
    warnings,
  );
  const base: CommunicationPayloadBase = {
    title: input.title,
    content: input.content,
    // Ohne eigenes Banner greift das in den Einstellungen hinterlegte. Der
    // alte Bot hatte hier einen festen Imgur-Link im Code.
    bannerUrl: input.bannerUrl ?? defaultBannerFor(type, settings),
    footerText: settings.footerText,
    mention,
  };

  const payload =
    type === 'NEWS'
      ? buildNewsPayload(base)
      : type === 'POLL'
        ? buildPollPayload(base)
        : buildEventPayload({
            ...base,
            startsAt: (input as SendEventInput).startsAt ?? null,
            startsAtText: (input as SendEventInput).startsAtText ?? null,
            location: (input as SendEventInput).location,
            responsibleDiscordId: (input as SendEventInput).responsibleDiscordId ?? null,
            registration: resolveRegistration(input as SendEventInput, settings, warnings),
          });

  const startedAt = Date.now();
  let messageId: string;
  try {
    const sent = await withTimeout(
      gateway.channels.send(input.channelId, payload),
      options.timeoutMs ?? SEND_TIMEOUT_MS,
      'Discord',
    );
    messageId = sent.id;
  } catch (error) {
    const timedOut = error instanceof TimeoutError;

    // Nach einem Timeout wissen wir nicht, ob Discord die Nachricht doch
    // bekommen hat. Der Idempotenz-Schlüssel bleibt deshalb belegt: ein
    // erneuter Versuch mit demselben Schlüssel sendet nicht ein zweites Mal.
    // Bei einer klaren Absage von Discord wird er freigegeben, damit ein
    // korrigierter Versuch durchgeht.
    if (!timedOut) {
      await releaseIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey);
    }

    const failureCode = timedOut ? 'TIMEOUT' : error instanceof Error ? error.name.slice(0, 60) : 'UNKNOWN';
    const failureMessage = error instanceof Error ? error.message.slice(0, 300) : 'Unbekannter Fehler';

    // Ein Eintrag im Verlauf, damit ein gescheiterter Versand nachvollziehbar
    // bleibt und sich bewusst wiederholen lässt.
    const failed = await prisma.communicationMessage
      .create({
        data: {
          ...historyFields(type, input, actor, channel.name, mention),
          status: 'FAILED',
          source: options.source ?? 'WEBAPP',
          discordMessageId: null,
          failureCode,
          failureMessage,
          correlationId: options.correlationId ?? null,
          // Ohne Schlüssel: der Eintrag soll einen späteren, echten Versand
          // mit demselben Schlüssel nicht blockieren.
          idempotencyKey: null,
        },
      })
      .catch(() => null);

    await safeRecordAudit({
      action: AUDIT_ACTIONS.COMMUNICATION_SEND_FAILED,
      module: COMMUNICATION_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      success: false,
      errorCode: failureCode,
      errorMessage: failureMessage,
      metadata: {
        type,
        channelId: input.channelId,
        title: input.title,
        durationMs: Date.now() - startedAt,
        correlationId: options.correlationId ?? null,
        messageId: failed?.id ?? null,
      },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    });

    log.error('Kommunikationsnachricht konnte nicht gesendet werden', {
      type,
      channelId: input.channelId,
      actorId: actor.discordId,
      durationMs: Date.now() - startedAt,
      failureCode,
      correlationId: options.correlationId ?? null,
    });

    if (timedOut) {
      throw new AppError('DISCORD_UNAVAILABLE', {
        userMessage:
          'Die Nachricht konnte nicht gesendet werden. Discord antwortet derzeit nicht. Bitte prüfe den Channel, bevor du es erneut versuchst.',
      });
    }
    throw new AppError('DISCORD_UNAVAILABLE', {
      userMessage: 'Die Nachricht konnte nicht gesendet werden. Bitte später erneut versuchen.',
    });
  }

  // Umfragen bekommen ihre Reaktionen. Schlägt das fehl, bleibt die Nachricht
  // bestehen - gemeldet wird es trotzdem.
  if (type === 'POLL' && settings.autoPollReactions) {
    for (const emoji of POLL_REACTIONS) {
      try {
        await gateway.channels.react(input.channelId, messageId, emoji);
      } catch (error) {
        log.warn('Reaktion konnte nicht gesetzt werden', { error, emoji });
        warnings.push(`Die Reaktion ${emoji} konnte nicht gesetzt werden.`);
      }
    }
  }

  const record = await prisma.communicationMessage.create({
    data: {
      ...historyFields(type, input, actor, channel.name, mention),
      status: 'SENT',
      source: options.source ?? 'WEBAPP',
      discordMessageId: messageId,
      correlationId: options.correlationId ?? null,
      idempotencyKey: `${IDEMPOTENCY_SCOPE}:${input.idempotencyKey}`,
    },
  });

  log.info('Kommunikationsnachricht gesendet', {
    messageType: type,
    channelId: input.channelId,
    actorId: actor.discordId,
    source: options.source ?? 'WEBAPP',
    durationMs: Date.now() - startedAt,
    correlationId: options.correlationId ?? null,
    warnings: warnings.length,
  });

  // Auffällig lange Versände festhalten, damit sich künftige Hänger
  // eingrenzen lassen, statt nur berichtet zu werden.
  if (Date.now() - startedAt > 5000) {
    log.warn('Versand hat ungewöhnlich lange gedauert', {
      messageType: type,
      channelId: input.channelId,
      durationMs: Date.now() - startedAt,
      correlationId: options.correlationId ?? null,
    });
  }

  await Promise.all([
    completeIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey, 'COMPLETED', record.id),
    safeRecordAudit({
      action:
        type === 'NEWS'
          ? AUDIT_ACTIONS.COMMUNICATION_NEWS_SENT
          : type === 'EVENT'
            ? AUDIT_ACTIONS.COMMUNICATION_EVENT_SENT
            : AUDIT_ACTIONS.COMMUNICATION_POLL_SENT,
      module: COMMUNICATION_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      targetLabel: `#${channel.name}`,
      success: true,
      metadata: {
        messageId: record.id,
        discordMessageId: messageId,
        channelId: input.channelId,
        title: input.title,
        mention: record.metadata,
      },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    }),
  ]);

  log.info('Kommunikationsnachricht gesendet', { type, channelId: input.channelId, by: actor.discordId });
  return { message: record, warnings, duplicate: false, discordUrl: await buildLink(record) };
}

export const sendNews = (input: SendNewsInput, actor: CommunicationActor, options: SendOptions = {}) =>
  send('NEWS', input, actor, options);

export const sendEvent = (input: SendEventInput, actor: CommunicationActor, options: SendOptions = {}) =>
  send('EVENT', input, actor, options);

export const sendPoll = (input: SendPollInput, actor: CommunicationActor, options: SendOptions = {}) =>
  send('POLL', input, actor, options);

/**
 * Löscht eine Nachricht auf Discord.
 *
 * Der Verlaufseintrag bleibt erhalten und wird als gelöscht markiert - sonst
 * verschwände die Aktion aus der Nachvollziehbarkeit.
 */
export async function deleteCommunicationMessage(
  id: string,
  actor: CommunicationActor,
  options: SendOptions = {},
): Promise<CommunicationMessage> {
  const gateway = options.gateway ?? defaultDiscord;
  const record = await prisma.communicationMessage.findUnique({ where: { id } });
  if (!record) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Nachricht existiert nicht.' });
  }
  if (record.deletedAt) {
    return record;
  }

  if (record.discordMessageId) {
    try {
      await gateway.channels.delete(
        record.discordChannelId,
        record.discordMessageId,
        `Gelöscht durch ${actor.username}`,
      );
    } catch (error) {
      log.warn('Discord-Nachricht konnte nicht gelöscht werden', { error, id });
      throw new AppError('DISCORD_UNAVAILABLE', {
        userMessage:
          'Die Nachricht konnte auf Discord nicht gelöscht werden. Wurde sie dort bereits entfernt?',
      });
    }
  }

  const updated = await prisma.communicationMessage.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByDiscordId: actor.discordId },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.COMMUNICATION_MESSAGE_DELETED,
    module: COMMUNICATION_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: record.discordChannelName ? `#${record.discordChannelName}` : null,
    success: true,
    metadata: { messageId: id, title: record.title, type: record.type },
    ipHash: options.metadata?.ipHash,
    userAgent: options.metadata?.userAgent,
  });

  return updated;
}

/** Discord-Link einer gesendeten Nachricht - serverseitig gebaut. */
export async function buildLink(record: CommunicationMessage): Promise<string | null> {
  if (!record.discordMessageId || record.deletedAt) {
    return null;
  }
  const guildId = await tryResolveGuildId();
  return guildId ? messageLink(guildId, record.discordChannelId, record.discordMessageId) : null;
}
