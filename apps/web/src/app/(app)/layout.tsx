import { branding } from '@swisshub/config/client';
import { discord } from '@swisshub/discord';
import { guildIconUrl } from '@swisshub/discord/cdn';
import {
  branding as brandingModule,
  buildNavigation,
  moduleViewPermission,
  enabledModuleIds,
  getGuildConfig,
  groupNavigation,
  premium as premiumModule,
  readBotStatus,
  tickets as ticketsModule,
} from '@swisshub/modules';
import { dashboardRoleLabel } from '@swisshub/permissions';
import { AppShell } from '@/components/layout/app-shell';
import { csrfTokenFor, hasSetupAccess, requireMember } from '@/server/auth';
import { ticketViewer } from '@/server/tickets';

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

  const [moduleIds, bot, guild, guildConfig, logoUrl] = await Promise.all([
    enabledModuleIds(),
    readBotStatus(),
    discord.guild.get().catch(() => null),
    getGuildConfig(),
    brandingModule.currentLogoUrl(),
  ]);

  /**
   * Offene Tickets fuer die Zahl neben dem Eintrag.
   *
   * Nur, wenn das Modul laeuft, und faellt die Abfrage aus, bleibt die Zahl
   * weg: eine Seitenleiste, die an einer Zaehlung scheitert, waere ein teurer
   * Preis fuer eine Nebensaechlichkeit.
   */
  const offeneTickets = moduleIds.has(ticketsModule.TICKETS_MODULE_ID)
    ? await ticketsModule.countOpenTickets(ticketViewer(context)).catch(() => null)
    : null;

  /**
   * Zustand für die Hinweiskarte in der Seitenleiste.
   *
   * Ist Premium eingeschaltet, führt die Karte auf `/premium`; wer bereits
   * abonniert hat, sieht dort sein Angebot statt einer Werbung. Ist das Modul
   * aus, bleibt die Karte unverändert.
   */
  const premiumKarte = moduleIds.has(premiumModule.PREMIUM_MODULE_ID)
    ? await premiumModule
        .getActiveSubscription(context.user.id)
        .then((abo) => ({
          planName: abo && premiumModule.grantsEntitlements(abo.status) ? `${abo.product.name} aktiv` : null,
        }))
        .catch(() => ({ planName: null }))
    : null;

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
  const dashboardLabel = await dashboardRoleLabel(context.roleIds).catch(() => null);
  const navigationKeys = setupAccess
    ? [
        ...new Set([
          ...context.permissionKeys,
          'settings.view',
          'permissions.manage',
          'modules.manage',
          // Ohne «Modul sehen» blieben die Konfigurationsbereiche trotz der
          // Ergaenzung oben unsichtbar - und die Einrichtung liesse sich
          // nicht abschliessen.
          moduleViewPermission('settings'),
          moduleViewPermission('modules'),
        ]),
      ]
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
      count: item.counter === 'openTickets' ? (offeneTickets ?? undefined) : undefined,
    })),
  }));

  const titles = navigation.flatMap((item) => [
    { href: item.href, label: item.label, description: item.description },
    // Ein Modul kann einen weiteren Pfad beanspruchen (siehe `titlePrefix`).
    // Die Kopfzeile nimmt den laengsten Treffer, der genauere Eintrag oben
    // gewinnt also weiterhin.
    ...(item.titlePrefix
      ? [{ href: item.titlePrefix, label: item.label, description: item.description }]
      : []),
  ]);

  return (
    <AppShell
      groups={groups}
      titles={titles}
      permissions={context.permissionKeys}
      bot={{ online: bot.online, wsPingMs: bot.wsPingMs }}
      discordUrl={guildId ? `https://discord.com/channels/${guildId}` : 'https://discord.com/channels/@me'}
      logoUrl={logoUrl}
      premium={premiumKarte}
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
        // Die «Bezeichnung im Dashboard» aus dem Berechtigungsmodul - dort
        // wird sie gepflegt, hier nur gelesen. Fehlt sie, bleibt es bei der
        // groben Einordnung.
        primaryRole: dashboardLabel ?? APP_ROLE_LABEL[context.user.appRole] ?? 'Mitglied',
        csrfToken: csrfTokenFor(context),
        guildId: guildId ?? '',
      }}
    >
      {children}
    </AppShell>
  );
}
