import { discord as defaultDiscord, type DiscordGateway, type GuildRole } from '@swisshub/discord';
import { loadRoleConfiguration } from '@swisshub/permissions';
import { getCoreSettings } from '../settings';
import { getModuleSettings } from '../module-state';
import { JAIL_MODULE_ID, type JailSettings } from './config';

/**
 * Bündelt alle Discord-/Konfigurationsdaten, die für eine Jail-Aktion
 * benötigt werden. Ein einziger Ladepunkt hält die Anzahl Discord-Requests
 * klein und macht die Aktionen testbar.
 */
export interface JailExecutionContext {
  gateway: DiscordGateway;
  settings: JailSettings;
  guildRoles: GuildRole[];
  botHighestPosition: number;
  botUserId: string | null;
  guildOwnerId: string | null;
  protectedRoleIds: string[];
  keepRoleIds: Set<string>;
  moderationLevels: ReadonlyMap<string, number>;
  moderationLogChannelId: string | null;
  jailChannelId: string | null;
  /** Channel für die öffentliche Ankündigung. */
  announcementChannelId: string | null;
  /** Channel, in dem das Mitglied erwähnt wird. */
  jailPingChannelId: string | null;
  /** Rollen für die Anrede in den Textvorlagen (rein kosmetisch). */
  genderRoles: { maleRoleId: string | null; femaleRoleId: string | null };
}

export async function loadJailContext(
  gateway: DiscordGateway = defaultDiscord,
): Promise<JailExecutionContext> {
  const [settings, coreSettings, roleConfiguration, guildRoles, botIdentity, guild] = await Promise.all([
    getModuleSettings<JailSettings>(JAIL_MODULE_ID),
    getCoreSettings(),
    loadRoleConfiguration(),
    gateway.roles.list({ force: true }),
    gateway.bot.identity().catch(() => null),
    gateway.guild.get().catch(() => null),
  ]);

  const botHighestPosition = await gateway.bot.highestRolePosition().catch(() => 0);

  return {
    gateway,
    settings,
    guildRoles,
    botHighestPosition,
    botUserId: botIdentity?.id ?? null,
    guildOwnerId: guild?.ownerId ?? null,
    protectedRoleIds: roleConfiguration.protectedRoleIds,
    // Die Booster-Rolle ist im alten Bot fest verdrahtet gewesen. Hier ist sie
    // eine gewöhnliche Einstellung und fliesst nur dann in die Behalteliste,
    // wenn sie konfiguriert und aktiviert ist.
    keepRoleIds: new Set(
      [
        ...roleConfiguration.keepOnJailRoleIds,
        ...settings.keepRoleIds,
        ...(settings.keepBoosterRole && settings.boosterRoleId ? [settings.boosterRoleId] : []),
      ].filter(Boolean),
    ),
    moderationLevels: roleConfiguration.moderationLevels,
    moderationLogChannelId: settings.moderationLogChannelId ?? coreSettings.moderationLogChannelId ?? null,
    jailChannelId: settings.jailChannelId ?? null,
    announcementChannelId: settings.announcementChannelId ?? null,
    jailPingChannelId: settings.jailPingChannelId ?? null,
    genderRoles: {
      maleRoleId: settings.genderMaleRoleId ?? null,
      femaleRoleId: settings.genderFemaleRoleId ?? null,
    },
  };
}
