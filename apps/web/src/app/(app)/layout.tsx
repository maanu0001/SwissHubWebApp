import { branding } from '@swisshub/config/client';
import { discord } from '@swisshub/discord';
import { guildIconUrl } from '@swisshub/discord/cdn';
import {
  branding as brandingModule,
  buildNavigation,
  enabledModuleIds,
  getGuildConfig,
  groupNavigation,
  jail,
  readBotStatus,
} from '@swisshub/modules';
import { AppShell } from '@/components/layout/app-shell';
import { csrfTokenFor, hasSetupAccess, requireMember } from '@/server/auth';

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

  const [moduleIds, bot, guild, guildConfig, jailStats, brandingConfig] = await Promise.all([
    enabledModuleIds(),
    readBotStatus(),
    discord.guild.get().catch(() => null),
    getGuildConfig(),
    jail.getJailStats().catch(() => null),
    brandingModule.getBrandingConfig(),
  ]);

  // Der verbundene Server steht in der Datenbank; Discord liefert nur die
  // aktuellen Anzeigedaten und darf ausfallen.
  const guildId = guild?.id ?? guildConfig.guildId;

  /**
   * Während der Einrichtung besitzt ein Discord-Administrator noch keine
   * Dashboard-Berechtigungen. Damit die Seitenleiste nicht leer bleibt, werden
   * für die Navigation die Konfigurationsbereiche ergänzt. Das ist reine
   * Darstellung - jede Seite und jede Aktion prüft weiterhin serverseitig.
   */
  const setupAccess = await hasSetupAccess();
  const navigationKeys = setupAccess
    ? [...new Set([...context.permissionKeys, 'settings.view', 'permissions.manage', 'modules.manage'])]
    : context.permissionKeys;

  const navigation = buildNavigation(navigationKeys, moduleIds);
  const groups = groupNavigation(navigation).map((group) => ({
    id: group.id,
    label: group.label,
    items: group.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      moduleId: item.moduleId,
      group: item.group,
      badge: item.badge,
      count: item.counter === 'activeJails' ? (jailStats?.active ?? 0) : undefined,
    })),
  }));

  const titles = navigation.map((item) => ({
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
      logoUrl={brandingModule.brandingLogoUrl(brandingConfig, branding.logo.mark)}
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
