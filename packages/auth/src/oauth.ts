import { Discord, generateCodeVerifier, generateState } from 'arctic';
import { z } from 'zod';
import { DISCORD_OAUTH_SCOPES, discordConfig } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('auth:oauth');

/**
 * Discord OAuth2 (Authorization Code Flow mit PKCE).
 *
 * Der Access Token des Benutzers wird ausschliesslich serverseitig verwendet,
 * um die Discord-Identität zu lesen, und danach sofort verworfen bzw.
 * widerrufen. Es wird kein Benutzer-Token persistiert.
 */
function client(): Discord {
  return new Discord(discordConfig.clientId, discordConfig.clientSecret, discordConfig.redirectUri);
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

export function createAuthorizationRequest(): AuthorizationRequest {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client().createAuthorizationURL(state, codeVerifier, [...DISCORD_OAUTH_SCOPES]);
  return { url: url.toString(), state, codeVerifier };
}

const oauthUserSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/u),
  username: z.string().min(1).max(64),
  global_name: z.string().max(64).nullish(),
  avatar: z.string().max(64).nullish(),
});

export interface DiscordOAuthUser {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

/**
 * Tauscht den Authorization Code gegen die Discord-Identität.
 * Der Access Token verlässt diese Funktion nicht.
 */
export async function exchangeCodeForUser(code: string, codeVerifier: string): Promise<DiscordOAuthUser> {
  const provider = client();
  let accessToken: string;
  try {
    const tokens = await provider.validateAuthorizationCode(code, codeVerifier);
    accessToken = tokens.accessToken();
  } catch (error) {
    log.warn('OAuth Code Exchange fehlgeschlagen', { error });
    throw new AppError('UNAUTHENTICATED', {
      userMessage: 'Die Discord-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
      internalMessage: 'validateAuthorizationCode fehlgeschlagen',
      cause: error,
    });
  }

  try {
    const response = await fetch(`${discordConfig.apiBaseUrl}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = oauthUserSchema.parse(await response.json());
    return {
      discordId: parsed.id,
      username: parsed.username,
      globalName: parsed.global_name ?? null,
      avatarHash: parsed.avatar ?? null,
    };
  } catch (error) {
    throw new AppError('UNAUTHENTICATED', {
      userMessage: 'Discord-Profil konnte nicht gelesen werden. Bitte erneut versuchen.',
      internalMessage: 'GET /users/@me fehlgeschlagen',
      cause: error,
    });
  } finally {
    // Best effort: Token sofort entwerten, damit er nirgends weiterlebt.
    void provider.revokeToken(accessToken).catch(() => undefined);
  }
}
