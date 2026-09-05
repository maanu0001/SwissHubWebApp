'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from './nav-icon';
import { cn } from '@/lib/utils';

export interface NavigationEntry {
  href: string;
  label: string;
  icon: string;
  moduleId: string;
  group: string;
  /** Statisches Label rechts im Eintrag, z.B. `NEU`. */
  badge?: string;
  /** Zahl rechts im Eintrag - derzeit nur die offenen Tickets. */
  count?: number;
}

export interface NavigationGroup {
  id: string;
  label: string | null;
  items: NavigationEntry[];
}

/**
 * Das Label rechts im Navigationseintrag.
 *
 * Eine Zahl hat hier nur Platz, wenn sie vor dem Klick etwas beantwortet -
 * bei den Tickets: wartet dort Arbeit? Am Jail-Eintrag stand einmal die
 * Anzahl aller Strafen; die beantwortete keine solche Frage und liess die
 * Navigation bei jedem Seitenaufruf wackeln. Sie steht weiterhin im Modul,
 * wo sie hingehoert.
 *
 * Bei null erscheint nichts - eine Null neben einem Eintrag ist eine leere
 * Huelse, die man trotzdem jedes Mal liest.
 */
function ItemBadge({ entry }: { entry: NavigationEntry }): React.JSX.Element | null {
  if (typeof entry.count === 'number' && entry.count > 0) {
    return (
      <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-md bg-primary px-1.5 text-[0.7rem] font-semibold text-primary-foreground shadow-[0_0_12px_-2px_hsl(var(--primary-bright))]">
        {entry.count > 99 ? '99+' : entry.count}
      </span>
    );
  }
  if (entry.badge) {
    const highlight = entry.badge.toLowerCase() === 'neu';
    return (
      <span
        className={cn(
          'ml-auto rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
          highlight
            ? 'bg-primary/20 text-primary-bright ring-1 ring-primary/40'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {entry.badge}
      </span>
    );
  }
  return null;
}

/** Navigationsliste der Seitenleiste, gruppiert nach Bereichen. */
export function SidebarNav({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: NavigationGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
}): React.JSX.Element {
  const pathname = usePathname();

  /**
   * Genau ein Eintrag ist aktiv - der mit dem längsten passenden Pfad.
   *
   * Ohne diese Regel würde `/settings/branding` auch `/settings` markieren und
   * `/communication/history` zusätzlich `/communication`; die Seitenleiste
   * zeigte dann zwei aktive Punkte gleichzeitig.
   */
  const activeHref = useMemo(() => {
    const matches = groups
      .flatMap((group) => group.items)
      .map((item) => item.href)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length);
    return matches[0] ?? null;
  }, [groups, pathname]);

  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          {group.label && !collapsed ? (
            <p className="px-3 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              {group.label}
            </p>
          ) : null}

          {group.items.map((item) => {
            const active = item.href === activeHref;

            return (
              <Link
                key={`${item.moduleId}-${item.href}`}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                  collapsed && 'justify-center px-2',
                  active
                    ? 'bg-primary/15 text-foreground ring-1 ring-primary/45 shadow-[0_0_20px_-10px_hsl(var(--primary-bright))]'
                    : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                )}
              >
                <NavIcon
                  name={item.icon}
                  className={cn(
                    'size-[1.05rem] shrink-0 transition-colors',
                    active ? 'text-primary-bright' : 'text-muted-foreground group-hover:text-foreground',
                  )}
                />
                {collapsed ? null : (
                  <>
                    <span className="truncate">{item.label}</span>
                    <ItemBadge entry={item} />
                  </>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
