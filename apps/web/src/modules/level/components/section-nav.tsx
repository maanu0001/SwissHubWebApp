'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Database,
  Dice5,
  IdCard,
  Ticket,
  Gauge,
  LayoutDashboard,
  Mic,
  Moon,
  Settings,
  Shield,
  Trophy,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bereichsnavigation des Level-Systems.
 *
 * In der Seitenleiste steht nur ein Eintrag; alle Unterseiten werden hier
 * erreicht. Gezeigt wird ausschliesslich, wofür die Berechtigung vorliegt -
 * jede Seite prüft zusätzlich serverseitig.
 */
export interface LevelSection {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

const ICONS = {
  overview: LayoutDashboard,
  members: Users,
  leaderboard: Trophy,
  games: Dice5,
  roles: Shield,
  rules: Gauge,
  voice: Mic,
  card: IdCard,
  raffle: Ticket,
  decay: Moon,
  stats: LayoutDashboard,
  import: Database,
  settings: Settings,
} as const;

export function LevelSectionNav({ sections }: { sections: LevelSection[] }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Level-System"
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
