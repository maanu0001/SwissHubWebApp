/**
 * Client-sichere CDN-Helfer (keine Secrets, keine ENV-Zugriffe).
 */
const CDN = 'https://cdn.discordapp.com';

export function memberAvatarUrl(
  discordId: string,
  avatarHash: string | null | undefined,
  size: 16 | 32 | 64 | 128 | 256 = 128,
): string {
  if (!avatarHash) {
    return defaultAvatarUrl(discordId);
  }
  const extension = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `${CDN}/avatars/${discordId}/${avatarHash}.${extension}?size=${size}`;
}

/** Discords Standard-Avatar fuer Accounts ohne eigenes Bild. */
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
