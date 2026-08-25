'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, Crown, LayoutGrid, Mic, Package, Settings, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PremiumSection, PremiumSectionIcon } from '@/modules/premium/sections';

/**
 * Bereichsnavigation des Premium-Moduls.
 *
 * In der Seitenleiste steht wie bei allen Modulen nur ein Eintrag; die
 * Unterseiten werden hier erreicht. Angezeigt wird nur, wofür die Berechtigung
 * vorliegt - jede Seite prüft zusätzlich serverseitig.
 */
const ICONS: Record<PremiumSectionIcon, LucideIcon> = {
  overview: LayoutGrid,
  subscriptions: Users,
  products: Package,
  payments: CreditCard,
  stuebli: Mic,
  settings: Settings,
  me: Crown,
} as const;

export function PremiumSectionNav({ sections }: { sections: PremiumSection[] }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Premium"
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
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
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
