import { prisma } from '@swisshub/database';
import type { VerificationRequest } from '@swisshub/database';
import {
  BUTTON_STYLE,
  discord as defaultDiscord,
  type DiscordEmbed,
  type DiscordGateway,
  type DiscordMessagePayload,
  type SentMessage,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { VERIFICATION_ACCENT_COLOR, type VerificationSettings } from './config';
import { statusLabel } from './service';

const logger = createLogger('verification:discord');

/**
 * Die Verifikation auf Discord.
 *
 * Die Meldung an die Moderation wird einmal gesendet und danach
 * fortgeschrieben - ihre Kennung steht am Vorgang. Wer den Kanal liest, soll
 * nicht drei Fassungen desselben Falls sehen, und wer die Entscheidung
 * verpasst hat, soll sie am urspruenglichen Beitrag erkennen.
 */

/** Kennungen der Knoepfe. Der Vorgang steckt darin - geprueft wird trotzdem. */
export const VERIFY_BUTTON = 'verification:approve';
export const REJECT_BUTTON = 'verification:reject';

export function buildButtonId(art: 'approve' | 'reject', requestId: string): string {
  return `${art === 'approve' ? VERIFY_BUTTON : REJECT_BUTTON}:${requestId}`;
}

/**
 * Die Vorgangskennung aus einer Knopf-ID lesen.
 *
 * Sie ist ein Hinweis, keine Vollmacht: was daraus folgt, entscheidet
 * ausschliesslich die serverseitige Pruefung im Bot.
 */
export function parseButtonId(
  customId: string,
): { art: 'approve' | 'reject'; requestId: string } | null {
  for (const [praefix, art] of [
    [`${VERIFY_BUTTON}:`, 'approve'],
    [`${REJECT_BUTTON}:`, 'reject'],
  ] as const) {
    if (customId.startsWith(praefix)) {
      const requestId = customId.slice(praefix.length);
      return requestId.length > 0 ? { art, requestId } : null;
    }
  }
  return null;
}

function alter(von: Date | null, bis: Date): string {
  if (!von) {
    return 'unbekannt';
  }
  const tage = Math.floor((bis.getTime() - von.getTime()) / 86_400_000);
  if (tage >= 365) {
    const jahre = Math.floor(tage / 365);
    return `${jahre} Jahr${jahre === 1 ? '' : 'e'}`;
  }
  if (tage >= 1) {
    return `${tage} Tag${tage === 1 ? '' : 'e'}`;
  }
  const stunden = Math.max(1, Math.floor((bis.getTime() - von.getTime()) / 3_600_000));
  return `${stunden} Stunde${stunden === 1 ? '' : 'n'}`;
}

function seit(wert: Date, jetzt: Date): string {
  const sekunden = Math.max(0, Math.floor((jetzt.getTime() - wert.getTime()) / 1000));
  if (sekunden < 60) {
    return `vor ${sekunden} Sekunden`;
  }
  const minuten = Math.floor(sekunden / 60);
  if (minuten < 60) {
    return `vor ${minuten} Minute${minuten === 1 ? '' : 'n'}`;
  }
  const stunden = Math.floor(minuten / 60);
  return stunden < 24 ? `vor ${stunden} Stunde${stunden === 1 ? '' : 'n'}` : `vor ${Math.floor(stunden / 24)} Tagen`;
}

export function buildModEmbed(request: VerificationRequest, jetzt = new Date()): DiscordEmbed {
  const entschieden = request.decidedAt !== null;
  const kopf = entschieden
    ? request.status === 'VERIFIED'
      ? request.decidedBy === 'AI'
        ? '🤖 AUTOMATISCH VERIFIZIERT'
        : '✅ VERIFIZIERT'
      : request.status === 'REJECTED'
        ? '❌ ABGELEHNT'
        : request.status === 'LEFT_SERVER'
          ? '↩️ SERVER VERLASSEN'
          : request.status === 'EXPIRED'
            ? '⌛ ABGELAUFEN'
            : 'ABGESCHLOSSEN'
    : 'NEUE VERIFIKATION';

  const felder = [
    {
      name: 'Discord-Konto',
      value: alter(request.accountCreatedAt, request.joinedAt),
      inline: true,
    },
    { name: 'Beigetreten', value: seit(request.joinedAt, jetzt), inline: true },
    { name: 'Status', value: statusLabel(request.status), inline: true },
  ];

  if (request.latestMessage) {
    felder.push({
      name: request.messageCount > 1 ? `Nachricht (${request.messageCount} gesamt)` : 'Nachricht',
      // In ein Zitat gesetzt: der Text stammt von aussen und soll sich im
      // Embed nicht als Ueberschrift oder Erwaehnung ausgeben koennen.
      value: `>>> ${request.latestMessage.slice(0, 900)}`,
      inline: false,
    });
  }

  if (request.aiVerdict) {
    const wert =
      request.aiVerdict === 'FAILED'
        ? `Prüfung fehlgeschlagen — manuelle Prüfung erforderlich${request.aiError ? ` (${request.aiError.slice(0, 120)})` : ''}`
        : `${request.aiVerdict}${
            request.aiConfidence !== null ? ` · ${Math.round(request.aiConfidence * 100)} %` : ''
          }${request.aiReasonCode ? ` · ${request.aiReasonCode}` : ''}`;
    felder.push({ name: 'AI-Einordnung', value: wert, inline: false });
  }

  // Hinweise, keine Urteile. Sie stehen hier, damit ein Mensch sie
  // einbezieht - eine Sanktion loesen sie nie aus.
  const hinweise: string[] = [];
  if (
    request.accountCreatedAt &&
    request.joinedAt.getTime() - request.accountCreatedAt.getTime() < 24 * 3600_000
  ) {
    hinweise.push('Konto jünger als 24 Stunden');
  }
  if (!request.avatarHash) {
    hinweise.push('Kein Avatar gesetzt');
  }
  if (hinweise.length > 0) {
    felder.push({ name: 'Hinweise', value: hinweise.join(' · '), inline: false });
  }

  if (entschieden) {
    felder.push({
      name: 'Entschieden von',
      value:
        request.decidedBy === 'AI'
          ? 'AI-Prüfung'
          : (request.decidedByUsername ?? request.decidedBy ?? 'unbekannt'),
      inline: true,
    });
    if (request.decisionReason) {
      felder.push({ name: 'Grund', value: request.decisionReason.slice(0, 400), inline: false });
    }
  }

  return {
    title: kopf,
    description: `**${request.displayName ?? request.username ?? 'Unbekannt'}**\n<@${request.discordId}> · \`${request.discordId}\``,
    color: VERIFICATION_ACCENT_COLOR,
    fields: felder,
    ...(request.avatarHash
      ? {
          thumbnail: {
            url: `https://cdn.discordapp.com/avatars/${request.discordId}/${request.avatarHash}.png?size=128`,
          },
        }
      : {}),
    timestamp: request.joinedAt.toISOString(),
    footer: { text: 'SwissHub Verifikation' },
  };
}

function buildComponents(request: VerificationRequest): DiscordMessagePayload['components'] {
  // Ein entschiedener Vorgang bietet nichts mehr an. Ein Knopf, der beim
  // Druecken nur noch «bereits entschieden» sagt, ist kein Angebot.
  if (request.decidedAt) {
    return [];
  }
  return [
    {
      type: 1 as const,
      components: [
        {
          type: 2 as const,
          style: BUTTON_STYLE.SUCCESS,
          label: 'Mitglied verifizieren',
          custom_id: buildButtonId('approve', request.id),
        },
        {
          type: 2 as const,
          style: BUTTON_STYLE.DANGER,
          label: 'User ablehnen',
          custom_id: buildButtonId('reject', request.id),
        },
      ],
    },
  ];
}

function payload(
  request: VerificationRequest,
  options: { mentionRoleId?: string | null } = {},
): DiscordMessagePayload {
  return {
    ...(options.mentionRoleId ? { content: `<@&${options.mentionRoleId}>` } : {}),
    embeds: [buildModEmbed(request)],
    components: buildComponents(request),
    allowedMentions: options.mentionRoleId
      ? { parse: [] as never[], roles: [options.mentionRoleId] }
      : { parse: [] as never[] },
  };
}

/**
 * Die Begruessung im Verifikationskanal.
 *
 * Erwaehnt ausschliesslich die begruesste Person - `parse: []` sorgt dafuer,
 * dass ein Begruessungstext mit `@everyone` darin niemanden anpingt.
 */
export async function sendGreeting(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<SentMessage | null> {
  if (!settings.verificationChannelId) {
    return null;
  }
  const text = settings.greetingMessage.replaceAll('{user}', `<@${request.discordId}>`);
  try {
    return await gateway.channels.send(settings.verificationChannelId, {
      content: text.slice(0, 1900),
      allowedMentions: { parse: [] as never[], users: [request.discordId] },
    });
  } catch (error) {
    logger.warn('Begrüssung konnte nicht gesendet werden', { requestId: request.id, error });
    return null;
  }
}

/**
 * Die Moderation ueber einen Fall unterrichten - oder die bestehende Meldung
 * fortschreiben.
 *
 * Ein Vorgang bekommt genau eine Meldung. Erwaehnt wird nur beim ersten Mal:
 * jede Aktualisierung erneut zu pingen waere genau das Fluten, das die
 * Einstellung verhindern soll.
 */
export async function pushModNotice(
  requestId: string,
  settings: VerificationSettings,
  options: { gateway?: DiscordGateway; erwaehnen?: boolean } = {},
): Promise<void> {
  const gateway = options.gateway ?? defaultDiscord;
  const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request || !settings.moderatorChannelId) {
    return;
  }

  if (request.modMessageId && request.modChannelId) {
    try {
      await gateway.channels.edit(request.modChannelId, request.modMessageId, payload(request));
      return;
    } catch (error) {
      // Die Meldung wurde geloescht. Eine neue zu senden ist hier richtig -
      // anders als bei einer Ankuendigung braucht die Moderation den Fall.
      logger.warn('Moderationsmeldung nicht auffindbar - wird neu gesendet', { requestId, error });
    }
  }

  try {
    const gesendet = await gateway.channels.send(
      settings.moderatorChannelId,
      payload(request, {
        mentionRoleId: options.erwaehnen ? settings.moderatorPingRoleId : null,
      }),
    );
    await prisma.verificationRequest.update({
      where: { id: requestId },
      data: { modChannelId: settings.moderatorChannelId, modMessageId: gesendet.id },
    });
  } catch (error) {
    logger.error('Moderation konnte nicht benachrichtigt werden', { requestId, error });
  }
}

/** Die frisch freigeschaltete Person im Verifikationskanal informieren. */
export async function sendWelcome(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  const text = settings.welcomeMessage.trim();
  if (!text || !settings.verificationChannelId) {
    return;
  }
  try {
    await gateway.channels.send(settings.verificationChannelId, {
      content: `<@${request.discordId}> ${text}`.slice(0, 1900),
      allowedMentions: { parse: [] as never[], users: [request.discordId] },
    });
  } catch (error) {
    logger.warn('Willkommensnachricht fehlgeschlagen', { requestId: request.id, error });
  }
}

/** Abgeschlossene Vorgaenge zusaetzlich protokollieren. */
export async function writeLog(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  if (!settings.logChannelId) {
    return;
  }
  try {
    await gateway.channels.send(settings.logChannelId, {
      embeds: [buildModEmbed(request)],
      allowedMentions: { parse: [] as never[] },
    });
  } catch (error) {
    logger.warn('Protokolleintrag fehlgeschlagen', { requestId: request.id, error });
  }
}
