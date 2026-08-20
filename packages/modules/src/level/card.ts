import { levelProgress } from './curve';

/**
 * Levelkarte als SVG.
 *
 * Der Vorgänger zeichnete sie mit Pillow direkt als PNG. Hier entsteht
 * zunächst ein SVG: das Dashboard zeigt es unverändert an, und für Discord
 * rastert der Bot dasselbe Bild zu PNG. Layout, Grössen und Schriftgrade
 * folgen der alten Karte, damit sie im Chat vertraut aussieht.
 */

/** Masse der normalen Karte (`900x225` beim Vorgänger). */
export const CARD_WIDTH = 900;
export const CARD_HEIGHT = 225;

/** Die Karte für das Höchstlevel ist höher und golden. */
export const PRESTIGE_CARD_HEIGHT = 341;

const GOLD = '#D4AF37';

/** Schweizer Tausendertrennung mit Apostroph - wie beim Vorgänger. */
export function formatXp(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '’');
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');

/**
 * Kürzt einen Namen auf die verfügbare Breite.
 *
 * Ohne echte Schriftvermessung wird mit einer mittleren Zeichenbreite
 * gerechnet; das genügt, weil zu lange Namen nur abgeschnitten statt
 * umgebrochen werden.
 */
function truncateName(name: string, maxWidth: number, fontSize: number): string {
  const averageCharWidth = fontSize * 0.58;
  const maxChars = Math.max(3, Math.floor(maxWidth / averageCharWidth));
  const trimmed = name.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 1)}…`;
}

export interface LevelCardInput {
  displayName: string;
  xp: number;
  rank: number;
  /** Akzentfarbe als Hex, z.B. `#83060A`. */
  accentColor?: string;
  /**
   * Avatar als `data:`-URI. Bewusst keine URL: beim Rastern dürfen keine
   * Netzwerkzugriffe aus der Bilddatei heraus passieren.
   */
  avatarDataUri?: string | null;
  /** Hintergrundbild als `data:`-URI. */
  bannerDataUri?: string | null;
  maxLevelTotalXp?: number;
}

/** Baut die Levelkarte als SVG-Zeichenkette. */
export function renderLevelCardSvg(input: LevelCardInput): string {
  const progress = levelProgress(input.xp, input.maxLevelTotalXp);
  const prestige = progress.isMaxLevel;
  const width = CARD_WIDTH;
  const height = prestige ? PRESTIGE_CARD_HEIGHT : CARD_HEIGHT;

  const accent = /^#[0-9A-Fa-f]{6}$/u.test(input.accentColor ?? '') ? input.accentColor! : '#83060A';
  const textColor = prestige ? GOLD : '#FFFFFF';
  const barColor = prestige ? GOLD : '#FFFFFF';

  const avatarSize = 120;
  const avatarX = 32;
  const avatarY = prestige
    ? Math.round((height - avatarSize) / 2) - 2
    : Math.round((height - avatarSize) / 2) - 10;

  const textX = avatarX + avatarSize + (prestige ? 36 : 28);
  const textY = prestige ? Math.round(height * 0.3) : 26;
  const nameFontSize = 38;
  const maxNameWidth = width - textX - 40;
  const name = escapeXml(truncateName(input.displayName, maxNameWidth, nameFontSize));

  const xpLine = prestige
    ? `XP: ${formatXp(progress.xp)}`
    : `XP: ${formatXp(progress.xp)}  (Next: ${formatXp(progress.nextLevelXp)})`;

  const barY = prestige ? Math.round(height * 0.7) : height - 54;
  const barHeight = 22;
  const labelY = barY + Math.round((barHeight - 18) / 2) + 14;
  const percent = Math.round(progress.progress * 100);

  // Grobe Breitenschätzung für Beschriftung und Prozentangabe, damit der
  // Balken dazwischen passt.
  const labelWidth = 78;
  const percentWidth = `${percent}%`.length * 12;
  const percentX = width - 40 - percentWidth;
  const barX = textX + labelWidth + 14;
  const barWidth = Math.max(120, percentX - 14 - barX);
  const fillWidth = Math.round(barWidth * progress.progress);

  const background = input.bannerDataUri
    ? `<image href="${escapeXml(input.bannerDataUri)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="#000000" opacity="${prestige ? 0.27 : 0.37}" />`
    : `<rect x="0" y="0" width="${width}" height="${height}" fill="${accent}" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="#000000" opacity="0.35" />`;

  const avatar = input.avatarDataUri
    ? `<image href="${escapeXml(input.avatarDataUri)}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice" />`
    : `<circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}" fill="#1F2023" />`;

  const fontStack = 'DejaVu Sans, Noto Sans, Helvetica, Arial, sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Levelkarte von ${name}">
  <defs>
    <clipPath id="avatarClip">
      <circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}" />
    </clipPath>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#121214" />
  ${background}
  ${avatar}
  <circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2 - 2}" fill="none" stroke="${prestige ? GOLD : '#FFFFFF'}" stroke-opacity="${prestige ? 0.92 : 0.7}" stroke-width="${prestige ? 5 : 4}" />
  <g font-family="${fontStack}" fill="${textColor}">
    <text x="${textX}" y="${textY + nameFontSize}" font-size="${nameFontSize}" font-weight="bold" fill-opacity="0.94">${name}</text>
    <text x="${textX}" y="${textY + 50 + 24}" font-size="24" fill-opacity="0.86">Level ${progress.level}  •  Rank #${input.rank}</text>
    <text x="${textX}" y="${textY + 82 + 20}" font-size="20" fill-opacity="0.78">${escapeXml(xpLine)}</text>
    <text x="${textX}" y="${labelY}" font-size="20" fill-opacity="0.82">Progress:</text>
    <text x="${percentX}" y="${labelY}" font-size="20" fill-opacity="0.82">${percent}%</text>
  </g>
  <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="#000000" fill-opacity="0.35" />
  ${fillWidth > 0 ? `<rect x="${barX}" y="${barY}" width="${fillWidth}" height="${barHeight}" rx="${Math.min(barHeight / 2, Math.max(1, fillWidth / 2))}" fill="${barColor}" fill-opacity="${prestige ? 0.92 : 0.85}" />` : ''}
</svg>`;
}
