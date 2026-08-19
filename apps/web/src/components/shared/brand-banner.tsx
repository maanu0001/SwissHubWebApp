import { branding } from '@swisshub/config/client';

/**
 * Markenbanner am Fuss des Dashboards.
 *
 * Rein visuelles Element: Logo, Claim und - falls vorhanden - die Grafik unter
 * `public/branding/banner.svg`. Austausch ohne Codeänderung möglich.
 */
export function BrandBanner({ footnote }: { footnote?: string }): React.JSX.Element | null {
  if (!branding.banner.enabled) {
    return null;
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_200px_at_15%_120%,hsl(var(--primary)/0.25),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-between gap-6 px-6 py-6 sm:px-8">
        <div className="flex min-w-0 items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logo.mark}
            alt=""
            width={56}
            height={56}
            className="hidden size-14 shrink-0 sm:block"
          />
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {branding.banner.title}
            </p>
            <p className="truncate text-sm text-muted-foreground">{branding.banner.subtitle}</p>
            {footnote ? <p className="mt-1 truncate text-xs text-muted-foreground/80">{footnote}</p> : null}
          </div>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.banner.image}
          alt=""
          width={140}
          height={100}
          className="hidden h-24 w-auto shrink-0 opacity-90 md:block"
        />
      </div>
    </section>
  );
}
