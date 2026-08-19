import { env } from '@swisshub/config';
import { buildNavigation, enabledModuleIds, readBotStatus } from '@swisshub/modules';
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
 * Geschuetztes Grundlayout.
 *
 * Der Zugriff wird hier serverseitig geprueft; die Navigation entsteht aus der
 * Module Registry und den effektiven Berechtigungen.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const context = await requireMember();
  const [moduleIds, bot] = await Promise.all([enabledModuleIds(), readBotStatus()]);
  const navigation = buildNavigation(context.permissionKeys, moduleIds);

  return (
    <AppShell
      navigation={navigation.map((item) => ({
        href: item.href,
        label: item.label,
        icon: item.icon,
        moduleId: item.moduleId,
      }))}
      permissions={context.permissionKeys}
      bot={{ online: bot.online, stale: bot.stale }}
      user={{
        discordId: context.user.discordId,
        displayName: context.user.displayName,
        username: context.user.username,
        avatarHash: context.user.avatarHash,
        primaryRole: APP_ROLE_LABEL[context.user.appRole] ?? 'Mitglied',
        csrfToken: csrfTokenFor(context),
        guildId: env.DISCORD_GUILD_ID,
      }}
    >
      {children}
    </AppShell>
  );
}
