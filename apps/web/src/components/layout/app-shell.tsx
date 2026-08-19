import { PermissionProvider } from '@/components/shared/permission-guard';
import { Sidebar } from './sidebar';
import { AppHeader, type HeaderTitle } from './app-header';
import type { NavigationGroup } from './sidebar-nav';
import type { ServerCardData } from './server-card';
import type { UserMenuProps } from './user-menu';

interface AppShellProps {
  groups: NavigationGroup[];
  titles: HeaderTitle[];
  permissions: string[];
  user: UserMenuProps;
  server: ServerCardData;
  bot: { online: boolean; wsPingMs: number | null };
  discordUrl: string;
  children: React.ReactNode;
}

/**
 * Grundlayout: feste Seitenleiste auf Desktop, Drawer auf Mobile,
 * Kopfzeile mit Seitentitel, Suche und Benutzerprofil.
 */
export function AppShell({
  groups,
  titles,
  permissions,
  user,
  server,
  bot,
  discordUrl,
  children,
}: AppShellProps): React.JSX.Element {
  return (
    <PermissionProvider permissions={permissions}>
      <div className="flex min-h-dvh">
        <Sidebar groups={groups} server={server} bot={bot} discordUrl={discordUrl} />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            titles={titles}
            groups={groups}
            user={user}
            canSearchMembers={permissions.includes('members.view') || permissions.includes('admin.full')}
          />

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1600px] space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </PermissionProvider>
  );
}
