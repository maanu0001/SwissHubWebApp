import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, isProduction, sessionConfig } from '@swisshub/config';
import {
  buildAuthContext,
  can,
  issueCsrfToken,
  validateSessionToken,
  type AuthContext,
  type Freshness,
} from '@swisshub/auth';
import { getRequestMetadata } from './request';

/**
 * Zugriff auf den Sicherheitskontext innerhalb der WebApp.
 *
 * `cache()` sorgt dafuer, dass pro Request nur einmal validiert wird - die
 * Rollenpruefung selbst bleibt davon unberuehrt, weil sie an die konfigurierte
 * Aktualitaet (TTL) gebunden ist.
 */
export const getOptionalAuthContext = cache(async (): Promise<AuthContext | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE.session)?.value;
  if (!token) {
    return null;
  }

  // In Server Components duerfen keine Cookies gesetzt werden - deshalb wird
  // hier nicht rotiert (das uebernimmt der Login bzw. die Route Handler).
  const validated = await validateSessionToken(token, { rotate: false });
  if (!validated) {
    return null;
  }

  return buildAuthContext({ user: validated.user, sessionId: validated.session.id });
});

/**
 * Kontext fuer Server Actions und Route Handler.
 *
 * Hier - und nur hier - darf das Session-Token rotiert werden, weil in diesen
 * Kontexten Cookies gesetzt werden duerfen. `freshness: 'critical'` erzwingt
 * zusaetzlich aktuelle Discord-Rollen.
 */
export async function getActionAuthContext(freshness: Freshness = 'critical'): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE.session)?.value;
  if (!token) {
    return null;
  }

  const validated = await validateSessionToken(token, { rotate: true });
  if (!validated) {
    return null;
  }

  if (validated.rotatedToken) {
    // Session Rotation: das bisherige Token ist ab sofort ungueltig.
    await setSessionCookie(validated.rotatedToken);
  }

  return buildAuthContext({ user: validated.user, sessionId: validated.session.id, freshness });
}

/** Erzwingt eine Anmeldung. Leitet sonst zur Login-Seite weiter. */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getOptionalAuthContext();
  if (!context) {
    redirect('/login');
  }
  return context;
}

/** Erzwingt Anmeldung + aktive Guild-Mitgliedschaft. */
export async function requireMember(): Promise<AuthContext> {
  const context = await requireAuth();
  if (!context.isMember) {
    redirect('/access-denied');
  }
  return context;
}

/** Seitenschutz: leitet ohne passende Berechtigung auf die 403-Seite. */
export async function requirePagePermission(permission: string): Promise<AuthContext> {
  const context = await requireMember();
  if (!can(context, permission)) {
    redirect(`/403?permission=${encodeURIComponent(permission)}`);
  }
  return context;
}

/** CSRF-Token fuer Formulare und Server Actions. */
export function csrfTokenFor(context: AuthContext): string {
  return issueCsrfToken(context.sessionId);
}

export interface SessionCookieOptions {
  maxAgeMs?: number;
}

export async function setSessionCookie(token: string, options: SessionCookieOptions = {}): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE.session, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor((options.maxAgeMs ?? sessionConfig.absoluteTtlMs) / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE.session);
}

export { getRequestMetadata };
