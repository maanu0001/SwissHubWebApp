import { z } from 'zod';
import {
  aufgeteilteDauerInSekunden,
  AUFGETEILTE_DAUER_MAX,
  sanitizeText,
  snowflakeSchema,
} from '@swisshub/shared';
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

/**
 * Eine Dauer, die niemand in der Liste findet.
 *
 * Die Vorgaben oben decken den Alltag ab, und genau deshalb sind sie eine
 * Liste und kein Formular. Was sie nicht abdecken, ist der Einzelfall - «bis
 * Montagabend», «zwei Tage und ein bisschen». Wer den braucht, sollte nicht
 * die naechstbeste Vorgabe nehmen muessen.
 *
 * Gerechnet wird mit `aufgeteilteDauerInSekunden` aus `@swisshub/shared`:
 * dieselbe Funktion benutzt die Maske im Browser, und damit gibt es genau
 * eine Antwort darauf, wie lang «1 Tag 2 Stunden» ist.
 */
export const individuelleJailDauerSchema = z
  .object({
    tage: z.number().int().min(0).max(AUFGETEILTE_DAUER_MAX.tage),
    stunden: z.number().int().min(0).max(AUFGETEILTE_DAUER_MAX.stunden),
    minuten: z.number().int().min(0).max(AUFGETEILTE_DAUER_MAX.minuten),
  })
  .refine(
    (wert) => aufgeteilteDauerInSekunden(wert) >= MIN_JAIL_DURATION_SECONDS,
    `Bitte eine Dauer von mindestens ${MIN_JAIL_DURATION_SECONDS / 60} Minute angeben.`,
  );

export type IndividuelleJailDauer = z.infer<typeof individuelleJailDauerSchema>;

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

/**
 * Jail-Art.
 *
 * `PERMANENT` bedeutet: kein automatisches Ende. Freilassen bleibt jederzeit
 * über `jail.release` möglich - permanent heisst nicht unwiderruflich.
 */
export const jailTypeSchema = z.enum(['TEMPORARY', 'PERMANENT']);
export type JailTypeValue = z.infer<typeof jailTypeSchema>;

export const createJailSchema = z
  .object({
    targetDiscordId: snowflakeSchema,
    type: jailTypeSchema.default('TEMPORARY'),
    /** Nur bei `TEMPORARY` erforderlich - oder stattdessen `dauer`. */
    durationSeconds: jailDurationSchema.optional(),
    /**
     * Eine individuell eingegebene Dauer.
     *
     * Die Maske schickt die drei Felder so, wie sie eingetippt wurden, statt
     * eine fertige Sekundenzahl. Der Unterschied zaehlt: was der Server
     * prueft, ist dann die tatsaechliche Eingabe - «0 Tage, 0 Stunden, 0
     * Minuten» wird hier abgewiesen und nicht erst als Sekundenzahl, die
     * zufaellig zu klein ist.
     */
    dauer: individuelleJailDauerSchema.optional(),
    reason: jailReasonSchema,
    /**
     * Still: keine öffentliche Ankündigung. Ohne Angabe entscheidet die
     * Moduleinstellung `silentByDefault`.
     */
    silent: z.boolean().optional(),
    /** Verhindert doppelte Ausführung bei Doppelklick oder Retry. */
    idempotencyKey: z.string().uuid('Ungültiger Idempotency Key'),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'TEMPORARY' && value.durationSeconds === undefined && value.dauer === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'Bitte eine Dauer wählen.',
      });
    }
    // Beides zugleich waere zweideutig, und die Antwort «wir nehmen halt
    // eines davon» ist keine.
    if (value.durationSeconds !== undefined && value.dauer !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'Entweder eine vorgegebene oder eine individuelle Dauer - nicht beides.',
      });
    }
  })
  .transform(({ dauer, ...value }) => ({
    ...value,
    // Ab hier gibt es nur noch Sekunden. Die drei Felder sind eine Eingabe-
    // form und keine zweite Waehrung: Dienst, Scheduler und Akte rechnen
    // unveraendert mit `durationSeconds`.
    //
    // Ein permanenter Jail hat gar keine Dauer - kein kuenstliches
    // Ersatzdatum.
    durationSeconds:
      value.type === 'PERMANENT'
        ? null
        : dauer !== undefined
          ? aufgeteilteDauerInSekunden(dauer)
          : (value.durationSeconds ?? null),
  }));

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

/**
 * Vote Jail starten.
 *
 * Der Grund ist optional - die Abstimmung selbst ist die Begründung. Was
 * angegeben wird, landet im Discord-Embed und wird deshalb bereinigt.
 */
export const startVoteJailSchema = z.object({
  targetDiscordId: snowflakeSchema,
  reason: z
    .string()
    .max(500)
    .optional()
    .transform((value) => {
      const cleaned = value ? sanitizeText(value, 500) : '';
      return cleaned.length > 0 ? cleaned : null;
    }),
});

export type StartVoteJailFormInput = z.infer<typeof startVoteJailSchema>;

/**
 * Dauerangabe aus einem Slash Command lesen.
 *
 * Das Format stammt aus dem alten Bot und bleibt bewusst erhalten, damit das
 * Team seine Gewohnheiten behält: `10m`, `2h`, `3d` - eine blosse Zahl gilt
 * als Minuten. Zusätzlich wird `permanent` verstanden.
 *
 * Rückgabe:
 *   - `{ type: 'PERMANENT' }`             bei "permanent"/"unbegrenzt"
 *   - `{ type: 'TEMPORARY', seconds }`    bei einer gültigen Dauer
 *   - `null`                              bei einer unlesbaren Eingabe
 */
export function parseDurationInput(
  value: string,
): { type: 'PERMANENT' } | { type: 'TEMPORARY'; seconds: number } | null {
  const input = value.trim().toLowerCase();
  if (input.length === 0) {
    return null;
  }
  if (['permanent', 'unbegrenzt', 'unbefristet', 'perma', 'dauerhaft'].includes(input)) {
    return { type: 'PERMANENT' };
  }

  if (/^\d+$/u.test(input)) {
    const minutes = Number(input);
    return minutes > 0 ? toDuration(minutes * 60) : null;
  }

  const match = /^(\d+)\s*(minuten?|mins?|m|stunden?|std|h|tage?|tag|d|t|wochen?|w)$/u.exec(input);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  if (amount <= 0) {
    return null;
  }

  const seconds = /^(minuten?|mins?|m)$/u.test(unit)
    ? amount * 60
    : /^(stunden?|std|h)$/u.test(unit)
      ? amount * 3600
      : /^(wochen?|w)$/u.test(unit)
        ? amount * 7 * 86400
        : amount * 86400;

  return toDuration(seconds);
}

function toDuration(seconds: number): { type: 'TEMPORARY'; seconds: number } | null {
  if (seconds < MIN_JAIL_DURATION_SECONDS || seconds > JAIL_MAX_DURATION_SECONDS) {
    return null;
  }
  return { type: 'TEMPORARY', seconds };
}

/** Hinweistext bei einer unlesbaren Dauer - identisch für alle Befehle. */
export const DURATION_HINT =
  'Ungültigi Duur. Nutz zum Biispiel `10m`, `2h`, `3d` oder `permanent`. Ohni Iigab isch de Jail permanent.';
