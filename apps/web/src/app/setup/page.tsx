import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { discord } from '@swisshub/discord';
import {
  branding as brandingModule,
  getGuildConfig,
  getSystemHealth,
  isDiscordAdministrator,
} from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { SetupWizard, type BotGuildOption } from '@/modules/configuration/components/setup-wizard';
import { csrfTokenFor, requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Einrichtung' };
export const dynamic = 'force-dynamic';

/**
 * Einrichtungsassistent.
 *
 * Zugang: solange die Einrichtung nicht abgeschlossen ist, genügt ein
 * Discord-Administrator - sonst käme der erste Administrator nie hinein.
 * Danach gilt ausschliesslich `settings.edit` aus dem Dashboard.
 */
export default async function SetupPage(): Promise<React.JSX.Element> {
  const context = await requireMember();
  const guild = await getGuildConfig();

  const hasDashboardAccess =
    context.user.isOwner ||
    context.permissionKeys.includes('settings.edit') ||
    context.permissionKeys.includes('admin.full');

  if (!hasDashboardAccess) {
    const allowed = guild.setupCompletedAt === null && (await isDiscordAdministrator(context.user.discordId));
    if (!allowed) {
      redirect('/403?permission=settings.edit');
    }
  }

  // Logo aus der Branding-Konfiguration; ohne Upload greift das Standardlogo.
  const logoUrl = brandingModule.brandingLogoUrl(
    await brandingModule.getBrandingConfig(),
    branding.logo.mark,
  );

  const [health, botGuilds] = await Promise.all([
    getSystemHealth(),
    discord.guild.listBotGuilds().catch(() => []),
  ]);

  const guilds: BotGuildOption[] = botGuilds.map((entry) => ({
    id: entry.id,
    name: entry.name,
    memberCount: entry.memberCount,
  }));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <BrandMark logoUrl={logoUrl} />
        <h1 className="text-2xl font-semibold">Einrichtung</h1>
        <p className="text-sm text-muted-foreground">
          In vier Schritten ist {branding.name} einsatzbereit. Die Konfiguration liegt vollständig in der
          Datenbank - für Änderungen muss später nichts neu gestartet werden.
        </p>
      </header>

      {guild.fromBootstrapEnv ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Es ist noch eine <code>DISCORD_GUILD_ID</code> gesetzt. Verbinde den Server hier einmal, danach kann
          die Umgebungsvariable entfallen.
        </p>
      ) : null}

      <SetupWizard
        csrfToken={csrfTokenFor(context)}
        guilds={guilds}
        connectedGuildId={guild.fromBootstrapEnv ? null : guild.guildId}
        steps={health.steps}
        completeness={health.completeness}
        setupComplete={health.setupComplete}
      />
    </main>
  );
}
