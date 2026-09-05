import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { premium } from '@swisshub/modules';
import { getOptionalAuthContext } from '@/server/auth';
import { MockPayButton } from '@/modules/premium/components/mock-pay-button';

export const metadata: Metadata = { title: 'Testzahlung' };
export const dynamic = 'force-dynamic';

/**
 * Ersatz fuer die Bezahlseite des Anbieters - nur in der Entwicklung.
 *
 * Sie verhaelt sich bewusst wie der echte Anbieter: der Knopf loest ein
 * signiertes Ereignis an den Webhook aus. Die Seite selbst schaltet nichts
 * frei. Waere das anders, funktionierte der Ablauf lokal und in Production
 * nicht - und genau das faellt dann erst beim Kunden auf.
 */
export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ abo?: string }>;
}): Promise<React.JSX.Element> {
  const provider = premium.resolvePaymentProvider();
  if (provider.productionReady) {
    // Kein Mock-Anbieter aktiv: diese Seite gibt es dann nicht.
    notFound();
  }

  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    redirect('/login?redirect=/premium');
  }

  const { abo } = await searchParams;
  if (!abo) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-md space-y-6 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning/15 text-warning">
        <FlaskConical className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Testzahlung</h1>
        <p className="text-sm text-muted-foreground">
          Der Mock-Zahlungsanbieter ist aktiv. Es fliesst kein Geld. In Production ist dieser Anbieter nicht
          zugelassen - dort steht hier die Bezahlseite mit TWINT.
        </p>
      </div>
      <MockPayButton subscriptionId={abo} />
    </div>
  );
}
