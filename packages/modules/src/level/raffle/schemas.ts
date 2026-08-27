import { z } from 'zod';
import { optionalSnowflakeSchema, sanitizeText } from '@swisshub/shared';
import { PERCENTAGE_SCALE } from './entry-cost';

/**
 * Eingabeprüfung für Verlosungen.
 *
 * Dieselben Schemata prüfen das Dashboard-Formular und alles, was über die
 * Server Actions hereinkommt. Der Browser darf keine dieser Regeln umgehen.
 */

export interface RaffleActor {
  discordId: string;
  username: string;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => sanitizeText(value, max));

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => (value ? sanitizeText(value, max) : ''));

/** Leere Eingabe heisst "nicht gesetzt", nicht "null Uhr". */
const optionalDate = z
  .union([z.date(), z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  });

const optionalPositiveInt = (max: number) =>
  z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return Math.min(Math.max(Math.trunc(parsed), 0), max);
    });

export const raffleSchema = z
  .object({
    title: text(120).refine((value) => value.length > 0, 'Bitte einen Titel angeben.'),
    description: optionalText(2000),
    bannerPath: optionalText(120),
    bannerUrl: optionalText(1000),

    prizeKind: z.enum(['EXTERNAL_PRIZE', 'XP_PRIZE', 'ROLE_PRIZE', 'TEXT_ONLY']),
    prizeDescription: text(500).refine((value) => value.length > 0, 'Bitte den Gewinn beschreiben.'),
    prizeXp: optionalPositiveInt(10_000_000),
    prizeRoleId: optionalSnowflakeSchema,

    entryModel: z.enum(['FIXED', 'PERCENTAGE']),
    fixedEntryXp: optionalPositiveInt(10_000_000),
    /** Als Prozentzahl eingegeben, intern in Basispunkten geführt. */
    percentage: z
      .union([z.number(), z.string(), z.null()])
      .optional()
      .transform((value) => {
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }),
    minimumEntryXp: optionalPositiveInt(10_000_000),
    maximumEntryXp: optionalPositiveInt(10_000_000),

    minimumParticipants: z.coerce.number().int().min(1).max(100_000).default(2),
    maximumParticipants: optionalPositiveInt(1_000_000),

    entryStartsAt: optionalDate,
    entryEndsAt: optionalDate,
    drawScheduledAt: optionalDate,
    autoDraw: z.coerce.boolean().default(false),

    participantsPublic: z.coerce.boolean().default(true),
    autoAnnounceWinner: z.coerce.boolean().default(true),
    discordChannelId: optionalSnowflakeSchema,
  })
  .transform((input) => ({
    ...input,
    percentageBasisPoints:
      input.percentage === null ? null : Math.round(input.percentage * (PERCENTAGE_SCALE / 100)),
  }))
  .superRefine((input, ctx) => {
    if (input.entryModel === 'FIXED' && input.fixedEntryXp === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['fixedEntryXp'],
        message: 'Bitte den Einsatz in XP angeben.',
      });
    }
    if (input.entryModel === 'PERCENTAGE') {
      if (input.percentageBasisPoints === null || input.percentageBasisPoints <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['percentage'],
          message: 'Bitte einen Anteil grösser als 0 % angeben.',
        });
      } else if (input.percentageBasisPoints > PERCENTAGE_SCALE) {
        ctx.addIssue({
          code: 'custom',
          path: ['percentage'],
          message: 'Mehr als 100 % der eigenen XP sind nicht möglich.',
        });
      }
    }
    if (input.prizeKind === 'XP_PRIZE' && (input.prizeXp === null || input.prizeXp <= 0)) {
      ctx.addIssue({ code: 'custom', path: ['prizeXp'], message: 'Bitte die XP-Gutschrift angeben.' });
    }
    if (input.prizeKind === 'ROLE_PRIZE' && !input.prizeRoleId) {
      ctx.addIssue({ code: 'custom', path: ['prizeRoleId'], message: 'Bitte die Rolle auswählen.' });
    }
  });

export type RaffleInput = z.infer<typeof raffleSchema>;

/** Eine Neuziehung verlangt immer einen Grund - sie greift in ein Ergebnis ein. */
export const redrawSchema = z.object({
  raffleId: z.string().min(1),
  reason: text(300).refine(
    (value) => value.length >= 5,
    'Bitte einen nachvollziehbaren Grund angeben (mindestens 5 Zeichen).',
  ),
  excludePreviousWinner: z.coerce.boolean().default(true),
});

export const cancelRaffleSchema = z.object({
  raffleId: z.string().min(1),
  reason: text(300).refine((value) => value.length >= 5, 'Bitte einen Grund angeben.'),
});

export const removeEntrySchema = z.object({
  entryId: z.string().min(1),
  reason: text(300).refine((value) => value.length >= 5, 'Bitte einen Grund angeben.'),
});

/**
 * Eine Verlosung löschen.
 *
 * Wie bei Abbruch und Neuziehung Pflichtgrund: der Schritt lässt sich nicht
 * rückgängig machen, und nach dem Löschen ist der Eintrag im Audit Log die
 * einzige verbliebene Auskunft darüber, dass es diese Verlosung gab.
 */
export const deleteRaffleSchema = z.object({
  raffleId: z.string().min(1),
  reason: text(300).refine((value) => value.length >= 5, 'Bitte einen Grund angeben.'),
});
