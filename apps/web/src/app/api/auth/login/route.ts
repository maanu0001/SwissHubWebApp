import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, appUrl, isProduction } from '@swisshub/config';
import { createAuthorizationRequest } from '@swisshub/auth';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { enforceRateLimit } from '@/server/rate-limit';
import { getRateLimitIdentity, getRequestMetadata } from '@/server/request';

const log = createLogger('web:auth');

export const dynamic = 'force-dynamic';

/**
 * Nur eigene Pfade als Ziel nach der Anmeldung.
 *
 * Ohne diese Pruefung waere `/api/auth/login?redirect=https://boese.example`
 * eine offene Weiterleitung: die Adresse in der Zeile gehoerte zu SwissHub,
 * das Ziel nicht. Zugelassen ist deshalb ausschliesslich ein Pfad, der mit
 * genau einem `/` beginnt - `//host` waere protokollrelativ und fuehrte nach
 * aussen, und `\` deuten manche Browser wie `/`.
 */
function sicheresZiel(wert: string | null): string | null {
  if (!wert || !wert.startsWith('/')) {
    return null;
  }
  if (wert.startsWith('//') || wert.startsWith('/\\') || wert.includes('\\')) {
    return null;
  }
  // Kein Zurueckspringen in den Anmeldeablauf selbst.
  if (wert.startsWith('/login') || wert.startsWith('/api/auth')) {
    return null;
  }
  return wert.slice(0, 512);
}

/**
 * Startet den Discord OAuth2 Flow.
 *
 * `state` und `code_verifier` (PKCE) werden in kurzlebigen, httpOnly-Cookies
 * abgelegt und im Callback geprüft - Schutz gegen CSRF und Code Injection.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const metadata = await getRequestMetadata();

  try {
    await enforceRateLimit('login', await getRateLimitIdentity());
  } catch {
    await recordSecurityEvent({
      type: SECURITY_EVENTS.RATE_LIMIT_EXCEEDED,
      severity: 'MEDIUM',
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: '/api/auth/login',
    });
    return NextResponse.redirect(appUrl('/login?error=rate_limit'));
  }

  let authorization;
  try {
    authorization = createAuthorizationRequest();
  } catch (error) {
    log.error('OAuth Authorization URL konnte nicht erstellt werden', { error });
    // Hier ist die Konfiguration selbst defekt - deshalb bewusst ohne appUrl().
    return NextResponse.redirect(new URL('/login?error=configuration', request.url));
  }

  const response = NextResponse.redirect(authorization.url);
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  };

  response.cookies.set(COOKIE.oauthState, authorization.state, cookieOptions);
  response.cookies.set(COOKIE.oauthVerifier, authorization.codeVerifier, cookieOptions);

  // Wohin es nach der Anmeldung weitergeht - etwa zurueck zum gewaehlten
  // Premium-Angebot. Bewusst im httpOnly-Cookie und nicht im `state`: der
  // Zustandswert dient der CSRF-Pruefung und soll nichts sonst tragen.
  const ziel = sicheresZiel(request.nextUrl.searchParams.get('redirect'));
  if (ziel) {
    response.cookies.set(COOKIE.oauthRedirect, ziel, cookieOptions);
  }

  return response;
}
