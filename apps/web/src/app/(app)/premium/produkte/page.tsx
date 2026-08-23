import type { Metadata } from 'next';
import { premium } from '@swisshub/modules';
import { formatChf } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { ProductEditor } from '@/modules/premium/components/product-editor';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { premiumSections } from '@/server/premium';

export const metadata: Metadata = { title: 'Angebote' };
export const dynamic = 'force-dynamic';

/**
 * Angebotsverwaltung.
 *
 * Preise stehen in der Datenbank, nicht im Code - eine Preisänderung braucht
 * kein Deployment. Die Ansprüche sind dagegen eine feste Auswahl: freie
 * Eingabe von Discord-Berechtigungen gäbe es hier sonst als Hintertür.
 */
export default async function PremiumProductsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(premium.PREMIUM_PERMISSIONS.productsManage);
  const produkte = await premium.listAllProducts();

  return (
    <>
      <PremiumSectionNav sections={premiumSections(context)} />

      {produkte.length === 0 ? (
        <EmptyState title="Keine Angebote" description="Es sind noch keine Angebote angelegt." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {produkte.map((produkt) => (
            <article key={produkt.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{produkt.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">/{produkt.slug}</p>
                </div>
                <Badge variant={produkt.active ? 'success' : 'secondary'}>
                  {produkt.active ? 'Aktiv' : 'Abgeschaltet'}
                </Badge>
              </header>

              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {formatChf(produkt.priceMinor)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ Monat</span>
              </p>

              <ul className="mt-3 flex flex-wrap gap-1.5">
                {produkt.entitlements.map((anspruch) => (
                  <li key={anspruch}>
                    <Badge variant="secondary">{premium.ENTITLEMENT_LABEL[anspruch]}</Badge>
                  </li>
                ))}
              </ul>

              {!produkt.providerPriceId ? (
                <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  Keine Preis-ID des Zahlungsanbieters hinterlegt - ein Checkout ist damit nicht möglich.
                </p>
              ) : null}

              <div className="mt-4 flex-1" />
              <ProductEditor
                csrfToken={csrfTokenFor(context)}
                product={{
                  id: produkt.id,
                  name: produkt.name,
                  description: produkt.description,
                  priceMinor: produkt.priceMinor,
                  features: premium.productFeatures(produkt),
                  entitlements: produkt.entitlements,
                  active: produkt.active,
                  sortOrder: produkt.sortOrder,
                  providerPriceId: produkt.providerPriceId,
                }}
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
