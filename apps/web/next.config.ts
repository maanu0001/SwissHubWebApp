import type { NextConfig } from 'next';

/**
 * Security Header, die für jede Antwort gelten.
 * Die Content-Security-Policy wird in `src/middleware.ts` gesetzt, weil sie
 * pro Request eine Nonce enthält.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const productionHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Der Entwicklungs-Indikator liegt sonst ueber der Statusleiste der Seitenleiste.
  devIndicators: { position: 'bottom-right' },
  // Die Workspace-Pakete werden als TypeScript-Quelle eingebunden.
  transpilePackages: [
    '@swisshub/auth',
    '@swisshub/config',
    '@swisshub/database',
    '@swisshub/discord',
    '@swisshub/logger',
    '@swisshub/modules',
    '@swisshub/permissions',
    '@swisshub/shared',
  ],
  serverExternalPackages: ['@prisma/client'],
  experimental: {
    // Server Actions sind nur für die eigene Origin erlaubt (CSRF).
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.discordapp.com', pathname: '/**' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers:
          process.env.NODE_ENV === 'production'
            ? [...securityHeaders, ...productionHeaders]
            : securityHeaders,
      },
    ];
  },
};

export default nextConfig;
