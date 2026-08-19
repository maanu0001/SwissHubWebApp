import { z } from 'zod';
import { sanitizeText, snowflakeSchema } from '@swisshub/shared';
import { JAIL_MAX_DURATION_SECONDS } from './config';

/** Vordefinierte Dauern der Jail-Maske. */
export const JAIL_DURATION_PRESETS = [
  { label: '10 Minuten', seconds: 10 * 60 },
  { label: '30 Minuten', seconds: 30 * 60 },
  { label: '1 Stunde', seconds: 60 * 60 },
  { label: '2 Stunden', seconds: 2 * 60 * 60 },
  { label: '6 Stunden', seconds: 6 * 60 * 60 },
  { label: '12 Stunden', seconds: 12 * 60 * 60 },
  { label: '1 Tag', seconds: 24 * 60 * 60 },
  { label: '3 Tage', seconds: 3 * 24 * 60 * 60 },
  { label: '7 Tage', seconds: 7 * 24 * 60 * 60 },
] as const;

export const MIN_JAIL_DURATION_SECONDS = 60;

export const jailReasonSchema = z
  .string()
  .min(3, 'Bitte einen Grund mit mindestens 3 Zeichen angeben.')
  .max(500, 'Der Grund darf maximal 500 Zeichen lang sein.')
  .transform((value) => sanitizeText(value, 500))
  .refine((value) => value.length >= 3, 'Bitte einen aussagekräftigen Grund angeben.');

export const jailDurationSchema = z
  .number({ invalid_type_error: 'Bitte eine gültige Dauer wählen.' })
  .int()
  .min(MIN_JAIL_DURATION_SECONDS, 'Die Mindestdauer beträgt 1 Minute.')
  .max(JAIL_MAX_DURATION_SECONDS, 'Die gewählte Dauer ist zu lang.');

export const createJailSchema = z.object({
  targetDiscordId: snowflakeSchema,
  durationSeconds: jailDurationSchema,
  reason: jailReasonSchema,
  /** Verhindert doppelte Ausführung bei Doppelklick oder Retry. */
  idempotencyKey: z.string().uuid('Ungültiger Idempotency Key'),
});

export type CreateJailInput = z.infer<typeof createJailSchema>;

export const releaseJailSchema = z.object({
  jailId: z.string().cuid('Ungültige Jail-ID'),
  reason: z
    .string()
    .max(500)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 500) : undefined)),
  idempotencyKey: z.string().uuid('Ungültiger Idempotency Key'),
});

export type ReleaseJailInput = z.infer<typeof releaseJailSchema>;

export const jailListQuerySchema = z.object({
  tab: z.enum(['active', 'past']).default('active'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
  search: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
});

export type JailListQuery = z.infer<typeof jailListQuerySchema>;

/** Prüft die Dauer zusätzlich gegen die konfigurierte Obergrenze. */
export function assertDurationWithinLimit(durationSeconds: number, maxDurationSeconds: number): void {
  if (durationSeconds > maxDurationSeconds) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.too_big,
        maximum: maxDurationSeconds,
        type: 'number',
        inclusive: true,
        path: ['durationSeconds'],
        message: `Die maximale Jail-Dauer beträgt ${Math.floor(maxDurationSeconds / 3600)} Stunden.`,
      },
    ]);
  }
}
