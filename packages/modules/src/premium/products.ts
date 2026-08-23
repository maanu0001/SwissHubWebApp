import { prisma } from '@swisshub/database';
import type { PremiumEntitlement, PremiumProduct } from '@swisshub/database';

/**
 * Die drei Standardangebote.
 *
 * Sie sind Startwerte, keine feste Verdrahtung: gespeichert wird in der
 * Datenbank, und die Verwaltung darf Namen, Preise und Vorteile aendern, ohne
 * dass dafuer jemand die Anwendung neu ausliefern muss. Der Seed legt nur an,
 * was noch fehlt - er ueberschreibt niemals eine gepflegte Angabe.
 */
export interface ProductSeed {
  slug: string;
  name: string;
  description: string;
  priceMinor: number;
  features: string[];
  entitlements: PremiumEntitlement[];
  sortOrder: number;
}

export const PRODUCT_SEEDS: readonly ProductSeed[] = [
  {
    slug: 'premium',
    name: 'Premium',
    description: 'Werde Premium-Mitglied der SwissHub Community.',
    priceMinor: 500,
    features: [
      'Premium Discord-Rolle',
      'Zugriff auf Premium-Vorteile',
      'Zukünftige Premium-Funktionen',
      'Sichtbare Premium-Mitgliedschaft auf Discord',
    ],
    entitlements: ['PREMIUM_ROLE'],
    sortOrder: 10,
  },
  {
    slug: 'premium-stuebli',
    name: 'Premium-Stübli',
    description: 'Miete dir dein eigenes Premium-Stübli auf SwissHub.',
    priceMinor: 800,
    features: [
      'Premium-Stübli Discord-Rolle',
      'Eigener dauerhafter Sprachkanal',
      'Kanal wird automatisch erstellt',
      'Rechte im eigenen Kanal',
      'Automatische Discord-Synchronisation',
    ],
    entitlements: ['PREMIUM_STUEBLI_ROLE', 'PRIVATE_VOICE'],
    sortOrder: 20,
  },
  {
    slug: 'premium-bundle',
    name: 'Premium-Bundle',
    description: 'Premium und dein eigenes Premium-Stübli in einem Bundle.',
    priceMinor: 1000,
    features: [
      'Premium Discord-Rolle',
      'Premium-Stübli Discord-Rolle',
      'Sämtliche Premium-Vorteile',
      'Persönlicher Sprachkanal',
      'Rechte im eigenen Kanal',
      'Automatische Synchronisation',
    ],
    entitlements: ['PREMIUM_ROLE', 'PREMIUM_STUEBLI_ROLE', 'PRIVATE_VOICE'],
    sortOrder: 30,
  },
];

/** Das hervorgehobene Angebot auf der oeffentlichen Seite. */
export const HIGHLIGHTED_SLUG = 'premium-bundle';

/**
 * Legt fehlende Standardangebote an.
 *
 * Bewusst `create` statt `upsert`: ein bereits gepflegtes Angebot soll ein
 * Neustart nicht auf die Startwerte zuruecksetzen.
 */
export async function seedProducts(): Promise<number> {
  // `createMany` mit `skipDuplicates` statt Lesen-dann-Schreiben: der Seed
  // laeuft im Abgleich jeder Bot-Instanz, und zwei gleichzeitige Laeufe
  // duerfen sich nicht gegenseitig in die Eindeutigkeit des Slugs treiben.
  // Ein bereits gepflegtes Angebot bleibt unberuehrt - es wird nie
  // ueberschrieben, nur Fehlendes ergaenzt.
  const { count } = await prisma.premiumProduct.createMany({
    data: PRODUCT_SEEDS.map((seed) => ({
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      priceMinor: seed.priceMinor,
      currency: 'CHF',
      features: seed.features,
      entitlements: seed.entitlements,
      sortOrder: seed.sortOrder,
      active: true,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** Angebote fuer die oeffentliche Seite. */
export async function listActiveProducts(): Promise<PremiumProduct[]> {
  return prisma.premiumProduct.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }],
  });
}

/** Alle Angebote, auch abgeschaltete - fuer die Verwaltung. */
export async function listAllProducts(): Promise<PremiumProduct[]> {
  return prisma.premiumProduct.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] });
}

export async function getProductBySlug(slug: string): Promise<PremiumProduct | null> {
  return prisma.premiumProduct.findUnique({ where: { slug } });
}

/** Die Merkmale eines Angebots als Liste - `features` ist ein JSON-Feld. */
export function productFeatures(product: Pick<PremiumProduct, 'features'>): string[] {
  return Array.isArray(product.features) ? product.features.filter((f): f is string => typeof f === 'string') : [];
}
