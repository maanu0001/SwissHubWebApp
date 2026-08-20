import { z } from 'zod';
import { sanitizeText, snowflakeSchema } from '@swisshub/shared';
import { MAX_LEVEL } from './curve';
import { GAME_KINDS } from './game-rules';

/**
 * Eingabevalidierung des Level-Systems.
 *
 * Dieselben Schemata prüfen Dashboard-Formulare und Slash-Command-Eingaben -
 * eine Regel, ein Ort.
 */

export const adjustXpSchema = z.object({
  discordId: snowflakeSchema,
  /** Positiv = vergeben, negativ = entziehen. */
  amount: z
    .number()
    .int('Bitte eine ganze Zahl angeben.')
    .refine((value) => value !== 0, 'Bitte eine Anzahl ungleich null angeben.')
    .refine((value) => Math.abs(value) <= 10_000_000, 'Das ist zu viel auf einmal.'),
  reason: z
    .string()
    .max(200)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 200) : undefined)),
});

export type AdjustXpInputSchema = z.infer<typeof adjustXpSchema>;

export const milestoneSchema = z.object({
  level: z
    .number()
    .int()
    .min(1, 'Das kleinste Level ist 1.')
    .max(MAX_LEVEL, `Das grösste Level ist ${MAX_LEVEL}.`),
  roleId: snowflakeSchema,
  enabled: z.boolean().default(true),
});

export const milestoneDeleteSchema = z.object({
  level: z.number().int().min(1).max(MAX_LEVEL),
});

export const cancelGameSchema = z.object({
  matchId: z.string().min(1),
  reason: z
    .string()
    .max(200)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 200) : undefined)),
});

export const gameKindSchema = z.enum(GAME_KINDS);

export const runDecaySchema = z.object({
  /** Wie viele Profile ein Durchgang höchstens anfasst. */
  limit: z.number().int().min(1).max(2000).default(500),
});

export const reconcileSchema = z.object({
  limit: z.number().int().min(1).max(5000).default(2000),
});

export const importConfirmSchema = z.object({
  importId: z.string().min(1),
  /**
   * Ohne diese Bestätigung wird nichts übernommen: liefe der alte Bot weiter,
   * vergäben zwei Bots gleichzeitig XP.
   */
  legacyBotStopped: z.literal(true, {
    errorMap: () => ({ message: 'Bitte bestätigen, dass der alte Level-Bot abgeschaltet ist.' }),
  }),
  importSettings: z.boolean().default(true),
});

export const importDiscardSchema = z.object({
  importId: z.string().min(1),
});

export const envImportSchema = z.object({
  /** Nur Namen von der Positivliste - der Dienst prüft das erneut. */
  keys: z.array(z.string().max(64)).max(50),
});
