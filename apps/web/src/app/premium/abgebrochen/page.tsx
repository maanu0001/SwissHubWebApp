import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Zahlung abgebrochen' };

/** Der Checkout wurde beim Zahlungsanbieter abgebrochen. */
export default function PremiumCancelledPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-lg space-y-6 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning/15 text-warning">
        <CircleAlert className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Die Zahlung wurde nicht abgeschlossen.</h1>
        <p className="text-muted-foreground">
          Es wurde nichts belastet und kein Abonnement angelegt.
        </p>
      </div>
      <Link href="/premium" className={cn(buttonVariants())}>
        Erneut versuchen
      </Link>
    </div>
  );
}
