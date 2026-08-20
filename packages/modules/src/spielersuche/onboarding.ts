import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { SPIELERSUCHE_MODULE_ID } from './config';
import { loadSpielersucheContext, type SpielersucheContext } from './context';
import { normalizeBannerUrl } from './schemas';

const log = createLogger('spielersuche:onboarding');

/**
 * Tägliche Hinweisnachricht.
 *
 * Der alte Bot hatte Titel, Text und Banner fest im Code und schickte sie um
 * 16:00 Uhr. Hier ist alles Konfiguration; die Uhrzeit wird gegen die Zeitzone
 * Europe/Zurich ausgewertet, damit die Umstellung auf Sommerzeit nichts
 * verschiebt.
 */

export const ONBOARDING_TIMEZONE = 'Europe/Zurich';

/** Aktuelle Ortszeit als `HH:MM` in der Schweizer Zeitzone. */
export function localTimeString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: ONBOARDING_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** Datum als `YYYY-MM-DD` in der Schweizer Zeitzone - Schlüssel je Tag. */
export function localDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ONBOARDING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export interface OnboardingMessage {
  title: string;
  description: string;
  bannerUrl: string | null;
  footerText: string;
  color: number;
}

export function buildOnboardingMessage(context: SpielersucheContext): OnboardingMessage {
  const settings = context.settings;
  return {
    title: settings.onboardingTitle,
    description: settings.onboardingText,
    // Nur https - der Wert stammt aus dem Dashboard und geht direkt an Discord.
    bannerUrl: normalizeBannerUrl(settings.onboardingBannerUrl || null),
    footerText:
      settings.onboardingFooterText.trim().length > 0
        ? settings.onboardingFooterText
        : `${settings.footerText} • Täglich um ${settings.onboardingTime} Uhr`,
    color: context.accentColor,
  };
}

export interface SendOnboardingOptions {
  gateway?: DiscordGateway;
  context?: SpielersucheContext;
  /** Überschreibt den konfigurierten Channel (Testnachricht). */
  channelId?: string | null;
  actor?: { discordId: string; username: string } | null;
  /** Kennzeichnet eine manuell ausgelöste Testnachricht im Audit Log. */
  test?: boolean;
}

/**
 * Sendet die Hinweisnachricht.
 *
 * Erwähnungen sind vollständig unterdrückt: der Text stammt zwar aus dem
 * Dashboard, soll aber nie den ganzen Server anpingen.
 */
export async function sendOnboardingMessage(
  options: SendOnboardingOptions = {},
): Promise<{ channelId: string; messageId: string }> {
  const gateway = options.gateway ?? defaultDiscord;
  const context = options.context ?? (await loadSpielersucheContext(gateway));

  const channelId =
    options.channelId ?? context.settings.onboardingChannelId ?? context.searchChannelId ?? null;
  if (!channelId) {
    throw new AppError('CONFIGURATION_MISSING', {
      userMessage:
        'Es ist kein Channel für die Hinweisnachricht gewählt - weder beim Onboarding noch als Spielersuche-Channel.',
    });
  }

  const message = buildOnboardingMessage(context);
  const sent = await gateway.channels.send(channelId, {
    embeds: [
      {
        title: message.title,
        description: message.description,
        color: message.color,
        ...(message.bannerUrl ? { image: { url: message.bannerUrl } } : {}),
        footer: { text: message.footerText },
      },
    ],
    allowedMentions: { parse: [] },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_ONBOARDING_SENT,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: options.actor?.discordId ?? null,
    actorUsername: options.actor?.username ?? 'system',
    success: true,
    metadata: { channelId, messageId: sent.id, test: options.test ?? false },
  });

  log.info('Onboarding-Nachricht gesendet', { channelId, test: options.test ?? false });
  return { channelId, messageId: sent.id };
}

/**
 * Prüft, ob die tägliche Nachricht jetzt fällig ist.
 *
 * Der Job läuft minütlich; gesendet wird höchstens einmal pro Tag. Der
 * zuletzt gesendete Tag steht in der Systemkonfiguration, damit ein Neustart
 * nicht zu einer zweiten Nachricht führt.
 */
export async function runDailyOnboarding(
  gateway: DiscordGateway = defaultDiscord,
  now: Date = new Date(),
): Promise<'sent' | 'not-due' | 'disabled' | 'already-sent'> {
  const context = await loadSpielersucheContext(gateway);
  if (!context.settings.onboardingEnabled) {
    return 'disabled';
  }
  if (localTimeString(now) !== context.settings.onboardingTime) {
    return 'not-due';
  }

  const { readConfigValue, writeConfigValue } = await import('@swisshub/database');
  const { z } = await import('zod');
  const daySchema = z.string();
  const key = 'spielersuche.onboarding.lastSentDay';
  const today = localDateKey(now);

  const last = await readConfigValue(key, daySchema, '');
  if (last === today) {
    return 'already-sent';
  }

  // Erst merken, dann senden: ein Fehler beim Senden darf keine Schleife
  // auslösen, die es im selben Minutenfenster erneut versucht.
  await writeConfigValue(key, daySchema, today);
  try {
    await sendOnboardingMessage({ gateway, context });
    return 'sent';
  } catch (error) {
    log.error('Tägliche Onboarding-Nachricht fehlgeschlagen', { error });
    return 'not-due';
  }
}
