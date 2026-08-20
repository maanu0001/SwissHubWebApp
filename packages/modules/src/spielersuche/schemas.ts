import { z } from 'zod';
import { sanitizeText, snowflakeSchema, optionalSnowflakeSchema } from '@swisshub/shared';

/**
 * Eingabevalidierung der Spielersuche.
 *
 * Dieselben Schemata prüfen Dashboard-Formulare und Slash-Command-Eingaben -
 * eine Regel, ein Ort.
 */

/** Obergrenze für "gsuechti Spieler" wie im alten Bot (`Range[int, 1, 20]`). */
export const MAX_REQUESTED_PLAYERS = 20;

export const gameNameSchema = z
  .string()
  .min(2, 'Der Name muss mindestens 2 Zeichen lang sein.')
  .max(60, 'Der Name darf maximal 60 Zeichen lang sein.')
  .transform((value) => sanitizeText(value, 60))
  .refine((value) => value.length >= 2, 'Bitte einen gültigen Namen angeben.');

/**
 * Banner-Adresse.
 *
 * Erlaubt ist ausschliesslich `https`. Discord-Anhangslinks werden auf die
 * stabile CDN-Form gebracht - `media.discordapp.net`-Links tragen Ablauf- und
 * Signaturparameter und wären nach einigen Stunden tot.
 */
export const bannerUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => normalizeBannerUrl(value ?? null))
  .refine((value) => value === null || value.startsWith('https://'), 'Nur https-Adressen sind erlaubt.');

export function normalizeBannerUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const raw = value.trim().replace(/^<|>$/gu, '');
  if (raw.length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  // Kein `http:`, kein `data:`, kein `javascript:`.
  if (parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isDiscordAttachment =
    (host === 'media.discordapp.net' || host === 'cdn.discordapp.com') &&
    parsed.pathname.startsWith('/attachments/');

  if (isDiscordAttachment) {
    // Ohne Query: `ex`, `is` und `hm` sind Ablaufzeitpunkt und Signatur.
    return `https://cdn.discordapp.com${parsed.pathname}`;
  }

  return parsed.toString();
}

/** Squad-Grösse. `null` bedeutet ausdrücklich "unbegrenzt". */
export const squadSizeSchema = z
  .union([z.number().int().min(2).max(99), z.null()])
  .optional()
  .transform((value) => value ?? null);

export const createGameSchema = z.object({
  name: gameNameSchema,
  roleId: snowflakeSchema,
  bannerUrl: bannerUrlSchema,
  maxSquadSize: squadSizeSchema,
  enabled: z.boolean().default(true),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;

export const updateGameSchema = createGameSchema.extend({
  gameId: z.string().cuid('Ungültige Spiel-ID'),
});

export type UpdateGameInput = z.infer<typeof updateGameSchema>;

export const gameIdSchema = z.object({ gameId: z.string().cuid('Ungültige Spiel-ID') });

/**
 * Eine Suche starten.
 *
 * `requestedPlayers` sind zusätzlich gesuchte Spieler - der Ersteller zählt
 * bereits als Teilnehmer. Die Prüfung gegen die Squad-Grösse des Spiels
 * passiert im Service, weil sie den aktuellen Spielstand braucht.
 */
export const createSearchSchema = z.object({
  gameId: z.string().cuid('Bitte ein Spiel auswählen.'),
  requestedPlayers: z
    .number({ invalid_type_error: 'Bitte eine Zahl angeben.' })
    .int()
    .min(1, 'Es muss mindestens ein Mitspieler gesucht werden.')
    .max(MAX_REQUESTED_PLAYERS, `Maximal ${MAX_REQUESTED_PLAYERS} zusätzliche Spieler.`),
  comment: z
    .string()
    .max(500, 'Der Kommentar darf maximal 500 Zeichen lang sein.')
    .optional()
    .transform((value) => {
      const cleaned = value ? sanitizeText(value, 500) : '';
      return cleaned.length > 0 ? cleaned : null;
    }),
  idempotencyKey: z.string().uuid('Ungültiger Idempotency Key'),
});

export type CreateSearchInput = z.infer<typeof createSearchSchema>;

export const matchIdSchema = z.object({ matchId: z.string().cuid('Ungültige Such-ID') });

export const closeSearchSchema = z.object({
  matchId: z.string().cuid('Ungültige Such-ID'),
  reason: z
    .string()
    .max(200)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 200) : undefined)),
});

export const searchListQuerySchema = z.object({
  tab: z.enum(['active', 'history']).default('active'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
  gameId: z.string().optional(),
  status: z.enum(['OPEN', 'COMPLETE', 'CLOSED', 'EXPIRED']).optional(),
  search: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
});

export type SearchListQuery = z.infer<typeof searchListQuerySchema>;

/** Onboarding-Testnachricht - bewusst ohne Parameter, damit nichts erratbar ist. */
export const sendOnboardingSchema = z.object({
  channelId: optionalSnowflakeSchema,
});
