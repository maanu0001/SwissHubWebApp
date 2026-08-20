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
import type { CommunicationMessage, CommunicationType } from '@swisshub/database';
import { COMMUNICATION_MODULE_ID, type CommunicationSettings } from './config';
import { getModuleSettings } from '../module-state';
import { listCachedChannels } from '../discord/sync';
import {
  POLL_REACTIONS,
  buildEventPayload,
  buildNewsPayload,
  buildPollPayload,
  type CommunicationPayloadBase,
} from './embeds';
import type { SendEventInput, SendNewsInput, SendPollInput } from './schemas';

const log = createLogger('communication');

const IDEMPOTENCY_SCOPE = 'communication.send';

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

  return Promise.all(
    channels.map(async (channel) => {
      const permissions = await gateway.channels.botPermissions(channel.id).catch(() => null);
      return {
        id: channel.id,
        name: channel.name,
        parentName: channel.parentName,
        missing: permissions === null ? [] : missingPermissions(permissions, required),
      };
    }),
  );
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
function resolveMention(
  requested: 'none' | 'everyone' | 'here' | 'role',
  roleId: string | undefined,
  actor: CommunicationActor,
  settings: CommunicationSettings,
  warnings: string[],
): CommunicationPayloadBase['mention'] {
  if (requested === 'none') {
    return null;
  }

  const mayMention =
    actor.isOwner ||
    actor.permissionKeys.includes('communication.mention') ||
    actor.permissionKeys.includes('admin.full');
  if (!mayMention) {
    warnings.push('Erwähnungen wurden entfernt - dafür fehlt dir die Berechtigung.');
    return null;
  }

  if (requested === 'role') {
    return roleId ? { kind: 'role', roleId } : null;
  }

  if (!settings.allowEveryoneMention) {
    warnings.push('@everyone/@here ist in den Moduleinstellungen deaktiviert - es wurde niemand gepingt.');
    return null;
  }
  return { kind: requested };
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

  const mention = resolveMention(input.mention, input.mentionRoleId, actor, settings, warnings);
  const base: CommunicationPayloadBase = {
    title: input.title,
    content: input.content,
    bannerUrl: input.bannerUrl ?? null,
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
            startsAt: (input as SendEventInput).startsAt,
            responsibleDiscordId: (input as SendEventInput).responsibleDiscordId ?? null,
          });

  let messageId: string;
  try {
    const sent = await gateway.channels.send(input.channelId, payload);
    messageId = sent.id;
  } catch (error) {
    await releaseIdempotencyKey(IDEMPOTENCY_SCOPE, input.idempotencyKey);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.COMMUNICATION_SEND_FAILED,
      module: COMMUNICATION_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      success: false,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : 'Unbekannter Fehler',
      metadata: { type, channelId: input.channelId, title: input.title },
      ipHash: options.metadata?.ipHash,
      userAgent: options.metadata?.userAgent,
    });
    log.error('Kommunikationsnachricht konnte nicht gesendet werden', { error, type });
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
      type,
      title: input.title,
      content: input.content,
      bannerUrl: input.bannerUrl ?? null,
      discordChannelId: input.channelId,
      discordChannelName: channel.name,
      discordMessageId: messageId,
      sentByDiscordId: actor.discordId,
      sentByUsername: actor.username,
      sentByAvatarHash: actor.avatarHash ?? null,
      idempotencyKey: `${IDEMPOTENCY_SCOPE}:${input.idempotencyKey}`,
      metadata: {
        mention: mention ? (mention.kind === 'role' ? `role:${mention.roleId}` : mention.kind) : 'none',
        ...(type === 'EVENT'
          ? {
              startsAt: (input as SendEventInput).startsAt.toISOString(),
              responsibleDiscordId: (input as SendEventInput).responsibleDiscordId ?? null,
            }
          : {}),
      },
    },
  });

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
