import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '@swisshub/database';
import type { DiscordEventMedia } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { UPLOAD_DIR } from '../branding/storage';
import { ANALYTICS_MODULE_ID, type AnalyticsSettings } from './config';
import { medienBelegung } from './queries';

const log = createLogger('analytics:media');

/**
 * Das Medienarchiv.
 *
 * Vier Zusagen, und jede hat einen Grund:
 *
 * 1. **Nichts liegt oeffentlich.** Das Verzeichnis liegt ausserhalb von
 *    `public` und wird nie statisch bedient. Der einzige Weg zu einer Datei
 *    fuehrt ueber eine Route, die vorher die Berechtigung prueft.
 * 2. **Kein erratbarer Pfad.** Der Dateiname entsteht aus Zufall, nicht aus
 *    dem Namen bei Discord. Wer eine Kennung kennt, kennt damit noch keine
 *    zweite.
 * 3. **Geloescht ist geloescht.** Laeuft die Frist ab, verschwinden die Bytes
 *    vom Datentraeger. Der Eintrag bleibt und traegt `deletedAt` - «hier gab
 *    es eine Datei» ist eine Auskunft, die erhalten bleiben soll, aber die
 *    Datei selbst ist ueber keinen Weg mehr erreichbar.
 * 4. **Es gibt eine Obergrenze.** Ist die Speichergrenze erreicht, wird
 *    nichts Neues archiviert. Alte Dateien werden dafuer nicht geloescht: die
 *    Aufbewahrungsfrist ist eine Zusage, und sie still zu unterlaufen, um
 *    Platz fuer Neues zu schaffen, waere das Gegenteil davon.
 */

/** Unterverzeichnis im geschuetzten Upload-Bereich. */
const MEDIEN_UNTERORDNER = 'analytics';

function medienVerzeichnis(): string {
  return join(resolve(UPLOAD_DIR), MEDIEN_UNTERORDNER);
}

/**
 * Erlaubte Arten.
 *
 * Bewusst eine Positivliste. Was hier nicht steht, wird vermerkt, aber nicht
 * gespeichert: ein Archiv, das beliebige Dateien annimmt, ist ein
 * Ablageplatz fuer beliebige Dateien.
 */
const ERLAUBTE_TYPEN: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/pdf': 'pdf',
};

export type ArchivErgebnis =
  | { gespeichert: true; media: DiscordEventMedia }
  | { gespeichert: false; grund: 'AUS' | 'TYP' | 'ZU_GROSS' | 'QUOTA' | 'FEHLER' };

export interface ArchiveInput {
  eventId: string;
  guildId: string;
  /** Name bei Discord - nur Anzeige, nie ein Pfad. */
  displayName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** Nimmt einen Namen als reine Anzeige entgegen - ohne Pfadanteile. */
function sichererAnzeigename(roh: string): string {
  const ohnePfad = roh.split(/[\\/]/u).pop() ?? 'datei';
  // Steuerzeichen und alles, was wie ein Pfad aussieht, fliegt raus. Der Name
  // landet spaeter in einem `Content-Disposition`-Header: ein Zeilenumbruch
  // darin waere eine zweite Kopfzeile, ein Anfuehrungszeichen ein Ausbruch
  // aus dem Wert. Genau deshalb steht hier absichtlich ein Bereich von
  // Steuerzeichen.
  // eslint-disable-next-line no-control-regex -- Steuerzeichen zu entfernen ist der Zweck dieser Zeile.
  const sauber = ohnePfad.replace(/[\u0000-\u001f\u007f"\\]/gu, '').trim();
  return (sauber || 'datei').slice(0, 120);
}

export async function archiveAttachment(input: ArchiveInput): Promise<ArchivErgebnis> {
  try {
    const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
    if (!settings.archiveMedia) {
      return { gespeichert: false, grund: 'AUS' };
    }

    const endung = ERLAUBTE_TYPEN[input.mimeType.toLowerCase().split(';')[0]?.trim() ?? ''];
    if (!endung) {
      return { gespeichert: false, grund: 'TYP' };
    }

    const grenze = settings.maxMediaFileMb * 1024 * 1024;
    if (input.bytes.byteLength > grenze) {
      return { gespeichert: false, grund: 'ZU_GROSS' };
    }

    const belegt = await medienBelegung(input.guildId);
    if (belegt + input.bytes.byteLength > settings.mediaQuotaMb * 1024 * 1024) {
      log.warn('Speichergrenze des Medienarchivs erreicht - nichts Neues archiviert', {
        belegt,
        grenze: settings.mediaQuotaMb,
      });
      return { gespeichert: false, grund: 'QUOTA' };
    }

    const verzeichnis = medienVerzeichnis();
    await mkdir(verzeichnis, { recursive: true, mode: 0o700 });

    // Der Name kommt aus dem Zufallsgenerator, nicht von Discord.
    const storageKey = `${randomBytes(24).toString('hex')}.${endung}`;
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');

    await writeFile(join(verzeichnis, storageKey), input.bytes, { mode: 0o600 });

    const media = await prisma.discordEventMedia.create({
      data: {
        eventId: input.eventId,
        guildId: input.guildId,
        storageKey,
        displayName: sichererAnzeigename(input.displayName),
        mimeType: input.mimeType.toLowerCase().split(';')[0]?.trim() ?? 'application/octet-stream',
        byteSize: input.bytes.byteLength,
        sha256,
        expiresAt: new Date(Date.now() + settings.mediaRetentionDays * 86_400_000),
      },
    });

    return { gespeichert: true, media };
  } catch (error) {
    log.warn('Datei konnte nicht archiviert werden', { error });
    return { gespeichert: false, grund: 'FEHLER' };
  }
}

export interface MediaAusgabe {
  bytes: Buffer;
  mimeType: string;
  displayName: string;
  byteSize: number;
}

/**
 * Liest eine archivierte Datei.
 *
 * **Prueft keine Berechtigung** - das tut der Route Handler, bevor er hierher
 * kommt. Was hier geprueft wird, ist die andere Haelfte: dass die Datei zu
 * diesem Server gehoert und noch nicht abgelaufen ist. Eine abgelaufene Datei
 * gibt es nicht mehr, auch wenn die Bytes noch auf dem Datentraeger laegen -
 * sonst waere die Aufbewahrungsfrist eine Absichtserklaerung und keine Zusage.
 */
export async function readArchivedMedia(guildId: string, mediaId: string): Promise<MediaAusgabe | null> {
  const eintrag = await prisma.discordEventMedia.findFirst({
    where: { id: mediaId, guildId, deletedAt: null },
  });
  if (!eintrag || eintrag.expiresAt <= new Date()) {
    return null;
  }

  // `storageKey` stammt aus der Datenbank und wurde serverseitig erzeugt. Der
  // Vergleich stellt sicher, dass er es auch geblieben ist: ein manipulierter
  // Wert mit `..` darf das Verzeichnis nicht verlassen.
  const verzeichnis = medienVerzeichnis();
  const pfad = resolve(join(verzeichnis, eintrag.storageKey));
  if (!pfad.startsWith(`${verzeichnis}/`)) {
    log.error('Speicherpfad ausserhalb des Archivs abgewiesen', { mediaId });
    throw new AppError('FORBIDDEN', { userMessage: 'Diese Datei ist nicht abrufbar.' });
  }

  const bytes = await readFile(pfad).catch(() => null);
  if (!bytes) {
    return null;
  }

  return {
    bytes,
    mimeType: eintrag.mimeType,
    displayName: eintrag.displayName,
    byteSize: eintrag.byteSize,
  };
}

export interface AufraeumErgebnis {
  medien: number;
  bytes: number;
  ereignisse: number;
}

/**
 * Aufbewahrungsfristen durchsetzen.
 *
 * Erst die Dateien, dann die Ereignisse - in dieser Reihenfolge, weil ein
 * geloeschtes Ereignis seine Dateien per Kaskade mitnaehme und die Bytes dann
 * verwaist auf dem Datentraeger liegen blieben. Genau der Fall, den Punkt 3
 * oben ausschliesst.
 */
export async function enforceRetention(guildId: string): Promise<AufraeumErgebnis> {
  const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
  const jetzt = new Date();

  const faellig = await prisma.discordEventMedia.findMany({
    where: { guildId, deletedAt: null, expiresAt: { lte: jetzt } },
    select: { id: true, storageKey: true, byteSize: true },
    take: 500,
  });

  const verzeichnis = medienVerzeichnis();
  let bytes = 0;
  for (const eintrag of faellig) {
    await rm(join(verzeichnis, eintrag.storageKey), { force: true }).catch((error: unknown) =>
      log.warn('Archivdatei konnte nicht gelöscht werden', { error, id: eintrag.id }),
    );
    bytes += eintrag.byteSize;
  }
  if (faellig.length > 0) {
    await prisma.discordEventMedia.updateMany({
      where: { id: { in: faellig.map((eintrag) => eintrag.id) } },
      data: { deletedAt: jetzt },
    });
  }

  const grenze = new Date(jetzt.getTime() - settings.retentionDays * 86_400_000);

  // Vor dem Loeschen der Ereignisse deren Dateien mitnehmen - die Kaskade
  // raeumt sonst nur die Datenbank auf und laesst die Bytes liegen.
  const verwaiste = await prisma.discordEventMedia.findMany({
    where: { guildId, deletedAt: null, event: { occurredAt: { lt: grenze } } },
    select: { id: true, storageKey: true, byteSize: true },
    take: 500,
  });
  for (const eintrag of verwaiste) {
    await rm(join(verzeichnis, eintrag.storageKey), { force: true }).catch(() => undefined);
    bytes += eintrag.byteSize;
  }

  const { count: ereignisse } = await prisma.discordEvent.deleteMany({
    where: { guildId, occurredAt: { lt: grenze } },
  });

  // Nachrichtenstaende, die aelter sind als die Aufbewahrung, haben keinen
  // Zweck mehr: sie existieren nur, um einer spaeteren Loeschung ihren Text
  // zu geben.
  await prisma.discordMessageSnapshot
    .deleteMany({ where: { guildId, postedAt: { lt: grenze } } })
    .catch(() => undefined);

  if (ereignisse > 0 || faellig.length > 0) {
    log.info('Aufbewahrungsfristen durchgesetzt', {
      ereignisse,
      medien: faellig.length + verwaiste.length,
    });
  }

  return { medien: faellig.length + verwaiste.length, bytes, ereignisse };
}
