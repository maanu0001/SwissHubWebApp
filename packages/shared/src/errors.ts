/**
 * Application error hierarchy.
 *
 * Every error carries a *safe* user facing message. Internal details (stack
 * traces, Discord payloads, SQL) are kept in `internalMessage`/`cause` and only
 * ever reach the structured server log - never the browser.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_A_MEMBER'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DISCORD_UNAVAILABLE'
  | 'DISCORD_MISSING_PERMISSIONS'
  | 'DISCORD_UNKNOWN_MEMBER'
  | 'DISCORD_UNKNOWN_ROLE'
  | 'DISCORD_RATE_LIMITED'
  | 'CONFIGURATION_MISSING'
  | 'SECRET_UNREADABLE'
  | 'POLICY_VIOLATION'
  | 'INTERNAL';

const DEFAULT_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_A_MEMBER: 403,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DISCORD_UNAVAILABLE: 502,
  DISCORD_MISSING_PERMISSIONS: 502,
  DISCORD_UNKNOWN_MEMBER: 404,
  DISCORD_UNKNOWN_ROLE: 409,
  DISCORD_RATE_LIMITED: 429,
  CONFIGURATION_MISSING: 409,
  SECRET_UNREADABLE: 500,
  POLICY_VIOLATION: 403,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: 'Du bist nicht angemeldet. Bitte melde dich erneut mit Discord an.',
  NOT_A_MEMBER: 'Du bist kein Mitglied des SwissHub Discord-Servers.',
  FORBIDDEN: 'Dir fehlt die erforderliche Berechtigung für diese Aktion.',
  VALIDATION_FAILED: 'Die Eingaben sind ungültig. Bitte prüfe das Formular.',
  NOT_FOUND: 'Der angeforderte Eintrag wurde nicht gefunden.',
  CONFLICT: 'Die Aktion steht im Konflikt mit dem aktuellen Zustand.',
  RATE_LIMITED: 'Zu viele Anfragen. Bitte versuche es in Kürze erneut.',
  DISCORD_UNAVAILABLE: 'Discord ist derzeit nicht erreichbar. Bitte versuche es später erneut.',
  DISCORD_MISSING_PERMISSIONS:
    'Aktion konnte nicht ausgeführt werden. Der Bot besitzt möglicherweise nicht genügend Berechtigungen oder seine Rolle ist zu niedrig.',
  DISCORD_UNKNOWN_MEMBER: 'Das Mitglied wurde auf Discord nicht gefunden (Server verlassen?).',
  DISCORD_UNKNOWN_ROLE: 'Eine konfigurierte Discord-Rolle existiert nicht mehr.',
  DISCORD_RATE_LIMITED: 'Discord drosselt aktuell die Anfragen. Bitte versuche es in Kürze erneut.',
  CONFIGURATION_MISSING: 'Die Konfiguration ist unvollständig. Bitte prüfe die Einstellungen.',
  SECRET_UNREADABLE:
    'Ein gespeichertes Geheimnis liess sich nicht lesen. Bitte den Wert unter Integrationen neu hinterlegen.',
  POLICY_VIOLATION: 'Diese Aktion ist gegen dieses Mitglied nicht zulässig.',
  INTERNAL: 'Aktion konnte nicht ausgeführt werden. Bitte versuche es später erneut.',
};

export interface AppErrorOptions {
  /** Message shown to the user. Falls back to a safe generic message. */
  userMessage?: string;
  /** Detailed message for logs only. Never returned to the client. */
  internalMessage?: string;
  /** Machine readable extras for the client (e.g. field errors). */
  details?: Record<string, unknown>;
  cause?: unknown;
  /** HTTP status override. */
  status?: number;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;
  readonly internalMessage?: string;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    super(options.internalMessage ?? options.userMessage ?? DEFAULT_MESSAGE[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.userMessage = options.userMessage ?? DEFAULT_MESSAGE[code];
    this.details = options.details;
    this.internalMessage = options.internalMessage;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /** Payload that is safe to send to the browser. */
  toClient(): { code: AppErrorCode; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.userMessage, ...(this.details ? { details: this.details } : {}) };
  }
}

export const unauthenticated = (internalMessage?: string): AppError =>
  new AppError('UNAUTHENTICATED', { internalMessage });

export const forbidden = (internalMessage?: string, userMessage?: string): AppError =>
  new AppError('FORBIDDEN', { internalMessage, userMessage });

export const notFound = (internalMessage?: string, userMessage?: string): AppError =>
  new AppError('NOT_FOUND', { internalMessage, userMessage });

export const conflict = (userMessage?: string, internalMessage?: string): AppError =>
  new AppError('CONFLICT', { userMessage, internalMessage });

export const validationFailed = (details?: Record<string, unknown>, userMessage?: string): AppError =>
  new AppError('VALIDATION_FAILED', { details, userMessage });

export const policyViolation = (userMessage: string, internalMessage?: string): AppError =>
  new AppError('POLICY_VIOLATION', { userMessage, internalMessage });

export const configurationMissing = (userMessage: string): AppError =>
  new AppError('CONFIGURATION_MISSING', { userMessage });

/** Normalises unknown throwables into an `AppError`. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError('INTERNAL', {
    internalMessage: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}
