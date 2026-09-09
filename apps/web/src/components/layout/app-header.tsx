'use client';

import { usePathname } from 'next/navigation';
import { UserMenu, type UserMenuProps } from './user-menu';
import { MobileNav } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { BrandMark } from '@/components/shared/brand-mark';
import type { NavigationGroup } from './sidebar-nav';

export interface HeaderTitle {
  href: string;
  label: string;
  description?: string;
}

interface AppHeaderProps {
  titles: HeaderTitle[];
  groups: NavigationGroup[];
  user: UserMenuProps;
  canSearchMembers: boolean;
  logoUrl: string;
}

/**
 * Kopfzeile: Seitentitel (aus der Module Registry abgeleitet), Schnellsuche
 * und Benutzerprofil. Der Titel kommt aus der Route - dadurch muss ihn keine
 * Seite doppelt pflegen.
 *
 * Hier stand ein Eingabefeld für die Mitgliedersuche, und es hatte `⌘K` für
 * sich. Zwei Dinge waren daran schief: die Tastenkombination gehörte einer
 * einzelnen Funktion statt der Navigation, und wer den Mitgliederbereich
 * nicht sehen durfte, hatte gar keine - für ihn tat `⌘K` nichts.
 *
 * Jetzt öffnet `⌘K` die Schnellnavigation, und die Mitgliedersuche steht
 * darin als erster Vorschlag, sobald man tippt - auf derselben Adresse wie
 * zuvor und weiterhin nur für Berechtigte.
 */
export function AppHeader({
  titles,
  groups,
  user,
  canSearchMembers,
  logoUrl,
}: AppHeaderProps): React.JSX.Element {
  const pathname = usePathname();

  const current = titles
    .filter((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <header className="sticky top-0 z-30 flex min-h-[4.5rem] items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2 lg:hidden">
        <MobileNav groups={groups} logoUrl={logoUrl} />
        <BrandMark size={30} withWordmark={false} logoUrl={logoUrl} />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl" title={current?.label}>
          {current?.label ?? 'SwissHub'}
        </h1>
        {current?.description ? (
          <p className="hidden truncate text-sm text-muted-foreground sm:block" title={current.description}>
            {current.description}
          </p>
        ) : null}
      </div>

      <CommandPalette groups={groups} canSearchMembers={canSearchMembers} />

      <UserMenu {...user} />
    </header>
  );
}
