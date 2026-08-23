import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { isModuleEnabled, premium } from '@swisshub/modules';
import { formatChf } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/states';
import { CheckoutButton } from '@/modules/premium/components/checkout-button';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Checkout' };
export const dynamic = 'force-dynamic';

/**
 * Bestätigung vor der Zahlung.
 *
 * Wer nicht angemeldet ist, wird über den bestehenden Discord-Login geführt
 * und landet danach wieder genau hier - deshalb trägt die Weiterleitung das
 * gewählte Angebot mit.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;

  if (!(await isModuleEnabled(premium.PREMIUM_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="SwissHub Premium ist derzeit abgeschaltet." />;
  }

  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    redirect(`/login?redirect=${encodeURIComponent(`/premium/checkout/${slug}`)}`);
  }

  const produkt = await premium.getProductBySlug(slug);
  if (!produkt || !produkt.active) {
    return (
      <ErrorState
        title="Angebot nicht gefunden"
        description="Dieses Angebot steht nicht (mehr) zur Verfügung."
      />
    );
  }

  const laufend = await premium.getActiveSubscription(context.user.id);
  if (laufend && premium.grantsEntitlements(laufend.status)) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <ErrorState
          title="Du hast bereits ein laufendes Abonnement"
          description={`Aktuell läuft "${laufend.product.name}". Ein Wechsel ist möglich, sobald das laufende Abo endet.`}
        />
        <Link href="/premium/me" className={cn(buttonVariants())}>
          Zu meinem Abo
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/premium"
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-muted-foreground')}
      >
        <ArrowLeft aria-hidden="true" />
        Zurück zur Übersicht
      </Link>

      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{produkt.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{produkt.description}</p>

        <dl className="mt-5 space-y-2 border-y border-border/60 py-4 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Preis</dt>
            <dd className="font-semibold tabular-nums">{formatChf(produkt.priceMinor)} / Monat</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Abrechnung</dt>
            <dd>monatlich, jederzeit kündbar</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Konto</dt>
            <dd>@{context.user.username}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <CheckoutButton
            slug={produkt.slug}
            csrfToken={csrfTokenFor(context)}
            label="Weiter zur Zahlung"
          />
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Die Zahlung läuft über unseren Zahlungsanbieter. Deine Vorteile werden erst freigeschaltet,
          wenn dieser die Zahlung bestätigt hat.
        </p>
      </div>
    </div>
  );
}
