import { discordMocksEnabled } from '@swisshub/config';
import { createMockGateway } from './mock-gateway';
import { createRestGateway } from './rest-gateway';
import type { DiscordGateway } from './gateway';

let instance: DiscordGateway | null = null;

/** Erzeugt (einmalig) die passende Gateway-Implementierung. */
export function getDiscord(): DiscordGateway {
  if (!instance) {
    instance = discordMocksEnabled() ? createMockGateway() : createRestGateway();
  }
  return instance;
}

/**
 * Zentrale Discord-Fassade.
 *
 *   discord.members.get(id)
 *   discord.roles.add(id, roleId)
 *   discord.channels.send(channelId, payload)
 *
 * Der Proxy verzögert die Initialisierung, damit das Modul importiert werden
 * kann, bevor die Umgebung validiert wurde (z.B. beim Next.js Build).
 */
export const discord: DiscordGateway = new Proxy({} as DiscordGateway, {
  get(_target, property: string) {
    return getDiscord()[property as keyof DiscordGateway];
  },
});

/** Nur für Tests: ersetzt die Gateway-Implementierung. */
export function setDiscordGateway(gateway: DiscordGateway | null): void {
  instance = gateway;
}

export * from './types';
export {
  setGuildIdResolver,
  resolveGuildId,
  tryResolveGuildId,
  clearGuildIdCache,
  bootstrapGuildId,
  type GuildIdResolver,
} from './guild-context';
export * from './errors';
export * from './permissions';
export * from './gateway';
export { clearDiscordCache } from './rest-gateway';
export { createMockGateway } from './mock-gateway';
export { discordRequest, resetRestState } from './rest';
export { memberAvatarUrl, defaultAvatarUrl, guildIconUrl } from './cdn';
