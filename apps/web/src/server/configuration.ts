import 'server-only';
import { cache } from 'react';
import { listCachedChannels, listCachedRoles } from '@swisshub/modules';
import { discord } from '@swisshub/discord';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';

/**
 * Auswahllisten für die Einstellungsoberfläche.
 *
 * Die Daten stammen aus dem Sync-Cache: dadurch sind Rollen und Channels auch
 * dann verfügbar, wenn Discord gerade nicht erreichbar ist, und ein Klick im
 * Dashboard löst keine Discord-Anfrage aus.
 *
 * Bewusst nur Name, Farbe und Position - keine Berechtigungsbits und keine
 * Mitgliederlisten.
 */
export const loadDiscordOptions = cache(
  async (): Promise<{ roles: RoleOption[]; channels: ChannelOption[]; botHighestPosition: number }> => {
    const [roles, channels, botHighestPosition] = await Promise.all([
      listCachedRoles({ includeDeleted: false }).catch(() => []),
      listCachedChannels({ includeDeleted: false }).catch(() => []),
      discord.bot.highestRolePosition().catch(() => 0),
    ]);

    return {
      roles: roles
        .filter((role) => role.name !== '@everyone')
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          managed: role.managed,
          deleted: role.deleted,
          manageable: !role.managed && botHighestPosition > 0 && role.position < botHighestPosition,
        })),
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        parentName: channel.parentName,
        deleted: channel.deleted,
      })),
      botHighestPosition,
    };
  },
);
