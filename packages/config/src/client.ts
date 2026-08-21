/**
 * Client-safe configuration.
 *
 * This entry point MUST NOT read server-side environment variables. It is
 * imported by React client components and therefore ends up in the browser
 * bundle. Only public/static values belong here.
 */

/**
 * Das SwissHub-Logo als lokale Datei.
 *
 * Bewusst ein Pfad in `public/`: das Logo gehoert zur Anwendung und darf nicht
 * von einer Upload-Adresse oder einem temporaeren Verzeichnis abhaengen. Ein
 * im Dashboard hochgeladenes Logo hat Vorrang - fehlt es, greift diese Datei.
 */
export const DEFAULT_SWISSHUB_LOGO = '/branding/swisshub-logo.png';

/** Kleinere Fassungen desselben Logos fuer Favicon und Startbildschirm. */
export const SWISSHUB_LOGO_SIZES = {
  favicon: '/branding/swisshub-logo-32.png',
  appleTouch: '/branding/swisshub-logo-180.png',
} as const;

export const branding = {
  /** Product name shown in the sidebar, page titles and emails. */
  name: 'SwissHub',
  /** Sub title / product descriptor. */
  productName: 'Bot Control Center',
  /** Short description used for metadata. */
  description: 'Administrations- und Moderationsoberfläche für den SwissHub Discord-Server.',
  /**
   * Das Logo der Anwendung. Ein Austausch der Datei unter `public/branding/`
   * genuegt zum Rebranding - Code muss dafuer nicht angefasst werden.
   */
  logo: {
    mark: DEFAULT_SWISSHUB_LOGO,
    favicon: SWISSHUB_LOGO_SIZES.favicon,
    appleTouch: SWISSHUB_LOGO_SIZES.appleTouch,
    /** Ersatzdarstellung, wo kein Bild geladen werden kann (z.B. Vorschauen). */
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
