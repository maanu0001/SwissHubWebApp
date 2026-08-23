import { LogIn, CreditCard, MousePointerClick, Sparkles } from 'lucide-react';
import { isModuleEnabled, premium } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { PricingCards } from '@/modules/premium/components/pricing-cards';
import { ProductComparison } from '@/modules/premium/components/comparison';
import { PremiumFaq } from '@/modules/premium/components/faq';
import { getOptionalAuthContext } from '@/server/auth';

export const dynamic = 'force-dynamic';

const SCHRITTE = [
  { icon: LogIn, titel: 'Mit Discord anmelden', text: 'Dein bestehendes SwissHub-Konto genügt.' },
  { icon: MousePointerClick, titel: 'Premium auswählen', text: 'Drei Angebote, monatlich kündbar.' },
  { icon: CreditCard, titel: 'Mit TWINT bezahlen', text: 'Die Zahlung läuft über unseren Zahlungsanbieter.' },
  { icon: Sparkles, titel: 'Vorteile erhalten', text: 'Rolle und Stübli erscheinen automatisch auf Discord.' },
] as const;

/**
 * Die öffentliche Premium-Seite.
 *
 * Auch ohne Anmeldung erreichbar - wer noch nicht angemeldet ist, wird beim
 * Klick auf ein Angebot über den bestehenden Discord-Login geführt und landet
 * danach wieder genau bei diesem Angebot.
 */
export default async function PremiumPage(): Promise<React.JSX.Element> {
  const aktiv = await isModuleEnabled(premium.PREMIUM_MODULE_ID);
  if (!aktiv) {
    return (
      <EmptyState
        title="SwissHub Premium ist derzeit nicht verfügbar."
        description="Schau bitte später noch einmal vorbei."
      />
    );
  }

  const [produkte, context] = await Promise.all([
    premium.listActiveProducts(),
    getOptionalAuthContext(),
  ]);

  const laufendes = context?.user
    ? await premium.getActiveSubscription(context.user.id).catch(() => null)
    : null;
  const aktuellerSlug =
    laufendes && premium.grantsEntitlements(laufendes.status) ? laufendes.product.slug : null;

  return (
    <div className="space-y-14">
      <section className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">SwissHub Premium</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Unterstütze SwissHub und sichere dir exklusive Vorteile für unsere Community.
        </p>
      </section>

      {produkte.length === 0 ? (
        <EmptyState
          title="Noch keine Angebote"
          description="Die Angebote werden gerade eingerichtet."
        />
      ) : (
        <PricingCards
          products={produkte}
          highlightedSlug={premium.HIGHLIGHTED_SLUG}
          currentSlug={aktuellerSlug}
          loggedIn={Boolean(context?.isMember)}
        />
      )}

      <ProductComparison />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">So funktioniert es</h2>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SCHRITTE.map((schritt, index) => (
            <li key={schritt.titel} className="rounded-xl border border-border bg-card p-5">
              <span className="icon-chip mb-3 flex size-9 items-center justify-center [&_svg]:size-4">
                <schritt.icon aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold">
                {index + 1}. {schritt.titel}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{schritt.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <PremiumFaq />
    </div>
  );
}
