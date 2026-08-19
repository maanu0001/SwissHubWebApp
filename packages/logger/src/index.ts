import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that adds `bindings` to every record. */
  child(bindings: LogContext): Logger;
}

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/** Human readable output during development, newline delimited JSON otherwise. */
function prettyPrint(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.LOG_FORMAT !== 'json';
}

function emit(
  level: LogLevel,
  name: string,
  bindings: LogContext,
  message: string,
  context?: LogContext,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) {
    return;
  }
  const merged = { ...bindings, ...context };
  const safeContext = redact(merged) as LogContext;
  const safeMessage = String(redact(message));

  const line = prettyPrint()
    ? `${level.toUpperCase().padEnd(5)} [${name}] ${safeMessage}${
        Object.keys(merged).length > 0 ? ` ${JSON.stringify(safeContext)}` : ''
      }`
    : JSON.stringify({
        level,
        time: new Date().toISOString(),
        logger: name,
        msg: safeMessage,
        ...safeContext,
      });

  if (level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function createLogger(name: string, bindings: LogContext = {}): Logger {
  return {
    debug: (message, context) => emit('debug', name, bindings, message, context),
    info: (message, context) => emit('info', name, bindings, message, context),
    warn: (message, context) => emit('warn', name, bindings, message, context),
    error: (message, context) => emit('error', name, bindings, message, context),
    child: (extra) => createLogger(name, { ...bindings, ...extra }),
  };
}

/** Default application logger. */
export const logger = createLogger('swisshub');

export { redact, redactString, REDACTED } from './redact';
