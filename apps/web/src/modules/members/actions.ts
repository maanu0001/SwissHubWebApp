'use server';

import { z } from 'zod';
import { searchMembers } from '@swisshub/modules';
import { sanitizeText } from '@swisshub/shared';
import { defineAction } from '@/server/action';

const searchSchema = z.object({
  query: z
    .string()
    .max(100)
    .transform((value) => sanitizeText(value, 100)),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * Mitgliedersuche.
 *
 * Die Suche laeuft serverseitig gegen Discord - es wird niemals die komplette
 * Mitgliederliste an den Browser gesendet.
 */
export const searchMembersAction = defineAction(
  {
    name: 'members.search',
    module: 'members',
    permission: 'members.view',
    schema: searchSchema,
    rateLimit: 'memberSearch',
    freshness: 'cached',
  },
  async ({ input }) => {
    const members = await searchMembers(input.query, { limit: input.limit ?? 20 });
    return members.map((member) => ({
      discordId: member.discordId,
      username: member.username,
      displayName: member.displayName,
      avatarHash: member.avatarHash,
      isBot: member.isBot,
      roles: member.roles.slice(0, 5).map((role) => ({ id: role.id, name: role.name, color: role.color })),
      jailed: member.activeJail !== null,
    }));
  },
);
