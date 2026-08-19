import { discordConfig } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { DiscordApiError, type DiscordErrorBody } from './errors';

const log = createLogger('discord:rest');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const USER_AGENT = 'SwissHubBotWebApp (https://github.com/maanu0001/SwissHub_Bot-WebApp, 1.0.0)';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Bucket, in dem Anfragen serialisiert werden (Standard: Route). */
  bucket?: string;
  /** Reason header, sichtbar im Discord Audit Log. */
  auditLogReason?: string;
  /** Alternativer Authorization Header (z.B. `Bearer` beim OAuth Flow). */
  authorization?: string;
  signal?: AbortSignal;
}

interface BucketState {
  /** Zeitpunkt, ab dem wieder gesendet werden darf. */
  resetAt: number;
  chain: Promise<unknown>;
}

const buckets = new Map<string, BucketState>();
let globalResetAt = 0;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function bucketKey(method: string, route: string, override?: string): string {
  if (override) {
    return override;
  }
  // Major parameters (guild/channel id) bleiben erhalten, restliche IDs werden
  // generalisiert, damit sich Anfragen desselben Endpunkts einen Bucket teilen.
  const generalised = route
    .replace(/\/guilds\/(\d+)/u, '/guilds/$1')
    .replace(/\/channels\/(\d+)/u, '/channels/$1')
    .replace(/\/(?:members|roles|users)\/\d+/gu, (match) => match.replace(/\d+/u, ':id'));
  return `${method} ${generalised}`;
}

/**
 * Führt eine Discord REST Anfrage aus.
 *
 * - Anfragen desselben Buckets laufen seriell (keine aggressiven Parallelbursts).
 * - `429` wird respektiert (inkl. globalem Limit) und begrenzt wiederholt.
 * - 5xx werden mit Backoff wiederholt.
 */
export async function discordRequest<T>(route: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const key = bucketKey(method, route, options.bucket);
  const state = buckets.get(key) ?? { resetAt: 0, chain: Promise.resolve() };
  buckets.set(key, state);

  const run = state.chain.then(
    () => execute<T>(route, method, options, state),
    () => execute<T>(route, method, options, state),
  );
  // Fehler dürfen die Kette nicht unterbrechen.
  state.chain = run.catch(() => undefined);
  return run;
}

async function execute<T>(
  route: string,
  method: string,
  options: RequestOptions,
  state: BucketState,
): Promise<T> {
  const url = new URL(`${discordConfig.apiBaseUrl}${route}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const waitFor = Math.max(state.resetAt - Date.now(), globalResetAt - Date.now(), 0);
    if (waitFor > 0) {
      await sleep(Math.min(waitFor, 10_000));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: buildHeaders(options),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === MAX_RETRIES) {
        throw new DiscordApiError(0, undefined, route, `Netzwerkfehler: ${(error as Error).message}`);
      }
      await sleep(250 * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timeout);
    }

    trackRateLimitHeaders(response, state);

    if (response.status === 429) {
      const body = (await safeJson(response)) as DiscordErrorBody | null;
      const retryAfterMs = Math.min((body?.retry_after ?? 1) * 1000, 30_000);
      if (body?.global) {
        globalResetAt = Date.now() + retryAfterMs;
      } else {
        state.resetAt = Date.now() + retryAfterMs;
      }
      log.warn('Discord Rate Limit erreicht', { route, retryAfterMs, global: body?.global ?? false });
      if (attempt === MAX_RETRIES) {
        throw new DiscordApiError(429, body?.code, route, 'Rate Limit');
      }
      await sleep(retryAfterMs);
      continue;
    }

    if (response.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new DiscordApiError(response.status, undefined, route, 'Discord Serverfehler');
      }
      await sleep(300 * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      const body = (await safeJson(response)) as DiscordErrorBody | null;
      throw new DiscordApiError(
        response.status,
        body?.code,
        route,
        body?.message ?? `HTTP ${response.status}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  throw new DiscordApiError(0, undefined, route, 'Anfrage konnte nicht ausgeführt werden');
}

function buildHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: options.authorization ?? `Bot ${discordConfig.botToken}`,
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.auditLogReason) {
    headers['X-Audit-Log-Reason'] = encodeURIComponent(options.auditLogReason.slice(0, 400));
  }
  return headers;
}

function trackRateLimitHeaders(response: Response, state: BucketState): void {
  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
  if (Number.isFinite(remaining) && remaining <= 0 && Number.isFinite(resetAfter)) {
    state.resetAt = Date.now() + resetAfter * 1000;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Nur für Tests: setzt die Rate-Limit-Buchhaltung zurück. */
export function resetRestState(): void {
  buckets.clear();
  globalResetAt = 0;
}
