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
    keepRoleIds: new Set([...roleConfiguration.keepOnJailRoleIds, ...settings.keepRoleIds]),
    moderationLevels: roleConfiguration.moderationLevels,
    moderationLogChannelId: settings.moderationLogChannelId ?? coreSettings.moderationLogChannelId ?? null,
    jailChannelId: settings.jailChannelId ?? null,
  };
}
