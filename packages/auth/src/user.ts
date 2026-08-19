import { prisma } from '@swisshub/database';
import type { User } from '@swisshub/database';
import type { DiscordOAuthUser } from './oauth';

/**
 * Legt das Anwendungskonto an bzw. aktualisiert die Anzeigedaten.
 * Es werden ausschliesslich Felder gespeichert, die die WebApp wirklich
 * benoetigt (Datensparsamkeit).
 */
export async function upsertUserFromDiscord(profile: DiscordOAuthUser): Promise<User> {
  return prisma.user.upsert({
    where: { discordId: profile.discordId },
    create: {
      discordId: profile.discordId,
      username: profile.username,
      globalName: profile.globalName,
      avatarHash: profile.avatarHash,
    },
    update: {
      username: profile.username,
      globalName: profile.globalName,
      avatarHash: profile.avatarHash,
      lastLoginAt: new Date(),
    },
  });
}
