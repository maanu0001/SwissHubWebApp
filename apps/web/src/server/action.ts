import 'server-only';
import type { z } from 'zod';
import { assertMembership, assertPermission, verifyCsrfToken, type AuthContext } from '@swisshub/auth';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError, type ActionResult } from '@swisshub/shared';
import { getActionAuthContext } from './auth';
import { getRequestMetadata } from './request';
import { enforceRateLimit, type RateLimitName } from './rate-limit';

const log = createLogger('web:action');

/**
 * Zentrale Sicherheitskette fuer Server Actions.
 *
 * Reihenfolge (Fail Closed - jeder Schritt kann abbrechen):
 *   Authentifizierung -> Guild-Mitgliedschaft -> CSRF -> Rate Limit ->
 *   Validierung -> Autorisierung -> Ausfuehrung.
 *
 * Ein manipuliertes HTTP-Request kann dadurch nichts ausloesen, was der
 * angemeldete Benutzer ueber die UI nicht ebenfalls duerfte.
 */
export interface ActionDefinition<TSchema extends z.ZodTypeAny> {
  /** Interner Name (Logs, Rate-Limit-Bucket). */
  name: string;
  module?: string;
  /** Benoetigte Permission. */
  permission?: string;
  schema?: TSchema;
  rateLimit?: RateLimitName;
  /**
   * `critical` laedt die Discord-Rollen frisch, bevor autorisiert wird.
   * Standard fuer alle schreibenden Aktionen.
   */
  freshness?: 'cached' | 'critical';
  /** CSRF-Pruefung (Standard: an). */
  csrf?: boolean;
}

export interface ActionHandlerContext<TInput> {
  ctx: AuthContext;
  input: TInput;
  metadata: { ipHash: string | null; userAgent: string | null };
}

type ActionInput = Record<string, unknown> & { csrfToken?: string };

export function defineAction<TSchema extends z.ZodTypeAny, TResult>(
  definition: ActionDefinition<TSchema>,
  handler: (context: ActionHandlerContext<z.infer<TSchema>>) => Promise<TResult>,
): (input: ActionInput) => Promise<ActionResult<TResult>> {
  return async (rawInput: ActionInput): Promise<ActionResult<TResult>> => {
    const metadata = await getRequestMetadata();

    try {
      const context = await getActionAuthContext(definition.freshness ?? 'critical');

      if (!context) {
        await recordSecurityEvent({
          type: SECURITY_EVENTS.INVALID_SESSION,
          severity: 'LOW',
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
          path: definition.name,
        });
        throw new AppError('UNAUTHENTICATED');
      }

      assertMembership(context, { ...metadata, path: definition.name });

      if (definition.csrf !== false) {
        const token = typeof rawInput?.csrfToken === 'string' ? rawInput.csrfToken : null;
        if (!verifyCsrfToken(context.sessionId, token)) {
          await recordSecurityEvent({
            type: SECURITY_EVENTS.CSRF_FAILED,
            severity: 'HIGH',
            discordId: context.user.discordId,
            ipHash: metadata.ipHash,
            userAgent: metadata.userAgent,
            path: definition.name,
          });
          throw new AppError('FORBIDDEN', {
            userMessage: 'Sicherheitspruefung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.',
            internalMessage: 'CSRF-Token ungueltig',
          });
        }
      }

      if (definition.rateLimit) {
        await enforceRateLimit(definition.rateLimit, context.user.discordId);
      }

      let input = {} as z.infer<TSchema>;
      if (definition.schema) {
        const { csrfToken: _csrfToken, ...payload } = rawInput ?? {};
        const parsed = definition.schema.safeParse(payload);
        if (!parsed.success) {
          await recordSecurityEvent({
            type: SECURITY_EVENTS.INVALID_INPUT,
            severity: 'LOW',
            discordId: context.user.discordId,
            ipHash: metadata.ipHash,
            userAgent: metadata.userAgent,
            path: definition.name,
            metadata: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
          });
          throw new AppError('VALIDATION_FAILED', {
            details: { fieldErrors: flattenIssues(parsed.error) },
          });
        }
        input = parsed.data;
      }

      if (definition.permission) {
        await assertPermission(context, definition.permission, {
          ...metadata,
          path: definition.name,
          module: definition.module ?? null,
        });
      }

      const result = await handler({ ctx: context, input, metadata });
      return ok(result);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'INTERNAL') {
        log.error('Server Action fehlgeschlagen', { action: definition.name, error });
      } else {
        log.warn('Server Action abgelehnt', {
          action: definition.name,
          code: appError.code,
          reason: appError.internalMessage,
        });
      }
      return fail(appError);
    }
  };
}

function flattenIssues(error: z.ZodError): Record<string, string> {
  const output: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    output[key] ??= issue.message;
  }
  return output;
}
