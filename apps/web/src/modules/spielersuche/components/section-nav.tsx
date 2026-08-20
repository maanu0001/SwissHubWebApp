'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Database,
  Gamepad2,
  LayoutDashboard,
  Megaphone,
  Plus,
  ScrollText,
  Settings,
  UserSearch,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bereichsnavigation der Spielersuche.
 *
 * In der Seitenleiste steht nur ein Eintrag; alle Unterseiten werden hier
 * erreicht. Gezeigt wird ausschliesslich, wofür die Berechtigung vorliegt -
 * jede Seite prüft zusätzlich serverseitig.
 */
export interface SpielersucheSection {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

const ICONS = {
  overview: LayoutDashboard,
  active: UserSearch,
  new: Plus,
  games: Gamepad2,
  stats: ScrollText,
  onboarding: Megaphone,
  history: ScrollText,
  import: Database,
  settings: Settings,
} as const;

export function SpielersucheSectionNav({ sections }: { sections: SpielersucheSection[] }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Spielersuche"
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-card/60 p-1"
    >
      {sections.map((section) => {
        const active = pathname === section.href;
        const Icon = ICONS[section.icon];
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/15 text-foreground ring-1 ring-primary/45'
                : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
