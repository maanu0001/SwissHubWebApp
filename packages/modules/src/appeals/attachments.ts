import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '@swisshub/database';
import type { AppealAttachment } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { UPLOAD_DIR } from '../branding/storage';
import { getModuleSettings } from '../module-state';
import { APPEALS_MODULE_ID, type AppealsSettings } from './config';

const logger = createLogger('appeals:attachments');

/**
 * Anhänge eines Antrags (§33).
 *
 * Dieselben vier Zusagen wie beim Medienarchiv, und aus denselben Gründen -
 * es ist bewusst dasselbe Verfahren und kein zweites:
 *
 * 1. **Nichts liegt öffentlich.** Das Verzeichnis liegt ausserhalb von
 *    `public`. Der einzige Weg zu einer Datei führt über eine Route, die
 *    vorher prüft, ob der Abrufende sie sehen darf.
 * 2. **Kein erratbarer Pfad.** Der Speichername entsteht aus Zufall, nicht
 *    aus dem Namen beim Hochladen.
 * 3. **Positivliste.** Was hier nicht steht, wird abgewiesen. Ein Bereich,
 *    der beliebige Dateien annimmt, ist ein Ablageplatz für beliebige
 *    Dateien - und dieser hier nimmt sie von Leuten entgegen, die gerade
 *    gebannt sind.
 * 4. **Gelöscht ist gelöscht.** Nach der Aufbewahrungsfrist verschwinden die
 *    Bytes; der Eintrag bleibt und trägt `deletedAt`.
 */

const UNTERORDNER = 'appeals';

function verzeichnis(): string {
  return join(resolve(UPLOAD_DIR), UNTERORDNER);
}

/**
 * Erlaubte Arten.
 *
 * Bilder, PDF und Text - alles, womit sich ein Beleg zeigen lässt. Keine
 * ausführbaren Dateien, keine Archive: ein Archiv verbirgt seinen Inhalt, und
 * was verborgen ist, lässt sich nicht prüfen.
 */
export const ERLAUBTE_TYPEN: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

/**
 * Der Anzeigename einer hochgeladenen Datei.
 *
 * Er stammt vom Hochladenden und wird nirgends zum Pfad - gespeichert wird
 * unter einem Zufallsnamen. Trotzdem wird er entschärft: Pfadtrenner und
 * Steuerzeichen haben in einem Namen nichts verloren, der später in einer
 * `Content-Disposition`-Kopfzeile steht.
 */
export function entschaerfeDateiname(roh: string, endung: string): string {
  // Zeichenweise statt per Regex: ein Ausdruck mit Steuerzeichen darin ist
  // schwer zu lesen und die Regel `no-control-regex` warnt zu Recht davor.
  const sauber = [...roh]
    .map((zeichen) => (zeichen === '/' || zeichen === '\\' ? '_' : zeichen))
    .filter((zeichen) => {
      const code = zeichen.codePointAt(0) ?? 0;
      // Steuerzeichen und das Anfuehrungszeichen: beide haben in einer
      // `Content-Disposition`-Kopfzeile nichts verloren.
      return code > 0x1f && code !== 0x7f && zeichen !== '"';
    })
    .join('')
    .trim()
    .slice(0, 120);
  return sauber.length > 0 ? sauber : `anhang.${endung}`;
}

export interface UploadEingabe {
  appealId: string;
  messageId?: string | null;
  uploadedByDiscordId: string;
  fileName: string;
  contentType: string;
  daten: Buffer;
}

/**
 * Einen Anhang speichern.
 *
 * Der Dateiname wird nicht übernommen, sondern nur gespeichert: er stammt vom
 * Hochladenden und könnte Pfadangaben enthalten. Gespeichert wird unter einem
 * Zufallsnamen; der ursprüngliche Name steht in der Datenbank und wird beim
 * Herunterladen als Vorschlag mitgegeben.
 */
export async function speichereAnhang(eingabe: UploadEingabe): Promise<AppealAttachment> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  if (!settings.anhaengeErlaubt) {
    throw new AppError('FORBIDDEN', { userMessage: 'Anhänge sind derzeit nicht möglich.' });
  }

  const endung = ERLAUBTE_TYPEN[eingabe.contentType];
  if (!endung) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Erlaubt sind Bilder (PNG, JPG, WebP), PDF und Textdateien.',
    });
  }

  const maxBytes = settings.maxAnhangMb * 1024 * 1024;
  if (eingabe.daten.byteLength > maxBytes) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross. Erlaubt sind ${settings.maxAnhangMb} MB.`,
    });
  }
  if (eingabe.daten.byteLength === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Datei ist leer.' });
  }

  const bisher = await prisma.appealAttachment.count({
    where: { appealId: eingabe.appealId, deletedAt: null },
  });
  if (bisher >= settings.maxAnhaengeProAntrag) {
    throw new AppError('CONFLICT', {
      userMessage: `Höchstens ${settings.maxAnhaengeProAntrag} Anhänge je Antrag.`,
    });
  }

  const storageName = `${randomBytes(16).toString('hex')}.${endung}`;
  await mkdir(verzeichnis(), { recursive: true });
  await writeFile(join(verzeichnis(), storageName), eingabe.daten, { mode: 0o640 });

  return prisma.appealAttachment.create({
    data: {
      appealId: eingabe.appealId,
      messageId: eingabe.messageId ?? null,
      uploadedByDiscordId: eingabe.uploadedByDiscordId,
      fileName: entschaerfeDateiname(eingabe.fileName, endung),
      contentType: eingabe.contentType,
      sizeBytes: eingabe.daten.byteLength,
      storageName,
    },
  });
}

export interface AnhangDatei {
  fileName: string;
  contentType: string;
  daten: Buffer;
}

/**
 * Einen Anhang lesen.
 *
 * Die Berechtigung prüft der Aufrufer - diese Funktion liest nur. Sie
 * verlangt allerdings die Antragskennung: damit lässt sich keine fremde
 * Anhangskennung an einem beliebigen Antrag vorbei abrufen.
 */
export async function leseAnhang(
  appealId: string,
  attachmentId: string,
): Promise<AnhangDatei | null> {
  const anhang = await prisma.appealAttachment.findFirst({
    where: { id: attachmentId, appealId, deletedAt: null },
  });
  if (!anhang) {
    return null;
  }

  try {
    const daten = await readFile(join(verzeichnis(), anhang.storageName));
    return { fileName: anhang.fileName, contentType: anhang.contentType, daten };
  } catch (error) {
    logger.warn('Anhang nicht lesbar', { attachmentId, error });
    return null;
  }
}

/**
 * Anhänge abgeschlossener Anträge entfernen (§47).
 *
 * Der Antrag bleibt - er ist Teil der Moderationsspur. Die Dateien sind es
 * nicht: sie waren Beleg für eine Entscheidung, die getroffen ist.
 */
export async function raeumeAnhaenge(jetzt = new Date()): Promise<number> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  const grenze = new Date(jetzt.getTime() - settings.anhangAufbewahrungTage * 24 * 3600_000);

  const faellig = await prisma.appealAttachment.findMany({
    where: {
      deletedAt: null,
      appeal: { closedAt: { not: null, lt: grenze } },
    },
    take: 200,
    select: { id: true, storageName: true },
  });

  let entfernt = 0;
  for (const anhang of faellig) {
    await rm(join(verzeichnis(), anhang.storageName), { force: true }).catch(() => undefined);
    await prisma.appealAttachment.update({
      where: { id: anhang.id },
      data: { deletedAt: jetzt },
    });
    entfernt += 1;
  }

  if (entfernt > 0) {
    logger.info('Anhänge nach Aufbewahrungsfrist entfernt', { anzahl: entfernt });
  }
  return entfernt;
}
