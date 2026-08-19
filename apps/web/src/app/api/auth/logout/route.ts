import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE } from '@swisshub/config';
import { revokeSessionByToken, validateSessionToken, verifyCsrfToken } from '@swisshub/auth';
import { AUDIT_ACTIONS, SECURITY_EVENTS, recordSecurityEvent, safeRecordAudit } from '@swisshub/database';
import { getRequestMetadata } from '@/server/request';

export const dynamic = 'force-dynamic';

/**
 * Meldet den Benutzer ab.
 *
 * Nur als POST mit gültigem CSRF-Token - damit kann ein fremder Link niemanden
 * ungewollt abmelden.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const metadata = await getRequestMetadata();
  const token = request.cookies.get(COOKIE.session)?.value;
  const formData = await request.formData().catch(() => null);
  const csrfToken = formData?.get('csrfToken');

  const response = NextResponse.redirect(new URL('/login?logout=1', request.url), { status: 303 });
  response.cookies.delete(COOKIE.session);

  if (!token) {
    return response;
  }

  const session = await validateSessionToken(token, { rotate: false });
  if (!session) {
    return response;
  }

  if (typeof csrfToken !== 'string' || !verifyCsrfToken(session.session.id, csrfToken)) {
    await recordSecurityEvent({
      type: SECURITY_EVENTS.CSRF_FAILED,
      severity: 'HIGH',
      discordId: session.user.discordId,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: '/api/auth/logout',
    });
    return NextResponse.redirect(new URL('/dashboard?error=csrf', request.url), { status: 303 });
  }

  await revokeSessionByToken(token, 'LOGOUT');
  await safeRecordAudit({
    action: AUDIT_ACTIONS.LOGOUT,
    actorDiscordId: session.user.discordId,
    actorUsername: session.user.username,
    success: true,
    ipHash: metadata.ipHash,
    userAgent: metadata.userAgent,
  });

  return response;
}
