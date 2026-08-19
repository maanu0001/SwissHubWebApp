import { z } from 'zod';

/**
 * Central environment validation.
 *
 * Every server side entry point (Next.js instrumentation hook, Discord bot,
 * scripts) calls `assertServerEnv()` on startup so that a misconfigured
 * deployment fails fast with an actionable error message instead of breaking
 * somewhere deep inside a request handler.
 */

const snowflake = z
  .string()
  .regex(/^\d{17,20}$/u, 'muss eine gültige Discord Snowflake ID sein (17-20 Ziffern)');

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

    /** Discord application + bot credentials. Never exposed to the browser. */
    DISCORD_BOT_TOKEN: z.string().min(20, 'sieht nicht wie ein gültiger Bot Token aus'),
    DISCORD_CLIENT_ID: snowflake,
    DISCORD_CLIENT_SECRET: z.string().min(10, 'wird benötigt'),
    DISCORD_GUILD_ID: snowflake,

    /** Optional bootstrap IDs - can alternatively be configured in the UI. */
    DISCORD_ADMIN_ROLE_ID: optionalSnowflake,
    DISCORD_JAIL_ROLE_ID: optionalSnowflake,
    SWISSHUB_OWNER_DISCORD_ID: optionalSnowflake,

    /** Secret used for session token hashing, CSRF tokens and IP hashing. */
    AUTH_SECRET: z.string().min(32, 'muss mindestens 32 Zeichen lang sein (z.B. `openssl rand -base64 48`)'),

    /** Public base URL of the web app, used to build the OAuth redirect URI. */
    NEXT_PUBLIC_APP_URL: z.string().url('muss eine absolute URL sein, z.B. http://localhost:3000'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

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
  })
  .superRefine((value, ctx) => {
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

export const isProduction = (): boolean => assertServerEnv().NODE_ENV === 'production';
export const isDevelopment = (): boolean => assertServerEnv().NODE_ENV === 'development';
export const isTest = (): boolean => assertServerEnv().NODE_ENV === 'test';

/** True when Discord calls must be replaced by deterministic mock data. */
export const discordMocksEnabled = (): boolean => {
  const current = assertServerEnv();
  return current.NODE_ENV !== 'production' && current.DEV_MOCK_DISCORD;
};
