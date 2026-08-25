/**
 * Die Bereiche des Premium-Moduls - als reine Daten.
 *
 * Bewusst eine eigene Datei ohne `server-only` und ohne JSX: die Liste wird
 * auf dem Server gebaut und von einer Client-Komponente gezeichnet. Läge der
 * Typ bei der Komponente, hinge der Server-Helfer an einer `.tsx`; läge er
 * beim Server-Helfer, zöge die Komponente `server-only` herein. Beides ginge
 * eine Weile gut und stünde irgendwann im Weg.
 */
export type PremiumSectionIcon =
  | 'me'
  | 'overview'
  | 'subscriptions'
  | 'products'
  | 'payments'
  | 'stuebli'
  | 'settings';

export interface PremiumSection {
  href: string;
  label: string;
  icon: PremiumSectionIcon;
}
