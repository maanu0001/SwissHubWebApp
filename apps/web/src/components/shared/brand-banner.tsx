import { branding } from '@swisshub/config/client';

/**
 * Markenbanner am Fuss des Dashboards.
 *
 * Rein visuelles Element: Name, Claim und das Logo der Anwendung. Das Logo ist
 * dasselbe zentrale Asset wie in Seitenleiste und Kopfzeile - ein im Dashboard
 * hochgeladenes hat Vorrang, sonst greift die mitgelieferte Datei. Bewusst nur
 * ein Bild: hier stand frueher zusaetzlich eine Roboterzeichnung, die den Bot
 * meinte und nicht die Anwendung.
 */
export function BrandBanner({
  footnote,
  logoUrl,
}: {
  footnote?: string;
  /** Hochgeladenes Logo; ohne Angabe das mitgelieferte SwissHub-Logo. */
  logoUrl?: string | null;
}): React.JSX.Element | null {
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
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {branding.banner.title}
          </p>
          <p className="truncate text-sm text-muted-foreground">{branding.banner.subtitle}</p>
          {footnote ? <p className="mt-1 truncate text-xs text-muted-foreground/80">{footnote}</p> : null}
        </div>

        {/*
          Quadratisch angelegt und mit `object-contain` gehalten: das Logo ist
          512x512, und eine feste Hoehe allein wuerde es bei einem spaeteren
          Austausch gegen ein breiteres Bild verzerren.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl ?? branding.logo.mark}
          alt=""
          width={512}
          height={512}
          className="size-14 shrink-0 object-contain opacity-90 sm:size-20"
        />
      </div>
    </section>
  );
}
