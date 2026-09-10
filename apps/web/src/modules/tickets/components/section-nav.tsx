'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { teileBereiche, type TicketSection } from './bereiche';

export type { TicketSection };

/**
 * Die Kopfzeile des Ticket-Moduls.
 *
 * Links die Bereiche, in denen man arbeitet; rechts ein Zahnrad mit denen,
 * die das Modul einstellen. Vorher standen alle zwoelf nebeneinander und
 * sahen gleich wichtig aus - «Panels» so gross wie «Offene Tickets».
 *
 * Weggefallen ist keiner: das Zahnrad ist ein zweiter Platz in derselben
 * Zeile, kein Versteck. Wer gerade auf einer Einrichtungsseite steht, sieht
 * das am Zahnrad selbst - sonst waere man an einer Stelle, die die Navigation
 * nicht mehr anzeigt.
 */
export function TicketSectionNav({ sections }: { sections: TicketSection[] }): React.JSX.Element {
  const pfad = usePathname();
  const { arbeit, einrichtung } = teileBereiche(sections);
  const inEinrichtung = einrichtung.some((section) => pfad === section.href);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
      <nav aria-label="Ticket-Bereiche" className="flex flex-wrap gap-1">
        {arbeit.map((section) => {
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

      {einrichtung.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Einrichtung"
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              inEinrichtung
                ? 'bg-primary/15 font-medium text-primary-bright'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
            Einrichtung
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Einrichtung</DropdownMenuLabel>
            {einrichtung.map((section) => (
              <DropdownMenuItem key={section.href} asChild>
                <Link href={section.href} aria-current={pfad === section.href ? 'page' : undefined}>
                  {section.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
