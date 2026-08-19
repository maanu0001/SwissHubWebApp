import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  /** Basis-URL inklusive bestehender Filter (ohne `page`). */
  buildHref(page: number): string;
}

/** Serverseitige Paginierung - es werden nie alle Datensaetze geladen. */
export function Pagination({ page, totalPages, total, buildHref }: PaginationProps): React.JSX.Element {
  return (
    <nav className="flex items-center justify-between gap-4 pt-2" aria-label="Seitennavigation">
      <p className="text-xs text-muted-foreground">
        Seite {page} von {totalPages} &middot; {total} Eintraege
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            rel="prev"
          >
            <ChevronLeft aria-hidden="true" />
            Zurueck
          </Link>
        ) : (
          <span
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'pointer-events-none opacity-40',
            )}
          >
            <ChevronLeft aria-hidden="true" />
            Zurueck
          </span>
        )}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            rel="next"
          >
            Weiter
            <ChevronRight aria-hidden="true" />
          </Link>
        ) : (
          <span
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'pointer-events-none opacity-40',
            )}
          >
            Weiter
            <ChevronRight aria-hidden="true" />
          </span>
        )}
      </div>
    </nav>
  );
}
