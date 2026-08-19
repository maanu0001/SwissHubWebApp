import { branding } from '@swisshub/config/client';
import { cn } from '@/lib/utils';

/**
 * Hinweiskarte am Fuss der Seitenleiste.
 *
 * Inhalt und Ziel kommen aus `branding.promo` (`packages/config/src/client.ts`).
 * Ohne konfiguriertes Ziel wird kein Button gerendert - es gibt bewusst keine
 * Schaltfläche ohne Funktion.
 */
export function PromoCard({
  href,
  className,
}: {
  href?: string | null;
  className?: string;
}): React.JSX.Element | null {
  const promo = branding.promo;
  if (!promo.enabled) {
    return null;
  }

  const target = promo.href ?? href ?? null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-primary/30 bg-promo-gradient p-3.5 shadow-[0_0_30px_-18px_hsl(var(--primary-bright))]',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-primary/25 blur-2xl"
        aria-hidden="true"
      />
      <div className="relative space-y-1.5">
        <p className="text-sm font-semibold">{promo.title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{promo.description}</p>
        {target ? (
          <a
            href={target}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2.5 inline-flex w-full items-center justify-center rounded-lg bg-accent-gradient px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {promo.cta}
          </a>
        ) : null}
      </div>
    </div>
  );
}
