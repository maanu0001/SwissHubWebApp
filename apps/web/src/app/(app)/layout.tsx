import { branding } from '@swisshub/config/client';
import { discord } from '@swisshub/discord';
import { guildIconUrl } from '@swisshub/discord/cdn';
import {
  buildNavigation,
  enabledModuleIds,
  getGuildConfig,
  groupNavigation,
  jail,
  readBotStatus,
} from '@swisshub/modules';
import { AppShell } from '@/components/layout/app-shell';
import { csrfTokenFor, requireMember } from '@/server/auth';

const APP_ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MODERATOR: 'Moderator',
  TEAM: 'Team',
  USER: 'Mitglied',
};

/**
 * Geschütztes Grundlayout.
 *
 * Der Zugriff wird hier serverseitig geprüft; Navigation, Seitentitel und
 * Modulzähler entstehen aus der Module Registry und den effektiven
 * Berechtigungen. Fällt Discord aus, bleibt die Oberfläche bedienbar.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const context = await requireMember();

  const [moduleIds, bot, guild, guildConfig, jailStats] = await Promise.all([
    enabledModuleIds(),
    readBotStatus(),
    discord.guild.get().catch(() => null),
    getGuildConfig(),
    jail.getJailStats().catch(() => null),
  ]);

  // Der verbundene Server steht in der Datenbank; Discord liefert nur die
  // aktuellen Anzeigedaten und darf ausfallen.
  const guildId = guild?.id ?? guildConfig.guildId;

  const navigation = buildNavigation(context.permissionKeys, moduleIds);
  const groups = groupNavigation(navigation).map((group) => ({
    id: group.id,
    label: group.label,
    items: group.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      moduleId: item.moduleId,
      group: item.group,
      planned: item.planned,
      badge: item.badge,
      count: item.counter === 'activeJails' ? (jailStats?.active ?? 0) : undefined,
    })),
  }));

  const titles = navigation
    .filter((item) => !item.planned)
    .map((item) => ({
      href: item.href,
      label: item.label,
      description: item.description,
    }));

  return (
    <AppShell
      groups={groups}
      titles={titles}
      permissions={context.permissionKeys}
      bot={{ online: bot.online, wsPingMs: bot.wsPingMs }}
      discordUrl={guildId ? `https://discord.com/channels/${guildId}` : 'https://discord.com/channels/@me'}
      server={{
        name: guild?.name ?? guildConfig.name ?? branding.name,
        iconUrl: guildId ? guildIconUrl(guildId, guild?.iconHash ?? guildConfig.iconHash, 64) : null,
        memberCount: guild?.approximateMemberCount ?? guildConfig.memberCount ?? bot.guildMemberCount,
        botOnline: bot.online,
      }}
      user={{
        discordId: context.user.discordId,
        displayName: context.user.displayName,
        username: context.user.username,
        avatarHash: context.user.avatarHash,
        primaryRole: APP_ROLE_LABEL[context.user.appRole] ?? 'Mitglied',
        csrfToken: csrfTokenFor(context),
        guildId: guildId ?? '',
      }}
    >
      {children}
    </AppShell>
  );
}
