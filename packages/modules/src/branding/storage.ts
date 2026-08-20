import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('branding:storage');

/**
 * Speicherung hochgeladener Branding-Dateien.
 *
 * Grundsätze:
 *  - Dateinamen werden ausschliesslich serverseitig erzeugt (Zufall + Endung
 *    aus dem erkannten Format). Der Name aus dem Browser wird nie verwendet -
 *    damit sind Path Traversal und ausführbare Endungen ausgeschlossen.
 *  - Der Typ wird an den echten Bytes erkannt, nicht am Content-Type-Header
 *    oder an der Endung.
 *  - Ausgeliefert wird über einen Route Handler mit festem Content-Type; das
 *    Verzeichnis liegt ausserhalb von `public` und wird nie statisch bedient.
 */
export const UPLOAD_DIR = process.env.SWISSHUB_UPLOAD_DIR ?? '/var/lib/swisshub/uploads';

/** 5 MB - grosszügig für ein Logo, klein genug gegen Missbrauch. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type LogoFormat = 'png' | 'jpeg' | 'webp';

export const ACCEPTED_MIME_TYPES: Record<string, LogoFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
};

const EXTENSION: Record<LogoFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

export const CONTENT_TYPE: Record<LogoFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Format anhand der Datei-Signatur bestimmen.
 *
 * SVG wird bewusst nicht unterstützt: eine SVG-Datei kann Skripte enthalten
 * und müsste dafür zuverlässig bereinigt werden. Solange diese Bereinigung
 * nicht existiert, ist das Weglassen die ehrlichere Lösung.
 */
export function detectImageFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length < 12) {
    return null;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Bildabmessungen aus dem Header lesen.
 *
 * Bewusst ohne Bildbibliothek: es genügt, offensichtlich unbrauchbare Uploads
 * (1x1-Pixel, riesige Dateien) abzulehnen. `null` bedeutet "nicht ermittelbar"
 * und ist kein Fehler.
 */
export function readImageSize(
  bytes: Uint8Array,
  format: LogoFormat,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (format === 'png') {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (format === 'webp' && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38) {
      // Nur das einfache VP8L/VP8X-Layout; sonst nicht ermittelbar.
      if (bytes[15] === 0x58) {
        const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return { width, height };
      }
      return null;
    }
    if (format === 'jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1]!;
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface StoredUpload {
  /** Reiner Dateiname ohne Pfadanteile. */
  fileName: string;
  format: LogoFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Kurzer Inhaltshash - dient als Cache-Busting-Parameter. */
  version: string;
}

/**
 * Namensraum eines Uploads.
 *
 * Der Präfix steckt im erzeugten Dateinamen und wird beim Lesen wieder
 * geprüft. Dadurch lässt sich ein Logo nicht als Levelkarten-Hintergrund
 * ausliefern und umgekehrt.
 */
export const UPLOAD_KINDS = ['logo', 'levelcard'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/**
 * Speichert einen Upload und gibt den erzeugten Dateinamen zurück.
 * Wirft `VALIDATION_FAILED`, wenn die Datei nicht akzeptiert wird.
 */
export async function storeLogoUpload(
  data: Uint8Array,
  declaredMimeType: string | null,
  kind: UploadKind = 'logo',
  limits: { maxBytes?: number; minSize?: number; maxSize?: number } = {},
): Promise<StoredUpload> {
  if (data.byteLength === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Datei ist leer.' });
  }
  const maxBytes = limits.maxBytes ?? MAX_UPLOAD_BYTES;
  if (data.byteLength > maxBytes) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross (maximal ${Math.round(maxBytes / 1024 / 1024)} MB).`,
    });
  }

  // Der echte Inhalt entscheidet - der gemeldete Content-Type muss lediglich
  // dazu passen. Eine als PNG deklarierte HTML-Datei fällt hier durch.
  const format = detectImageFormat(data);
  if (!format) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Nur PNG, JPG und WEBP werden unterstützt.',
    });
  }
  if (declaredMimeType && ACCEPTED_MIME_TYPES[declaredMimeType.toLowerCase()] !== format) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dateityp und Inhalt stimmen nicht überein.',
    });
  }

  const minSize = limits.minSize ?? 16;
  const maxSize = limits.maxSize ?? 4096;
  const size = readImageSize(data, format);
  if (size && (size.width < minSize || size.height < minSize)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Das Bild ist zu klein (mindestens ${minSize}x${minSize}).`,
    });
  }
  if (size && (size.width > maxSize || size.height > maxSize)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Das Bild ist zu gross (maximal ${maxSize}x${maxSize}).`,
    });
  }

  // Zufälliger Name, feste Endung: der Name aus dem Browser wird verworfen.
  const fileName = `${kind}-${randomBytes(16).toString('hex')}.${EXTENSION[format]}`;

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    // `mode` 0o640: lesbar für den Dienst, nicht ausführbar.
    await writeFile(join(UPLOAD_DIR, fileName), data, { mode: 0o640 });
  } catch (error) {
    // Der häufigste Fall im Betrieb: das Verzeichnis existiert, gehört aber
    // root (frisch angelegtes Docker-Volume), während der Dienst als
    // unprivilegierter Benutzer läuft. Ohne diese Meldung wäre nur ein
    // generischer Fehler sichtbar und die Ursache kaum zu erraten.
    const code = (error as NodeJS.ErrnoException).code;
    log.error('Upload-Verzeichnis nicht beschreibbar', { error, uploadDir: UPLOAD_DIR, code });

    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new AppError('INTERNAL', {
        userMessage:
          'Das Upload-Verzeichnis auf dem Server ist nicht beschreibbar. Bitte die Rechte von SWISSHUB_UPLOAD_DIR prüfen.',
        internalMessage: `${code} beim Schreiben nach ${UPLOAD_DIR}`,
      });
    }
    if (code === 'ENOSPC') {
      throw new AppError('INTERNAL', {
        userMessage: 'Auf dem Server ist kein Speicherplatz mehr frei.',
        internalMessage: `ENOSPC beim Schreiben nach ${UPLOAD_DIR}`,
      });
    }
    throw new AppError('INTERNAL', {
      userMessage: 'Die Datei konnte auf dem Server nicht gespeichert werden.',
      internalMessage: `${code ?? 'unbekannt'} beim Schreiben nach ${UPLOAD_DIR}`,
    });
  }

  const version = createHash('sha256').update(data).digest('hex').slice(0, 12);
  log.info('Upload gespeichert', { fileName, bytes: data.byteLength, format, kind });

  return {
    fileName,
    format,
    bytes: data.byteLength,
    width: size?.width ?? null,
    height: size?.height ?? null,
    version,
  };
}

/**
 * Liest eine gespeicherte Datei.
 *
 * Der Dateiname wird streng geprüft und der aufgelöste Pfad muss innerhalb des
 * Upload-Verzeichnisses liegen - `../` kann damit nicht ausbrechen.
 */
export async function readUpload(fileName: string): Promise<{ data: Buffer; format: LogoFormat } | null> {
  const format = assertSafeFileName(fileName);
  const target = resolve(UPLOAD_DIR, fileName);
  if (!target.startsWith(resolve(UPLOAD_DIR) + '/')) {
    return null;
  }
  try {
    return { data: await readFile(target), format };
  } catch {
    return null;
  }
}

export async function deleteUpload(fileName: string): Promise<void> {
  try {
    assertSafeFileName(fileName);
  } catch {
    return;
  }
  const target = resolve(UPLOAD_DIR, fileName);
  if (!target.startsWith(resolve(UPLOAD_DIR) + '/')) {
    return;
  }
  await rm(target, { force: true });
}

/** Erlaubt ausschliesslich die selbst erzeugten Namen. */
function assertSafeFileName(fileName: string): LogoFormat {
  const match = /^(logo|levelcard)-[0-9a-f]{32}\.(png|jpg|webp)$/u.exec(fileName);
  if (!match) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Ungültiger Dateiname.' });
  }
  const extension = match[2];
  return extension === 'jpg' ? 'jpeg' : (extension as LogoFormat);
}
