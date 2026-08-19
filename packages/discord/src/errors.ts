import { AppError } from '@swisshub/shared';

/** Relevante Discord JSON Error Codes. */
export const DISCORD_ERROR_CODES = {
  UNKNOWN_GUILD: 10004,
  UNKNOWN_MEMBER: 10007,
  UNKNOWN_USER: 10013,
  UNKNOWN_ROLE: 10011,
  UNKNOWN_CHANNEL: 10003,
  MISSING_ACCESS: 50001,
  MISSING_PERMISSIONS: 50013,
  CANNOT_EDIT_HIGHER_ROLE: 50013,
} as const;

export interface DiscordErrorBody {
  code?: number;
  message?: string;
  errors?: unknown;
  retry_after?: number;
  global?: boolean;
}

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly discordCode: number | undefined,
    readonly route: string,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

/**
 * Uebersetzt einen Discord-Fehler in einen `AppError` mit sicherer,
 * verstaendlicher Meldung. Interne Details bleiben im `internalMessage`.
 */
export function mapDiscordError(error: DiscordApiError): AppError {
  const internalMessage = `Discord ${error.status} (code ${error.discordCode ?? '-'}) auf ${error.route}: ${error.message}`;

  switch (error.discordCode) {
    case DISCORD_ERROR_CODES.UNKNOWN_MEMBER:
    case DISCORD_ERROR_CODES.UNKNOWN_USER:
      return new AppError('DISCORD_UNKNOWN_MEMBER', { internalMessage });
    case DISCORD_ERROR_CODES.UNKNOWN_ROLE:
      return new AppError('DISCORD_UNKNOWN_ROLE', { internalMessage });
    case DISCORD_ERROR_CODES.UNKNOWN_CHANNEL:
      return new AppError('DISCORD_UNKNOWN_ROLE', {
        userMessage: 'Der konfigurierte Discord-Channel existiert nicht mehr.',
        internalMessage,
      });
    case DISCORD_ERROR_CODES.MISSING_ACCESS:
    case DISCORD_ERROR_CODES.MISSING_PERMISSIONS:
      return new AppError('DISCORD_MISSING_PERMISSIONS', { internalMessage });
    default:
      break;
  }

  if (error.status === 401 || error.status === 403) {
    return new AppError('DISCORD_MISSING_PERMISSIONS', { internalMessage });
  }
  if (error.status === 404) {
    return new AppError('DISCORD_UNKNOWN_MEMBER', { internalMessage });
  }
  if (error.status === 429) {
    return new AppError('DISCORD_RATE_LIMITED', { internalMessage });
  }
  return new AppError('DISCORD_UNAVAILABLE', { internalMessage });
}

/** Fehler, die beim Wiederherstellen einzelner Rollen toleriert werden duerfen. */
export function isRecoverableRoleError(error: unknown): boolean {
  if (!(error instanceof DiscordApiError)) {
    return false;
  }
  return (
    error.discordCode === DISCORD_ERROR_CODES.UNKNOWN_ROLE ||
    error.discordCode === DISCORD_ERROR_CODES.MISSING_PERMISSIONS ||
    error.discordCode === DISCORD_ERROR_CODES.MISSING_ACCESS ||
    error.status === 403 ||
    error.status === 404
  );
}
