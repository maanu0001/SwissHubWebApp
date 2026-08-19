/**
 * Client-safe configuration.
 *
 * This entry point MUST NOT read server-side environment variables. It is
 * imported by React client components and therefore ends up in the browser
 * bundle. Only public/static values belong here.
 */

export const branding = {
  /** Product name shown in the sidebar, page titles and emails. */
  name: 'SwissHub',
  /** Sub title / product descriptor. */
  productName: 'Bot Control Center',
  /** Short description used for metadata. */
  description: 'Administrations- und Moderationsoberfläche für den SwissHub Discord-Server.',
  /**
   * Logo files. Drop a replacement at these paths to rebrand the app - no code
   * change required. If the file is missing, the app falls back to the
   * monogram defined below.
   */
  logo: {
    full: '/branding/logo.svg',
    mark: '/branding/logo-mark.svg',
    monogram: 'SH',
  },
  /** Primary accent colour of the SwissHub brand. */
  accent: '#83060a',
  /** Hellerer Rotton für Icons, Glows und Statusakzente. */
  accentBright: '#e63a41',
  /**
   * Hinweiskarte am unteren Rand der Seitenleiste.
   * `href: null` -> es wird auf den konfigurierten Discord-Server verlinkt.
   * `enabled: false` -> die Karte wird nicht gerendert.
   */
  promo: {
    enabled: true,
    title: 'SwissHub Premium',
    description: 'Unterstütze uns und erhalte exklusive Vorteile!',
    cta: 'Mehr erfahren',
    href: null as string | null,
  },
  /** Banner unterhalb des Dashboards. */
  banner: {
    enabled: true,
    title: 'SwissHub Bot Control Center',
    subtitle: 'Deine zentrale Verwaltung für SwissHub Bots',
    image: '/branding/banner.svg',
  },
  /** Locale + timezone used for all user facing date rendering. */
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  links: {
    discordInvite: null as string | null,
  },
} as const;

export type Branding = typeof branding;
