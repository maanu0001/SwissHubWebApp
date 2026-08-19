import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { BrandMark } from '@/components/shared/brand-mark';
import { BotStatusBadge } from '@/components/shared/status-badge';
import { PermissionProvider } from '@/components/shared/permission-guard';
import { SidebarNav, type NavigationEntry } from './sidebar-nav';
import { MobileNav } from './mobile-nav';
import { UserMenu, type UserMenuProps } from './user-menu';

interface AppShellProps {
  navigation: NavigationEntry[];
  permissions: string[];
  user: UserMenuProps;
  bot: { online: boolean; stale: boolean };
  children: React.ReactNode;
}

/**
 * Grundlayout: feste Sidebar auf Desktop, Drawer auf Mobile.
 */
export function AppShell({ navigation, permissions, user, bot, children }: AppShellProps): React.JSX.Element {
  return (
    <PermissionProvider permissions={permissions}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-border/70 bg-card/40 px-4 py-6 lg:flex">
          <Link
            href="/dashboard"
            className="rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark />
          </Link>
          <SidebarNav items={navigation} />
          <div className="mt-auto space-y-3 px-1">
            <BotStatusBadge online={bot.online} stale={bot.stale} />
            <p className="text-xs text-muted-foreground">
              {branding.name} &middot; Zeitzone {branding.timezone}
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2">
              <MobileNav items={navigation} />
              <span className="lg:hidden">
                <BrandMark size={30} withWordmark={false} />
              </span>
              <span className="hidden lg:block">
                <BotStatusBadge online={bot.online} stale={bot.stale} />
              </span>
            </div>
            <UserMenu {...user} />
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </PermissionProvider>
  );
}
