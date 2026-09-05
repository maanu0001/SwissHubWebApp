import type { Metadata } from 'next';
import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { LogoutButton } from '@/components/layout/logout-button';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Entbannungsantrag',
  description: 'Antrag auf erneute Prüfung einer Sanktion.',
};

/**
 * Der Rahmen des Antragstellerbereichs (§53).
 *
 * Bewusst ausserhalb der geschützten Routengruppe und ohne Seitenleiste. Wer
 * hier landet, ist gebannt: eine Navigation voller Bereiche, die er nicht
 * öffnen kann, wäre eine Liste seiner Ausschlüsse. Es gibt genau das, was er
 * braucht - seinen Antrag und den Weg hinaus.
 *
 * Dieselbe Marke, dieselben Bausteine, dieselben Farben wie überall sonst. Es
 * ist kein zweites Projekt, sondern dieselbe Anwendung ohne Seitenleiste -
 * genau wie der Premium-Bereich.
 */
export default async function EntbannungLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([brandingModule.currentLogoUrl(), getOptionalAuthContext()]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="pointer-events-none absolute inset-0 bg-surface-gradient" aria-hidden="true" />

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-8">
        <Link
          href="/entbannung"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandMark size={32} withWordmark={false} logoUrl={logoUrl} />
          <span className="text-sm font-semibold">{branding.name} · Entbannungsantrag</span>
        </Link>
        {context ? <LogoutButton csrfToken={csrfTokenFor(context)} variant="outline" /> : null}
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        {children}
      </main>

      <footer className="relative z-10 border-t border-border px-4 py-4 text-center text-xs text-muted-foreground sm:px-8">
        Ein Antrag wird von Menschen geprüft. Das dauert einige Tage.
      </footer>
    </div>
  );
}
