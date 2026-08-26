/**
 * Die Bereiche des Jail-Moduls - als reine Daten.
 *
 * Bewusst ohne `server-only` und ohne JSX: gebaut wird die Liste auf dem
 * Server, gezeichnet von einer Client-Komponente.
 */
export interface JailSection {
  href: string;
  label: string;
}
