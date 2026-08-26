'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ModerationSection } from '@/modules/moderation/sections';
import { cn } from '@/lib/utils';

/**
 * Bereichsnavigation des Moderation Center.
 *
 * Die Seitenleiste fuehrt einmal in den Bereich; welche Unterseiten es dort
 * gibt, entscheidet die Berechtigung des Betrachters.
 */
export function ModerationSectionNav({
  sections,
}: {
  sections: ModerationSection[];
}): React.JSX.Element | null {
  const pfad = usePathname();

  // Bei einem einzigen Bereich gibt es nichts zu waehlen.
  if (sections.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Moderationsbereiche"
      className="-mx-1 flex gap-1 overflow-x-auto scrollbar-slim border-b border-border/60 px-1 pb-3"
    >
      {sections.map((section) => {
        const aktiv = pfad === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={aktiv ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-sm transition-colors',
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
