import { z } from 'zod';

/**
 * Central environment validation.
 *
 * Every server side entry point (Next.js instrumentation hook, Discord bot,
 * scripts) calls `assertServerEnv()` on startup so that a misconfigured
 * deployment fails fast with an actionable error message instead of breaking
 * somewhere deep inside a request handler.
 */

const optionalSnowflake = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .refine(
    (value) => value === undefined || /^\d{17,20}$/u.test(value),
    'muss eine gültige Discord Snowflake ID sein (17-20 Ziffern)',
  );

const boolish = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? defaultValue : value === 'true' || value === '1',
    );

const intWithDefault = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? defaultValue : Number(value)))
    .pipe(z.number().int().min(min).max(max));

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /** PostgreSQL connection string used by Prisma. */
    DATABASE_URL: z.string().min(1, 'wird benötigt (PostgreSQL Connection String)'),

    /**
     * Hauptschluessel der Zugangsdatenverwaltung.
     *
     * Das eine Geheimnis, das in der Umgebung bleiben MUSS: mit ihm werden die
     * uebrigen in der Datenbank ver- und entschluesselt. Er wird niemals im
     * Dashboard angezeigt, niemals in der Datenbank abgelegt und niemals
     * protokolliert. Ohne ihn sind die gespeicherten Zugangsdaten absichtlich
     * nicht lesbar - siehe docs/INTEGRATIONS.md.
     *
     * 32 Bytes in base64 oder hex, z.B. `openssl rand -base64 32`.
     */
    MASTER_ENCRYPTION_KEY: z.string().min(1).optional(),

    /**
     * Discord application + bot credentials.
     *
     * Seit der zentralen Integrationsverwaltung sind sie **optional**: sie
     * werden im Dashboard unter System -> Integrationen gepflegt und liegen
     * verschluesselt in der Datenbank. Was hier steht, gilt weiterhin als
     * Rueckfall, solange in der Datenbank nichts hinterlegt ist (§39). Ob am
     * Ende ueberhaupt etwas da ist, prueft `assertIntegrationsReady()` beim
     * Start - nicht dieses Schema, denn es kennt die Datenbank nicht.
     */
    DISCORD_BOT_TOKEN: z
      .string()
      .min(20, 'sieht nicht wie ein gültiger Bot Token aus')
      .optional(),
    DISCORD_CLIENT_ID: optionalSnowflake,
    DISCORD_CLIENT_SECRET: z.string().min(10, 'wird benötigt').optional(),

    /**
     * Bootstrap-Werte. Sie werden beim ersten Start einmalig in die Datenbank
     * übernommen; danach gilt ausschliesslich die Konfiguration im Dashboard.
     *
     * @deprecated Der Discord-Server wird im Einrichtungsassistenten verbunden.
     */
    DISCORD_GUILD_ID: optionalSnowflake,
    /** @deprecated Berechtigungen werden im Dashboard unter Server -> Berechtigungen vergeben. */
    DISCORD_ADMIN_ROLE_ID: optionalSnowflake,
    /** @deprecated Die Jail-Rolle wird in den Moduleinstellungen gewählt. */
    DISCORD_JAIL_ROLE_ID: optionalSnowflake,
    /** Notzugang: dieses Konto besitzt immer Vollzugriff (nicht über die UI änderbar). */
    SWISSHUB_OWNER_DISCORD_ID: optionalSnowflake,

    /** Secret used for session token hashing, CSRF tokens and IP hashing. */
    AUTH_SECRET: z.string().min(32, 'muss mindestens 32 Zeichen lang sein (z.B. `openssl rand -base64 48`)'),

    /** Public base URL of the web app, used to build the OAuth redirect URI. */
    NEXT_PUBLIC_APP_URL: z.string().url('muss eine absolute URL sein, z.B. http://localhost:3000'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** `json` erzwingt strukturierte Logzeilen (Standard in Production). */
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),

    /** Session lifetimes. */
    SESSION_ABSOLUTE_TTL_HOURS: intWithDefault(24 * 7, 1, 24 * 90),
    SESSION_IDLE_TTL_MINUTES: intWithDefault(60 * 12, 5, 60 * 24 * 30),
    /** How long cached Discord role information may be reused. */
    ROLE_CACHE_TTL_SECONDS: intWithDefault(300, 10, 3600),
    /** Maximum age of role data for security critical actions. */
    ROLE_CRITICAL_TTL_SECONDS: intWithDefault(30, 0, 300),

    /** Background job cadence for the bot. */
    JAIL_SWEEP_INTERVAL_SECONDS: intWithDefault(30, 5, 3600),
    RECONCILE_INTERVAL_MINUTES: intWithDefault(15, 1, 1440),

    /**
     * Development only: serve deterministic mock data instead of talking to
     * Discord. Refused in production by `assertServerEnv()`.
     */
    DEV_MOCK_DISCORD: boolish(false),

    /** Trust `X-Forwarded-For` when running behind a reverse proxy. */
    TRUST_PROXY: boolish(false),

    /**
     * AI-Schluessel als Rueckfall.
     *
     * Massgeblich ist die zentrale Verwaltung unter System -> Integrationen
     * -> AI. Diese beiden Variablen werden nur noch gelesen, solange dort
     * nichts hinterlegt ist, und lassen sich von dort per Knopfdruck
     * uebernehmen. Danach koennen sie aus der Umgebung verschwinden.
     */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),

    /**
     * Zahlungsanbieter fuer SwissHub Premium - ebenfalls nur noch Rueckfall.
     *
     * `mock` ist ausschliesslich fuer die Entwicklung und wird in Production
     * zurueckgewiesen. Discord-Rollen, Kategorien und Kanaele werden bewusst
     * NICHT hier konfiguriert, sondern im Dashboard.
     */
    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).optional(),
    PAYMENT_API_KEY: z.string().min(1).optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().min(1).optional(),

    /**
     * Voice-Laufzeit fuer SwissHub Music.
     *
     * Die Bot-Tokens stehen bewusst NICHT hier: sie gehoeren ausschliesslich
     * in die Umgebung der Laufzeit selbst. Die WebApp braucht nur die
     * Adresse und den gemeinsamen Schluessel fuer die Suche.
     */
    MUSIC_RUNTIME_URL: z.string().url().optional(),
    MUSIC_RUNTIME_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message:
          'mock ist in Production nicht zulaessig - damit waeren Abonnements ohne Zahlung freigeschaltet',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.PAYMENT_PROVIDER === 'stripe' &&
      (!value.PAYMENT_API_KEY || !value.PAYMENT_WEBHOOK_SECRET)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_API_KEY'],
        message: 'PAYMENT_API_KEY und PAYMENT_WEBHOOK_SECRET werden fuer Stripe benoetigt',
      });
    }
    if (value.NODE_ENV === 'production' && !value.MASTER_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MASTER_ENCRYPTION_KEY'],
        message:
          'wird in Production benoetigt - ohne ihn lassen sich keine Zugangsdaten speichern (openssl rand -base64 32)',
      });
    }
    if (value.NODE_ENV === 'production' && value.DEV_MOCK_DISCORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_MOCK_DISCORD'],
        message: 'darf in Production niemals aktiviert sein',
      });
    }
    if (value.NODE_ENV === 'production' && value.NEXT_PUBLIC_APP_URL.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_APP_URL'],
        message: 'muss in Production HTTPS verwenden (sichere Cookies erfordern HTTPS)',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvironmentError extends Error {
  constructor(readonly issues: string[]) {
    super(
      [
        'Ungültige oder fehlende Umgebungsvariablen:',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'Bitte .env anhand von .env.example vervollständigen.',
      ].join('\n'),
    );
    this.name = 'EnvironmentError';
  }
}

let cached: ServerEnv | null = null;

function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'ENV'}: ${issue.message}`),
    );
  }
  return result.data;
}

/** Validates the environment and caches the result. Throws `EnvironmentError`. */
export function assertServerEnv(source?: NodeJS.ProcessEnv): ServerEnv {
  if (!cached) {
    cached = parseServerEnv(source);
  }
  return cached;
}

/** Test helper - drops the cached environment. */
export function resetServerEnvCache(): void {
  cached = null;
}

/**
 * Lazily validated environment accessor.
 *
 * Using a proxy keeps the validation out of module evaluation, which matters
 * because Next.js also evaluates server modules during static analysis.
 */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, property: string) {
    return assertServerEnv()[property as keyof ServerEnv];
  },
  has(_target, property: string) {
    return property in assertServerEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(assertServerEnv());
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

/**
 * Umgebungsvariablen, die durch die Dashboard-Konfiguration abgelöst wurden.
 * Sie funktionieren weiterhin als Bootstrap, sollen aber nach der Übernahme in
 * die Datenbank entfernt werden.
 */
export const DEPRECATED_ENV_KEYS = [
  {
    key: 'DISCORD_GUILD_ID',
    replacement: 'Einrichtungsassistent (/setup) - der verbundene Server steht in der Datenbank.',
  },
  {
    key: 'DISCORD_ADMIN_ROLE_ID',
    replacement: 'Server -> Berechtigungen: Rollen im Dashboard Berechtigungen zuweisen.',
  },
  {
    key: 'DISCORD_JAIL_ROLE_ID',
    replacement: 'Module -> Jail: die Jail-Rolle wird in den Moduleinstellungen gewählt.',
  },
] as const;

/** Gesetzte, aber abgelöste Variablen - für Startwarnung und Dashboard. */
export function listDeprecatedEnvKeys(source: NodeJS.ProcessEnv = process.env): Array<{
  key: string;
  replacement: string;
}> {
  return DEPRECATED_ENV_KEYS.filter((entry) => {
    const value = source[entry.key];
    return typeof value === 'string' && value.trim() !== '';
  }).map((entry) => ({ key: entry.key, replacement: entry.replacement }));
}

export const isProduction = (): boolean => assertServerEnv().NODE_ENV === 'production';
export const isDevelopment = (): boolean => assertServerEnv().NODE_ENV === 'development';
export const isTest = (): boolean => assertServerEnv().NODE_ENV === 'test';

/** True when Discord calls must be replaced by deterministic mock data. */
export const discordMocksEnabled = (): boolean => {
  const current = assertServerEnv();
  return current.NODE_ENV !== 'production' && current.DEV_MOCK_DISCORD;
};
