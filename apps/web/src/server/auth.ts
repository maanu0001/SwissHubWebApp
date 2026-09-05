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
 * `cache()` sorgt dafür, dass pro Request nur einmal validiert wird - die
 * Rollenprüfung selbst bleibt davon unberührt, weil sie an die konfigurierte
 * Aktualität (TTL) gebunden ist.
 */
export const getOptionalAuthContext = cache(async (): Promise<AuthContext | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE.session)?.value;
  if (!token) {
    return null;
  }

  // In Server Components dürfen keine Cookies gesetzt werden - deshalb wird
  // hier nicht rotiert (das übernimmt der Login bzw. die Route Handler).
  const validated = await validateSessionToken(token, { rotate: false });
  if (!validated) {
    return null;
  }

  return buildAuthContext({ user: validated.user, sessionId: validated.session.id });
});

/**
 * Kontext für Server Actions und Route Handler.
 *
 * Hier - und nur hier - darf das Session-Token rotiert werden, weil in diesen
 * Kontexten Cookies gesetzt werden dürfen. `freshness: 'critical'` erzwingt
 * zusätzlich aktuelle Discord-Rollen.
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
    // Session Rotation: das bisherige Token ist ab sofort ungültig.
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

/**
 * Erstzugang zur Einrichtung.
 *
 * Ohne diese Ausnahme entstünde ein Henne-Ei-Problem: Berechtigungen werden im
 * Dashboard vergeben, aber für das Dashboard braucht es Berechtigungen. Solange
 * die Einrichtung nicht abgeschlossen ist, darf deshalb ein
 * Discord-Administrator die Konfigurationsbereiche verwenden. Danach - und für
 * alle anderen Bereiche - gelten ausschliesslich die Dashboard-Berechtigungen.
 */
export const hasSetupAccess = cache(async (): Promise<boolean> => {
  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    return false;
  }
  if (context.user.isOwner || can(context, 'settings.edit') || can(context, 'admin.full')) {
    return true;
  }

  const { getGuildConfig, isDiscordAdministrator } = await import('@swisshub/modules');
  const guild = await getGuildConfig();
  if (guild.setupCompletedAt !== null) {
    return false;
  }
  return isDiscordAdministrator(context.user.discordId).catch(() => false);
});

export interface PagePermissionOptions {
  /**
   * Bereich gehört zum Einrichtungsassistenten und ist deshalb vor Abschluss
   * der Einrichtung auch für Discord-Administratoren erreichbar.
   */
  allowDuringSetup?: boolean;
}

/** Seitenschutz: leitet ohne passende Berechtigung auf die 403-Seite. */
/**
 * Erzwingt eine Berechtigung fuer eine Seite.
 *
 * Mehrere Angaben wirken als «eine davon genuegt». Das ist kein
 * Aufweichen, sondern die Abbildung von Bereichen mit mehreren Zugaengen:
 * die Vote-Jail-Seite gehoert dem, der Abstimmungen einsehen darf - und
 * ebenso dem, der eine starten darf, ohne deswegen die Strafakte zu lesen.
 */
export async function requirePagePermission(
  permission: string | string[],
  options: PagePermissionOptions = {},
): Promise<AuthContext> {
  const context = await requireMember();
  const erlaubte = Array.isArray(permission) ? permission : [permission];

  // «Modul sehen» gilt hier genauso wie in der Seitenleiste. Die Seitenleiste
  // ist Darstellung; wer die Adresse kennt, umgeht sie. Der Schluessel wird
  // aus dem Praefix der geforderten Berechtigung abgeleitet, damit keine
  // Seite ihn mitgeben muss - und keine neue ihn vergessen kann.
  const { moduleViewPermissionFor } = await import('@swisshub/modules');
  const zugelassen = erlaubte.some((eintrag) => {
    if (!can(context, eintrag)) {
      return false;
    }
    const sehen = moduleViewPermissionFor(eintrag);
    return sehen === null || can(context, sehen);
  });

  if (!zugelassen) {
    if (options.allowDuringSetup && (await hasSetupAccess())) {
      return context;
    }
    redirect(`/403?permission=${encodeURIComponent(erlaubte[0] ?? '')}`);
  }
  return context;
}

/** CSRF-Token für Formulare und Server Actions. */
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
