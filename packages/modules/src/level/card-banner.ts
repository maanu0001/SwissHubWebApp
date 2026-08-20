import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import {
  CONTENT_TYPE,
  deleteUpload,
  readUpload,
  storeLogoUpload,
  type LogoFormat,
} from '../branding/storage';
import { readModuleSettings } from '../settings/service';
import { LEVEL_MODULE_ID, type LevelSettings } from './config';
import { updateLevelSettings, type LevelActor } from './admin';

const logger = createLogger('level.card-banner');

/**
 * Hintergrundbilder der Levelkarte.
 *
 * Sie werden im Dashboard hochgeladen statt als Adresse eingetragen: die
 * Bilder des alten Bots lagen als Dateien neben dem Code, und eine Adresse
 * setzt voraus, dass sie irgendwo dauerhaft erreichbar bleiben.
 *
 * Gespeichert wird über denselben Weg wie das WebApp-Logo - Typ am Inhalt
 * erkannt, Dateiname serverseitig erzeugt, Verzeichnis ausserhalb des
 * statisch bedienten Bereichs.
 */

export const CARD_BANNER_SLOTS = ['normal', 'prestige'] as const;
export type CardBannerSlot = (typeof CARD_BANNER_SLOTS)[number];

export const isCardBannerSlot = (value: string): value is CardBannerSlot =>
  (CARD_BANNER_SLOTS as readonly string[]).includes(value);

/** 8 MB - die Karte ist 900 Pixel breit, mehr braucht kein Hintergrund. */
export const MAX_CARD_BANNER_BYTES = 8 * 1024 * 1024;

const SETTING_KEY: Record<CardBannerSlot, 'cardBannerPath' | 'cardPrestigeBannerPath'> = {
  normal: 'cardBannerPath',
  prestige: 'cardPrestigeBannerPath',
};

const SLOT_LABEL: Record<CardBannerSlot, string> = {
  normal: 'Levelkarte',
  prestige: 'Levelkarte im Höchstlevel',
};

/** Empfohlene Abmessungen - dieselben wie die erzeugte Karte. */
export const CARD_BANNER_SIZE: Record<CardBannerSlot, { width: number; height: number }> = {
  normal: { width: 900, height: 225 },
  prestige: { width: 900, height: 341 },
};

export interface StoredCardBanner {
  slot: CardBannerSlot;
  fileName: string;
  bytes: number;
  width: number | null;
  height: number | null;
  version: string;
}

/**
 * Nimmt ein hochgeladenes Bild entgegen.
 *
 * Ein bereits vorhandenes Bild desselben Platzes wird danach gelöscht -
 * sonst sammelten sich verwaiste Dateien im Upload-Verzeichnis an.
 */
export async function storeCardBanner(
  actor: LevelActor,
  slot: CardBannerSlot,
  data: Uint8Array,
  declaredMimeType: string | null,
): Promise<StoredCardBanner> {
  const settings = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  const previous = settings[SETTING_KEY[slot]];

  const stored = await storeLogoUpload(data, declaredMimeType, 'levelcard', {
    maxBytes: MAX_CARD_BANNER_BYTES,
    minSize: 100,
    maxSize: 4096,
  });

  await updateLevelSettings(actor, { [SETTING_KEY[slot]]: stored.fileName } as Partial<LevelSettings>);

  if (previous && previous !== stored.fileName) {
    await deleteUpload(previous).catch((error: unknown) =>
      logger.warn('Vorheriger Hintergrund konnte nicht gelöscht werden', { previous, error }),
    );
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_CARD_BANNER_CHANGED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: {
      slot,
      label: SLOT_LABEL[slot],
      bytes: stored.bytes,
      format: stored.format,
      width: stored.width,
      height: stored.height,
    },
  });

  return {
    slot,
    fileName: stored.fileName,
    bytes: stored.bytes,
    width: stored.width,
    height: stored.height,
    version: stored.version,
  };
}

/** Entfernt das hochgeladene Bild eines Platzes. */
export async function clearCardBanner(actor: LevelActor, slot: CardBannerSlot): Promise<void> {
  const settings = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  const current = settings[SETTING_KEY[slot]];
  if (!current) {
    return;
  }

  await updateLevelSettings(actor, { [SETTING_KEY[slot]]: '' } as Partial<LevelSettings>);
  await deleteUpload(current).catch(() => undefined);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_CARD_BANNER_CHANGED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { slot, label: SLOT_LABEL[slot], removed: true },
  });
}

/** Liest ein hochgeladenes Bild. `null`, wenn keines hinterlegt ist. */
export async function readCardBanner(
  slot: CardBannerSlot,
  settings?: LevelSettings,
): Promise<{ data: Buffer; format: LogoFormat; contentType: string } | null> {
  const config = settings ?? (await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID));
  const fileName = config[SETTING_KEY[slot]];
  if (!fileName) {
    return null;
  }
  const file = await readUpload(fileName);
  if (!file) {
    // Die Datei ist weg, der Eintrag zeigt ins Leere. Das passiert etwa, wenn
    // das Upload-Volume neu angelegt wurde; die Karte fällt dann auf die
    // Adresse bzw. die Akzentfarbe zurück.
    logger.warn('Hinterlegter Kartenhintergrund fehlt auf der Platte', { slot, fileName });
    return null;
  }
  return { ...file, contentType: CONTENT_TYPE[file.format] };
}

/**
 * Welcher Hintergrund für einen XP-Stand gilt.
 *
 * Reihenfolge: hochgeladene Datei, dann Adresse. Im Höchstlevel zuerst der
 * eigene Hintergrund, sonst der normale - so verhielt sich der Vorgänger auch.
 */
export function resolveCardBanner(settings: LevelSettings, prestige: boolean): { path: string; url: string } {
  if (prestige && (settings.cardPrestigeBannerPath || settings.cardPrestigeBannerUrl)) {
    return { path: settings.cardPrestigeBannerPath, url: settings.cardPrestigeBannerUrl };
  }
  return { path: settings.cardBannerPath, url: settings.cardBannerUrl };
}

/** Sicherheitsnetz für die Ausgabe: nur bekannte Plätze. */
export function assertCardBannerSlot(value: string): CardBannerSlot {
  if (!isCardBannerSlot(value)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Unbekannter Bildplatz.' });
  }
  return value;
}
