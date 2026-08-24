'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface TournamentSection {
  href: string;
  label: string;
}

/** Die Bereiche der Turnierverwaltung - dieselbe Leiste auf jeder Unterseite. */
export function TournamentSectionNav({ sections }: { sections: TournamentSection[] }): React.JSX.Element {
  const pfad = usePathname();

  return (
    <nav aria-label="Turnier-Bereiche" className="flex flex-wrap gap-1 border-b border-border/60 pb-3">
      {sections.map((section) => {
        const aktiv = pfad === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={aktiv ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-9 items-center rounded-lg px-3 text-sm transition-colors',
              aktiv
                ? 'bg-primary/15 font-medium text-primary-bright'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
