import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE } from '@swisshub/config';
import { createSession, exchangeCodeForUser, refreshIdentity, upsertUserFromDiscord } from '@swisshub/auth';
import { AUDIT_ACTIONS, SECURITY_EVENTS, recordSecurityEvent, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { safeEqual } from '@swisshub/shared/crypto';
import { setSessionCookie } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { getRateLimitIdentity, getRequestMetadata } from '@/server/request';

const log = createLogger('web:auth');

export const dynamic = 'force-dynamic';

/** Schliesst den Discord OAuth2 Flow ab und erstellt die Session. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const metadata = await getRequestMetadata();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const clearOauthCookies = (response: NextResponse): NextResponse => {
    response.cookies.delete(COOKIE.oauthState);
    response.cookies.delete(COOKIE.oauthVerifier);
    return response;
  };

  if (error) {
    log.warn('Discord OAuth abgebrochen', { error });
    return clearOauthCookies(NextResponse.redirect(new URL('/login?error=denied', request.url)));
  }

  try {
    await enforceRateLimit('oauthCallback', await getRateLimitIdentity());
  } catch {
    return clearOauthCookies(NextResponse.redirect(new URL('/login?error=rate_limit', request.url)));
  }

  const storedState = request.cookies.get(COOKIE.oauthState)?.value;
  const codeVerifier = request.cookies.get(COOKIE.oauthVerifier)?.value;

  if (!code || !state || !storedState || !codeVerifier || !safeEqual(state, storedState)) {
    await recordSecurityEvent({
      type: SECURITY_EVENTS.OAUTH_STATE_MISMATCH,
      severity: 'HIGH',
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: '/api/auth/callback/discord',
    });
    return clearOauthCookies(NextResponse.redirect(new URL('/login?error=state', request.url)));
  }

  try {
    const profile = await exchangeCodeForUser(code, codeVerifier);
    const user = await upsertUserFromDiscord(profile);

    if (user.isBlocked) {
      await Promise.all([
        recordSecurityEvent({
          type: SECURITY_EVENTS.BLOCKED_ACCOUNT,
          severity: 'HIGH',
          discordId: user.discordId,
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        }),
        safeRecordAudit({
          action: AUDIT_ACTIONS.LOGIN_DENIED,
          actorDiscordId: user.discordId,
          actorUsername: user.username,
          success: false,
          errorCode: 'BLOCKED',
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        }),
      ]);
      return clearOauthCookies(NextResponse.redirect(new URL('/login?error=blocked', request.url)));
    }

    // Guild-Mitgliedschaft und Rollen sofort frisch laden.
    const identity = await refreshIdentity(user.discordId);

    const { token } = await createSession(user.id, {
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    await setSessionCookie(token);

    await safeRecordAudit({
      action: identity.isMember ? AUDIT_ACTIONS.LOGIN : AUDIT_ACTIONS.LOGIN_DENIED,
      actorDiscordId: user.discordId,
      actorUsername: user.username,
      success: identity.isMember,
      errorCode: identity.isMember ? null : 'NOT_A_MEMBER',
      metadata: { roles: identity.roleIds.length },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    if (!identity.isMember) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.NOT_A_MEMBER,
        severity: 'LOW',
        discordId: user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });
      return clearOauthCookies(NextResponse.redirect(new URL('/access-denied', request.url)));
    }

    return clearOauthCookies(NextResponse.redirect(new URL('/dashboard', request.url)));
  } catch (caught) {
    log.error('OAuth Callback fehlgeschlagen', { error: caught });
    await recordSecurityEvent({
      type: SECURITY_EVENTS.OAUTH_FAILED,
      severity: 'MEDIUM',
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: '/api/auth/callback/discord',
    });
    return clearOauthCookies(NextResponse.redirect(new URL('/login?error=oauth', request.url)));
  }
}
