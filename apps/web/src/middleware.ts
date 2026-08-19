import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy mit Request-Nonce.
 *
 * Next.js uebernimmt die Nonce automatisch fuer eigene Skripte, sobald sie im
 * CSP-Header des Requests steht. Dadurch braucht es kein `unsafe-inline` fuer
 * Skripte - die wirksamste Massnahme gegen XSS.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://cdn.discordapp.com",
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
