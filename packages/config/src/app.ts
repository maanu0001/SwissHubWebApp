import { env } from './env';
import { runtimeConfigValue } from './runtime';

/**
 * OAuth2 scopes requested from Discord.
 *
 * Bewusst minimal: Guild-Mitgliedschaft und Rollen werden über den Bot-Token
 * gelesen. Dadurch müssen keine Benutzer-Tokens gespeichert oder erneuert
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

/** Absolute URL innerhalb der WebApp, unabhaengig von Proxy-Headern. */
export function appUrl(path = '/'): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/u, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export const discordConfig = {
  apiBaseUrl: 'https://discord.com/api/v10',
  cdnBaseUrl: 'https://cdn.discordapp.com',
  authorizeUrl: 'https://discord.com/oauth2/authorize',
  tokenUrl: 'https://discord.com/api/oauth2/token',
  revokeUrl: 'https://discord.com/api/oauth2/token/revoke',
  /**
   * Guild-ID aus der Umgebung. Nur Bootstrap bzw. Fallback - massgeblich ist
   * die in der Datenbank gespeicherte Guild (siehe `resolveGuildId()`).
   */
  get bootstrapGuildId(): string | undefined {
    return env.DISCORD_GUILD_ID;
  },
  /**
   * Die drei Zugangsdaten der Discord-Anwendung.
   *
   * Zuerst die zentrale Verwaltung, dann die Umgebung. Wer sie hier abfragt,
   * merkt vom Unterschied nichts - genau darum stehen die Zugriffe weiterhin
   * an dieser einen Stelle und nicht verteilt im Code.
   *
   * `?? ''` statt eines Fehlers: das Fehlen wird beim Start geprueft
   * (`assertIntegrationsReady`) und in der Uebersicht angezeigt. Ein Wurf
   * mitten in einem Anfragepfad waere eine schlechtere Auskunft als eine
   * Integration, die sich sichtbar als «nicht konfiguriert» meldet.
   */
  get botToken(): string {
    return runtimeConfigValue('discord.botToken') ?? env.DISCORD_BOT_TOKEN ?? '';
  },
  get clientId(): string {
    return runtimeConfigValue('discord.clientId') ?? env.DISCORD_CLIENT_ID ?? '';
  },
  get clientSecret(): string {
    return runtimeConfigValue('discord.clientSecret') ?? env.DISCORD_CLIENT_SECRET ?? '';
  },
  get redirectUri(): string {
    return appUrl('/api/auth/callback/discord');
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
  /**
   * Wie oft geprueft wird, ob der Bot Discords Audit Log lesen darf.
   *
   * Zehn Minuten: die Antwort aendert sich nur, wenn jemand die Rechte des
   * Bots umstellt, und dafuer ist eine Probe im Minutentakt Verschwendung an
   * einer Schnittstelle mit Rate Limit.
   */
  auditAccessCheckIntervalMs: 600_000,
  /**
   * Wie oft nachgelesen wird, ob der Bot ein Moderationsereignis verpasst hat.
   *
   * Fuenfzehn Minuten. Die Luecke, die dieser Lauf schliesst, entsteht nur bei
   * einer Trennung - haeufiger zu fragen kostet Anfragen und findet nichts.
   */
  auditReconcileIntervalMs: 900_000,
  heartbeatStaleAfterMs: 70_000,
};
