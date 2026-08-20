/**
 * Client-sichere CDN-Helfer (keine Secrets, keine ENV-Zugriffe).
 */
const CDN = 'https://cdn.discordapp.com';

/** Von Discord unterstützte Bildgrössen (Zweierpotenzen). */
export type AvatarSize = 16 | 32 | 64 | 128 | 256 | 512;

/**
 * Zentrale Avatar-URL.
 *
 * Einzige Stelle im Projekt, an der eine Discord-Avatar-URL entsteht - so
 * verhalten sich Sidebar, Mitgliederliste, Jail-Übersicht, Audit Log und
 * Kommunikationsverlauf garantiert gleich. Ohne eigenes Bild liefert Discord
 * ein Standardbild; ein kaputtes Bild kann dadurch nie entstehen.
 */
export function getDiscordAvatarUrl(
  discordId: string,
  avatarHash: string | null | undefined,
  size: AvatarSize = 128,
): string {
  if (!avatarHash) {
    return defaultAvatarUrl(discordId);
  }
  // Animierte Avatare beginnen mit `a_` und brauchen die GIF-Variante.
  const extension = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `${CDN}/avatars/${discordId}/${avatarHash}.${extension}?size=${size}`;
}

/**
 * @deprecated Verwende `getDiscordAvatarUrl`. Bleibt als Alias bestehen, damit
 * bestehende Aufrufe unverändert funktionieren.
 */
export const memberAvatarUrl = getDiscordAvatarUrl;

/** Nächstgrössere von Discord unterstützte Bildgrösse zu einer Anzeigegrösse. */
export function avatarSizeFor(displaySize: number): AvatarSize {
  const sizes: AvatarSize[] = [16, 32, 64, 128, 256, 512];
  // Retina: doppelte Auflösung anfordern, damit das Bild scharf bleibt.
  const target = displaySize * 2;
  return sizes.find((size) => size >= target) ?? 512;
}

/** Discords Standard-Avatar für Accounts ohne eigenes Bild. */
export function defaultAvatarUrl(discordId: string): string {
  let index = 0;
  try {
    index = Number((BigInt(discordId) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `${CDN}/embed/avatars/${index}.png`;
}

export function guildIconUrl(
  guildId: string,
  iconHash: string | null | undefined,
  size = 128,
): string | null {
  return iconHash ? `${CDN}/icons/${guildId}/${iconHash}.png?size=${size}` : null;
}

/**
 * Link zu einer Discord-Nachricht.
 * Wird serverseitig gebaut - der Browser bekommt eine fertige URL.
 */
export function messageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
