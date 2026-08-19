const DEFAULT_LOCALE = 'de-CH';
const DEFAULT_TIMEZONE = 'Europe/Zurich';

export interface FormatOptions {
  locale?: string;
  timezone?: string;
}

/** `19.08.2026, 18:30` - the canonical SwissHub date/time rendering. */
export function formatDateTime(value: Date | string | number, options: FormatOptions = {}): string {
  const date = toDate(value);
  if (!date) {
    return '-';
  }
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    timeZone: options.timezone ?? DEFAULT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** `19.08.2026` */
export function formatDate(value: Date | string | number, options: FormatOptions = {}): string {
  const date = toDate(value);
  if (!date) {
    return '-';
  }
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    timeZone: options.timezone ?? DEFAULT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** `18:30` */
export function formatTime(value: Date | string | number, options: FormatOptions = {}): string {
  const date = toDate(value);
  if (!date) {
    return '-';
  }
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    timeZone: options.timezone ?? DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `2 Std. 15 Min.` - compact human readable duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 Min.';
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'Tag' : 'Tage'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} Std.`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes} Min.`);
  }
  if (parts.length === 0) {
    return 'weniger als 1 Min.';
  }
  return parts.join(' ');
}

/** Remaining time until `end`, already formatted. Returns `null` when expired. */
export function formatRemaining(end: Date | string | number, now: Date = new Date()): string | null {
  const date = toDate(end);
  if (!date) {
    return null;
  }
  const diff = date.getTime() - now.getTime();
  return diff <= 0 ? null : formatDuration(diff);
}

/** Discord dynamic timestamp markup, e.g. `<t:1755624600:f>`. */
export function discordTimestamp(value: Date, style: 'f' | 'F' | 'R' | 'd' | 't' = 'f'): string {
  return `<t:${Math.floor(value.getTime() / 1000)}:${style}>`;
}
