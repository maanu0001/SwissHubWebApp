import { env } from './env';

/**
 * OAuth2 scopes requested from Discord.
 *
 * Bewusst minimal: Guild-Mitgliedschaft und Rollen werden ueber den Bot-Token
 * gelesen. Dadurch muessen keine Benutzer-Tokens gespeichert oder erneuert
 * werden und die Rollendaten sind immer aktuell statt "so aktuell wie das
 * letzte Login".
 */
export const DISCORD_OAUTH_SCOPES = ['identify'] as const;

/** Cookie names. Prefixed so they cannot collide with other apps on a domain. */
export const COOKIE = {
  session: 'swisshub_session',
  oauthState: 'swisshub_oauth_state',
  oauthVerifier: 'swisshub_oauth_verifier',
  oauthRedirect: 'swisshub_oauth_redirect',
  csrf: 'swisshub_csrf',
} as const;

/** Session behaviour derived from the validated environment. */
export const sessionConfig = {
  get absoluteTtlMs(): number {
    return env.SESSION_ABSOLUTE_TTL_HOURS * 60 * 60 * 1000;
  },
  get idleTtlMs(): number {
    return env.SESSION_IDLE_TTL_MINUTES * 60 * 1000;
  },
  /** A session token is rotated once it is older than this. */
  rotateAfterMs: 30 * 60 * 1000,
};

/** Discord role/membership freshness policy. */
export const identityConfig = {
  get cacheTtlMs(): number {
    return env.ROLE_CACHE_TTL_SECONDS * 1000;
  },
  get criticalTtlMs(): number {
    return env.ROLE_CRITICAL_TTL_SECONDS * 1000;
  },
};

export const discordConfig = {
  apiBaseUrl: 'https://discord.com/api/v10',
  cdnBaseUrl: 'https://cdn.discordapp.com',
  authorizeUrl: 'https://discord.com/oauth2/authorize',
  tokenUrl: 'https://discord.com/api/oauth2/token',
  revokeUrl: 'https://discord.com/api/oauth2/token/revoke',
  get guildId(): string {
    return env.DISCORD_GUILD_ID;
  },
  get botToken(): string {
    return env.DISCORD_BOT_TOKEN;
  },
  get clientId(): string {
    return env.DISCORD_CLIENT_ID;
  },
  get clientSecret(): string {
    return env.DISCORD_CLIENT_SECRET;
  },
  get redirectUri(): string {
    return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/u, '')}/api/auth/callback/discord`;
  },
};

/**
 * Bootstrap values coming from the environment. They are only used to seed the
 * database configuration on first start; afterwards the values stored in the
 * `SystemConfig`/`RolePermission` tables win, so admins can change them in the UI.
 */
export const bootstrapConfig = {
  get adminRoleId(): string | undefined {
    return env.DISCORD_ADMIN_ROLE_ID;
  },
  get jailRoleId(): string | undefined {
    return env.DISCORD_JAIL_ROLE_ID;
  },
  get ownerDiscordId(): string | undefined {
    return env.SWISSHUB_OWNER_DISCORD_ID;
  },
};

export const jobConfig = {
  get jailSweepIntervalMs(): number {
    return env.JAIL_SWEEP_INTERVAL_SECONDS * 1000;
  },
  get reconcileIntervalMs(): number {
    return env.RECONCILE_INTERVAL_MINUTES * 60 * 1000;
  },
  /** Bot heartbeat cadence. The UI marks the bot offline after 3 missed beats. */
  heartbeatIntervalMs: 20_000,
  heartbeatStaleAfterMs: 70_000,
};
