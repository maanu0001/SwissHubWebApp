import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { cn } from '@/lib/utils';

const CTA_KLASSEN =
  'mt-2.5 inline-flex min-h-8 w-full items-center justify-center rounded-lg bg-accent-gradient px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Hinweiskarte am Fuss der Seitenleiste.
 *
 * Inhalt und Ziel kommen aus `branding.promo` (`packages/config/src/client.ts`).
 * Ohne konfiguriertes Ziel wird kein Button gerendert - es gibt bewusst keine
 * Schaltfläche ohne Funktion.
 */
export interface PremiumHinweis {
  /** Name des laufenden Angebots - `null`, wenn keines laeuft. */
  planName: string | null;
}

export function PromoCard({
  href,
  premium,
  className,
}: {
  href?: string | null;
  /**
   * Zustand des Premium-Moduls.
   *
   * Ist es eingeschaltet, fuehrt die Karte auf `/premium` - und zwar mit einem
   * Text, der zum Mitglied passt: wer bereits abonniert hat, braucht keine
   * Werbung, sondern den Weg zur Verwaltung. Ohne Premium-Modul bleibt es bei
   * der bisherigen Karte mit dem Discord-Verweis.
   */
  premium?: PremiumHinweis | null;
  className?: string;
}): React.JSX.Element | null {
  const promo = branding.promo;
  if (!promo.enabled) {
    return null;
  }

  // Premium hat Vorrang: es ist der Grund, warum es diese Karte gibt.
  const premiumAktiv = premium !== null && premium !== undefined;
  const target = premiumAktiv ? '/premium' : (promo.href ?? href ?? null);
  const titel = promo.title;
  const text = premiumAktiv
    ? (premium.planName ?? promo.description)
    : promo.description;
  const cta = premiumAktiv && premium.planName ? 'Abo verwalten' : promo.cta;
  const zielIstIntern = target?.startsWith('/') ?? false;

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
        <p className="text-sm font-semibold">{titel}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
        {target ? (
          zielIstIntern ? (
            // Interne Ziele über den Router - ein Vollreload wäre hier falsch.
            <Link href={target} className={CTA_KLASSEN}>
              {cta}
            </Link>
          ) : (
            <a href={target} target="_blank" rel="noreferrer noopener" className={CTA_KLASSEN}>
              {cta}
            </a>
          )
        ) : null}
      </div>
    </div>
  );
}
