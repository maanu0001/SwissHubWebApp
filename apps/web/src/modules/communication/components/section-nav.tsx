'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Megaphone, ScrollText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bereichsnavigation innerhalb des Kommunikationsmoduls.
 *
 * In der Seitenleiste steht nur ein Eintrag pro Modul; die Unterseiten
 * (Verlauf, Einstellungen) werden hier erreicht. Angezeigt wird nur, wofür die
 * Berechtigung vorliegt - die Seiten selbst prüfen zusätzlich serverseitig.
 */
export interface CommunicationSection {
  href: string;
  label: string;
  icon: 'compose' | 'history' | 'settings';
}

const ICONS = {
  compose: Megaphone,
  history: ScrollText,
  settings: Settings,
} as const;

export function CommunicationSectionNav({
  sections,
}: {
  sections: CommunicationSection[];
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Kommunikation"
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
