import sharp from 'sharp';
import { createLogger } from '@swisshub/logger';
import { level } from '@swisshub/modules';

const log = createLogger('bot:level:card');

/**
 * Levelkarte als PNG.
 *
 * Das Layout liegt im Modul und entsteht als SVG; hier wird es nur gerastert.
 * Dadurch sehen Dashboard-Vorschau und Discord-Karte gleich aus, ohne dass
 * zwei Zeichnungen gepflegt werden müssen.
 */

/** Grenze für nachgeladene Bilder - schützt vor überlangen Downloads. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Nur diese Hosts liefern Bilder für die Karte. */
const ALLOWED_IMAGE_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'i.imgur.com',
]);

const cache = new Map<string, string>();

/**
 * Lädt ein Bild und gibt es als `data:`-URI zurück.
 *
 * Bewusst mit Positivliste und Grössenlimit: die Adresse des Hintergrunds
 * lässt sich im Dashboard eintragen, und der Bot soll damit nicht zu einem
 * Werkzeug werden, das beliebige Adressen abruft.
 */
async function fetchAsDataUri(url: string, allowAnyHost = false): Promise<string | null> {
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (!allowAnyHost && !ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    log.warn('Bildquelle nicht erlaubt', { host: parsed.hostname });
    return null;
  }

  try {
    const response = await fetch(parsed, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      return null;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) {
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    // Über sharp normalisieren: damit landet garantiert ein Rasterbild in der
    // Karte und kein weiteres SVG, das seinerseits Inhalte nachladen könnte.
    const png = await sharp(buffer).png().toBuffer();
    const uri = `data:image/png;base64,${png.toString('base64')}`;
    if (cache.size > 50) {
      cache.clear();
    }
    cache.set(url, uri);
    return uri;
  } catch (error) {
    log.warn('Bild konnte nicht geladen werden', { error, host: parsed.hostname });
    return null;
  }
}

export interface LevelCardRequest {
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  rank: number;
  accentColor: string;
  bannerUrl: string;
  prestigeBannerUrl: string;
  maxLevelTotalXp: number;
}

/** Erzeugt die Levelkarte als PNG-Puffer. */
export async function renderLevelCard(request: LevelCardRequest): Promise<Buffer> {
  const isPrestige = level.levelFromXp(request.xp, request.maxLevelTotalXp) >= level.MAX_LEVEL;
  const bannerSource =
    isPrestige && request.prestigeBannerUrl ? request.prestigeBannerUrl : request.bannerUrl;

  const [avatarDataUri, bannerDataUri] = await Promise.all([
    request.avatarUrl ? fetchAsDataUri(request.avatarUrl) : Promise.resolve(null),
    bannerSource ? fetchAsDataUri(bannerSource) : Promise.resolve(null),
  ]);

  const svg = level.renderLevelCardSvg({
    displayName: request.displayName,
    xp: request.xp,
    rank: request.rank,
    accentColor: request.accentColor,
    avatarDataUri,
    bannerDataUri,
    maxLevelTotalXp: request.maxLevelTotalXp,
  });

  return sharp(Buffer.from(svg)).png().toBuffer();
}
