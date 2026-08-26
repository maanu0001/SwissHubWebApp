/**
 * Die Bereiche des Analytics-Moduls - als reine Daten.
 *
 * Ohne `server-only` und ohne JSX: gebaut wird die Liste auf dem Server,
 * gezeichnet von einer Client-Komponente. Dieselbe Aufteilung wie bei Jail
 * und Moderation.
 */
export interface AnalyticsSection {
  href: string;
  label: string;
}
