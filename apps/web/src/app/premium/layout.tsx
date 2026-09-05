import type { Metadata } from 'next';
import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'SwissHub Premium',
  description: 'Unterstütze SwissHub und sichere dir exklusive Vorteile für unsere Community.',
};

/**
 * Rahmen der öffentlichen Premium-Seiten.
 *
 * Bewusst ausserhalb der geschützten Routengruppe: die Shop-Seite muss auch
 * ohne Anmeldung erreichbar sein. Sie verwendet trotzdem dieselben Bausteine,
 * dieselbe Marke und dieselben Farben - es ist kein zweites Projekt, sondern
 * dieselbe Anwendung ohne Seitenleiste.
 */
export default async function PremiumLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([brandingModule.currentLogoUrl(), getOptionalAuthContext()]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="pointer-events-none absolute inset-0 bg-surface-gradient" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-8">
        <Link
          href="/premium"
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${branding.name} Premium`}
        >
          <BrandMark size={36} logoUrl={logoUrl} />
        </Link>

        <nav className="flex items-center gap-2">
          {context?.isMember ? (
            <>
              <Link href="/premium/me" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                Mein Abo
              </Link>
              <Link href="/dashboard" className={cn(buttonVariants({ size: 'sm' }))}>
                Zum Dashboard
              </Link>
            </>
          ) : (
            <Link href="/login?redirect=/premium" className={cn(buttonVariants({ size: 'sm' }))}>
              Mit Discord anmelden
            </Link>
          )}
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-8 sm:py-14">
        {children}
      </main>

      <footer className="relative z-10 border-t border-border px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        {branding.name} {branding.productName} · Preise in CHF inkl. allfälliger Abgaben
      </footer>
    </div>
  );
}
