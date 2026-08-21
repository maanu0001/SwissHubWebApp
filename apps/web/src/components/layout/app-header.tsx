'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { UserMenu, type UserMenuProps } from './user-menu';
import { MobileNav } from './mobile-nav';
import { BrandMark } from '@/components/shared/brand-mark';
import { cn } from '@/lib/utils';
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
 * Kopfzeile: Seitentitel (aus der Module Registry abgeleitet), Suche und
 * Benutzerprofil. Der Titel kommt aus der Route - dadurch muss ihn keine Seite
 * doppelt pflegen.
 */
export function AppHeader({
  titles,
  groups,
  user,
  canSearchMembers,
  logoUrl,
}: AppHeaderProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const current = titles
    .filter((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = searchRef.current?.value.trim() ?? '';
    router.push(value ? `/members?q=${encodeURIComponent(value)}` : '/members');
  }

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

      {canSearchMembers ? (
        <form onSubmit={handleSubmit} role="search" className="hidden md:block">
          <label htmlFor="global-search" className="sr-only">
            Mitglieder suchen
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="global-search"
              ref={searchRef}
              name="q"
              type="search"
              placeholder="Mitglied oder Discord-ID suchen"
              autoComplete="off"
              className={cn(
                'h-10 w-64 rounded-lg border border-border bg-card/70 pl-9 pr-14 text-sm outline-none transition-colors',
                'placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50 lg:w-72',
              )}
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground lg:block">
              ⌘K
            </kbd>
          </div>
        </form>
      ) : null}

      <UserMenu {...user} />
    </header>
  );
}
