import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, isProduction } from '@swisshub/config';
import { createAuthorizationRequest } from '@swisshub/auth';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { enforceRateLimit } from '@/server/rate-limit';
import { getRateLimitIdentity, getRequestMetadata } from '@/server/request';

const log = createLogger('web:auth');

export const dynamic = 'force-dynamic';

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
    return NextResponse.redirect(new URL('/login?error=rate_limit', request.url));
  }

  let authorization;
  try {
    authorization = createAuthorizationRequest();
  } catch (error) {
    log.error('OAuth Authorization URL konnte nicht erstellt werden', { error });
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

  return response;
}
