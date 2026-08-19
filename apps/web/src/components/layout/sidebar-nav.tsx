'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from './nav-icon';
import { cn } from '@/lib/utils';

export interface NavigationEntry {
  href: string;
  label: string;
  icon: string;
  moduleId: string;
}

export function SidebarNav({
  items,
  onNavigate,
}: {
  items: NavigationEntry[];
  onNavigate?: () => void;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <NavIcon
              name={item.icon}
              className={cn('size-4 transition-colors', active ? 'text-primary' : 'text-muted-foreground')}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
