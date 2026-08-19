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
  description: 'Administrations- und Moderationsoberflaeche fuer den SwissHub Discord-Server.',
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
  /** Locale + timezone used for all user facing date rendering. */
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  links: {
    discordInvite: null as string | null,
  },
} as const;

export type Branding = typeof branding;
