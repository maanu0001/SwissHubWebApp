import { branding } from '@swisshub/config/client';
import { cn } from '@/lib/utils';

/**
 * Zentrale Marken-Darstellung.
 *
 * Ein spaeteres SwissHub-Logo wird einfach unter `public/branding/logo.svg`
 * bzw. `public/branding/logo-mark.svg` abgelegt - Codeaenderungen sind dafuer
 * nicht noetig. Farben und Namen kommen aus `@swisshub/config/client`.
 */
export function BrandMark({
  size = 36,
  withWordmark = true,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ring-primary/40"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={branding.logo.mark} alt={`${branding.name} Logo`} width={size} height={size} />
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
