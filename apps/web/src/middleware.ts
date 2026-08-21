import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy mit Request-Nonce.
 *
 * Next.js übernimmt die Nonce automatisch für eigene Skripte, sobald sie im
 * CSP-Header des Requests steht. Dadurch braucht es kein `unsafe-inline` für
 * Skripte - die wirksamste Massnahme gegen XSS.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Bilder von beliebigen https-Adressen.
    //
    // Banner werden im Dashboard als https-Adresse eingetragen (geprüft in
    // `bannerUrlSchema`) und anschliessend von Discord ausgeliefert. Ohne
    // diese Freigabe zeigte die Vorschau ein Banner, das nicht auf Discords
    // CDN liegt, schlicht nicht an - die Vorschau verschwieg damit, was nach
    // dem Senden tatsächlich erscheint. Skripte bleiben davon unberührt:
    // `script-src` ist weiterhin an die Nonce gebunden.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Statische Assets und Bilder brauchen keine CSP-Verarbeitung.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|branding/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
