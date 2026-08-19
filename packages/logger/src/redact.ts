/**
 * Secret redaction.
 *
 * The logger must never emit credentials, session material or cookies - not
 * even accidentally through a nested object or an error message that embeds a
 * token. Redaction therefore happens on two levels: by key name and by value.
 */

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|authorization|auth[-_]?header|cookie|session|credential|apikey|api[-_]key|client[-_]secret|refresh|access[-_]token|code[-_]verifier|state)/iu;

export const REDACTED = '[redacted]';

/** Environment variables whose *values* are scrubbed from any logged string. */
const SECRET_ENV_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_SECRET', 'AUTH_SECRET', 'DATABASE_URL'];

function secretValues(): string[] {
  return SECRET_ENV_KEYS.map((key) => process.env[key])
    .filter((value): value is string => typeof value === 'string' && value.length >= 8)
    .sort((a, b) => b.length - a.length);
}

export function redactString(value: string): string {
  let result = value;
  for (const secret of secretValues()) {
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTED);
    }
  }
  // Bearer/Bot tokens that may appear in third party error messages.
  result = result.replace(/(Bot|Bearer)\s+[A-Za-z0-9._-]{10,}/gu, `$1 ${REDACTED}`);
  return result;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[max depth]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
      cause: value.cause ? redact(value.cause, depth + 1) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => redact(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return output;
  }
  return '[unserialisable]';
}
