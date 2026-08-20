import { branding } from '@swisshub/config/client';
import { cn } from '@/lib/utils';

/**
 * Zentrale Marken-Darstellung.
 *
 * `logoUrl` kommt aus der Branding-Konfiguration (Dashboard-Upload). Ohne
 * eigenes Logo greift die mitgelieferte Datei aus `public/branding/`.
 * Farben und Namen kommen aus `@swisshub/config/client`.
 */
export function BrandMark({
  size = 36,
  withWordmark = true,
  logoUrl,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  /** Übersteuert das Standardlogo (hochgeladenes Logo inkl. Cache-Busting). */
  logoUrl?: string | null;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ring-primary/40"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl ?? branding.logo.mark}
          alt={`${branding.name} Logo`}
          width={size}
          height={size}
          className="size-full object-contain"
        />
      </span>
      {withWordmark ? (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">{branding.name}</span>
          <span className="text-xs text-muted-foreground">{branding.productName}</span>
        </span>
      ) : null}
    </span>
  );
}
