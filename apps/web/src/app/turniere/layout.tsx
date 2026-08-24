import type { Metadata } from 'next';
import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Turniere',
  description: 'Turniere der SwissHub-Community: Anmeldung, Brackets, Resultate.',
};

/**
 * Rahmen der öffentlichen Turnierseiten.
 *
 * Wie beim Premium-Shop bewusst ausserhalb der geschützten Routengruppe: eine
 * Turnierseite, die man nicht teilen kann, weil der Link zum Login führt, ist
 * keine Turnierseite. Dieselbe Anwendung, dieselbe Marke, nur ohne
 * Seitenleiste - kein zweites Frontend.
 */
export default async function TurniereLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([
    brandingModule.currentLogoUrl(),
    getOptionalAuthContext(),
  ]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="pointer-events-none absolute inset-0 bg-surface-gradient" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-8">
        <Link
          href="/turniere"
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${branding.name} Turniere`}
        >
          <BrandMark size={36} logoUrl={logoUrl} />
        </Link>

        <nav className="flex items-center gap-2">
          {context?.isMember ? (
            <Link href="/dashboard" className={cn(buttonVariants({ size: 'sm' }))}>
              Zum Dashboard
            </Link>
          ) : (
            <Link href="/login?redirect=/turniere" className={cn(buttonVariants({ size: 'sm' }))}>
              Mit Discord anmelden
            </Link>
          )}
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-8 sm:py-14">
        {children}
      </main>

      <footer className="relative z-10 border-t border-border px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        {branding.name} {branding.productName} · Turniere
      </footer>
    </div>
  );
}
