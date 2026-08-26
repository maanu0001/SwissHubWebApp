import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import {
  CONTENT_TYPE,
  deleteUpload,
  readUpload,
  storeLogoUpload,
  type LogoFormat,
} from '../branding/storage';
import { LEVEL_MODULE_ID, LEVEL_PERMISSIONS } from './config';
import type { LevelActor } from './admin';

const log = createLogger('level.custom-card');

/**
 * Die persoenliche Levelkarte.
 *
 * Wer die Berechtigung hat, hinterlegt ein eigenes Bild; es tritt an die
 * Stelle des Kartenhintergrunds aus den Moduleinstellungen - aber nur bei
 * seiner eigenen Karte. Die Vorlagen des Servers bleiben, wie sie sind, und
 * werden weiterhin dort verwaltet.
 *
 * Gespeichert wird ueber denselben Weg wie Logo und Kartenhintergrund:
 * `storeLogoUpload` erkennt das Format an der Datei-Signatur statt am
 * angegebenen Typ, erzeugt den Dateinamen serverseitig und legt ihn ausserhalb
 * des statisch bedienten Verzeichnisses ab. Ein zweiter Speicherweg haette
 * dieselben Fragen noch einmal beantworten muessen - und irgendwann anders.
 */

/** Dieselbe Grenze wie beim Kartenhintergrund. */
export const MAX_CUSTOM_CARD_BYTES = 8 * 1024 * 1024;

/** Empfohlene Abmessungen - die der erzeugten Karte. */
export const CUSTOM_CARD_SIZE = { width: 900, height: 225 } as const;

export interface CustomCardViewer {
  discordId: string;
  can(permission: string): boolean;
}

export interface StoredCustomCard {
  fileName: string;
  bytes: number;
  width: number | null;
  height: number | null;
  version: string;
}

/**
 * Legt die eigene Karte ab.
 *
 * Ausdruecklich nur die eigene: ein Ziel aus der Eingabe gibt es nicht. Wer
 * fremde Karten aendern koennte, koennte jedem Mitglied ein beliebiges Bild
 * unterschieben.
 */
export async function storeCustomCard(
  viewer: CustomCardViewer,
  actor: LevelActor,
  data: Uint8Array,
  declaredMimeType: string | null,
): Promise<StoredCustomCard> {
  if (!viewer.can(LEVEL_PERMISSIONS.cardCustom)) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst keine eigene Levelkarte hinterlegen.',
    });
  }

  const vorher = await prisma.levelProfile.findUnique({
    where: { discordId: viewer.discordId },
    select: { customCardPath: true },
  });

  const stored = await storeLogoUpload(data, declaredMimeType, 'usercard', {
    maxBytes: MAX_CUSTOM_CARD_BYTES,
    minSize: 100,
    maxSize: 4096,
  });

  // Das Profil kann fehlen, wenn jemand noch nie XP gesammelt hat - die Karte
  // soll er trotzdem hinterlegen koennen.
  await prisma.levelProfile.upsert({
    where: { discordId: viewer.discordId },
    create: { discordId: viewer.discordId, customCardPath: stored.fileName },
    update: { customCardPath: stored.fileName },
  });

  if (vorher?.customCardPath && vorher.customCardPath !== stored.fileName) {
    await deleteUpload(vorher.customCardPath).catch((error: unknown) =>
      log.warn('Vorherige Levelkarte konnte nicht gelöscht werden', { error }),
    );
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_CUSTOM_CARD_CHANGED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: viewer.discordId,
    metadata: { bytes: stored.bytes, format: stored.format, width: stored.width, height: stored.height },
  });

  return {
    fileName: stored.fileName,
    bytes: stored.bytes,
    width: stored.width,
    height: stored.height,
    version: stored.version,
  };
}

/**
 * Nimmt eine Karte wieder weg.
 *
 * Zwei Faelle: die eigene - dafuer genuegt, sie hinterlegt zu haben. Oder eine
 * fremde, und dafuer braucht es die Verwaltungsberechtigung des Levelmoduls.
 * Ein Bild, das nicht auf den Server gehoert, muss jemand entfernen koennen,
 * ohne den Umweg ueber die Datenbank.
 */
export async function clearCustomCard(
  viewer: CustomCardViewer,
  actor: LevelActor,
  targetDiscordId: string,
): Promise<void> {
  const eigen = targetDiscordId === viewer.discordId;
  if (!eigen && !viewer.can(LEVEL_PERMISSIONS.membersManage)) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst keine fremden Levelkarten entfernen.',
    });
  }

  const profil = await prisma.levelProfile.findUnique({
    where: { discordId: targetDiscordId },
    select: { customCardPath: true },
  });
  if (!profil?.customCardPath) {
    return;
  }

  await prisma.levelProfile.update({
    where: { discordId: targetDiscordId },
    data: { customCardPath: null },
  });
  await deleteUpload(profil.customCardPath).catch(() => undefined);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_CUSTOM_CARD_CHANGED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId,
    metadata: { removed: true, fremd: !eigen },
  });
}

/** Hat diese Person eine eigene Karte hinterlegt? */
export async function hasCustomCard(discordId: string): Promise<boolean> {
  const profil = await prisma.levelProfile.findUnique({
    where: { discordId },
    select: { customCardPath: true },
  });
  return Boolean(profil?.customCardPath);
}

/** Liest die eigene Karte. `null`, wenn keine hinterlegt ist. */
export async function readCustomCard(
  discordId: string,
): Promise<{ data: Buffer; format: LogoFormat; contentType: string } | null> {
  const profil = await prisma.levelProfile.findUnique({
    where: { discordId },
    select: { customCardPath: true },
  });
  if (!profil?.customCardPath) {
    return null;
  }
  const file = await readUpload(profil.customCardPath);
  if (!file) {
    // Der Eintrag zeigt ins Leere - etwa nach einem neu angelegten
    // Upload-Volume. Die Karte faellt dann auf den Serverhintergrund zurueck.
    log.warn('Hinterlegte eigene Levelkarte fehlt auf der Platte', { discordId });
    return null;
  }
  return { ...file, contentType: CONTENT_TYPE[file.format] };
}
