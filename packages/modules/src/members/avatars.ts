import { prisma } from '@swisshub/database';

/**
 * Avatar-Hashes zu Discord-IDs.
 *
 * Audit Log und Aktivitätsfeed speichern bewusst keine Avatare mit (sie würden
 * veralten). Für die Darstellung werden die Hashes deshalb gesammelt aus der
 * `User`-Tabelle nachgeschlagen - ein Query statt einer Discord-Anfrage pro
 * Zeile. Fehlt jemand dort (z.B. nie angemeldet), liefert die Avatar-Komponente
 * Discords Standardbild.
 */
export async function loadAvatarHashes(
  discordIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(discordIds.filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (unique.length === 0) {
    return new Map();
  }

  const users = await prisma.user.findMany({
    where: { discordId: { in: unique } },
    select: { discordId: true, avatarHash: true },
  });

  return new Map(users.map((user) => [user.discordId, user.avatarHash]));
}
