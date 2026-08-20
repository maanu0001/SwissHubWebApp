import { z } from 'zod';
import { sanitizeText, snowflakeSchema } from '@swisshub/shared';

/**
 * Eingaben des Kommunikationsmoduls.
 *
 * Alles, was später in einem Discord-Embed landet, wird hier bereinigt und
 * begrenzt. Der tatsächliche Discord-Payload wird ausschliesslich aus diesen
 * validierten Werten gebaut - nie aus dem, was der Browser vorschlägt.
 */

/** Discord-Grenzen für Embeds. */
export const TITLE_MAX = 256;
export const CONTENT_MAX = 3000;

const titleSchema = z
  .string()
  .min(3, 'Bitte einen Titel mit mindestens 3 Zeichen angeben.')
  .max(TITLE_MAX)
  .transform((value) => sanitizeText(value, TITLE_MAX));

const contentSchema = z
  .string()
  .min(3, 'Bitte einen Text mit mindestens 3 Zeichen angeben.')
  .max(CONTENT_MAX)
  // Zeilenumbrüche bleiben erhalten - sie gehören zur Formatierung.
  .transform((value) => sanitizeText(value, CONTENT_MAX, { keepNewlines: true }));

/**
 * Banner-URL.
 *
 * Nur `https`. `javascript:`, `data:` und `file:` sind damit ausgeschlossen,
 * ebenso Adressen ohne Host. Der Bot lädt das Bild nicht selbst herunter -
 * Discord holt es direkt, deshalb entsteht hier kein SSRF-Pfad über unseren
 * Server. Trotzdem werden interne Ziele abgelehnt, damit das Feld nicht als
 * Sonde für das interne Netz taugt.
 */
export const bannerUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .superRefine((value, ctx) => {
    if (value === undefined) {
      return;
    }
    const issue = validateBannerUrl(value);
    if (issue) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }
  });

const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|0\.0\.0\.0)/iu;

/** Gibt die Fehlermeldung zurück oder `null`, wenn die URL in Ordnung ist. */
export function validateBannerUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Bitte eine vollständige URL angeben (https://...).';
  }
  if (url.protocol !== 'https:') {
    return 'Nur https-Adressen sind erlaubt.';
  }
  if (url.hostname.length === 0 || PRIVATE_HOST_PATTERN.test(url.hostname)) {
    return 'Diese Adresse ist nicht erlaubt.';
  }
  return null;
}

/** Wen die Nachricht anpingen darf. */
export const mentionSchema = z.enum(['none', 'everyone', 'here', 'role']).default('none');

const baseFields = {
  channelId: snowflakeSchema,
  title: titleSchema,
  content: contentSchema,
  bannerUrl: bannerUrlSchema,
  mention: mentionSchema,
  mentionRoleId: snowflakeSchema.optional(),
  /** Verhindert doppeltes Senden bei Doppelklick oder Retry. */
  idempotencyKey: z.string().uuid('Ungültiger Idempotency Key'),
};

export const sendNewsSchema = z.object(baseFields).superRefine((value, ctx) => {
  if (value.mention === 'role' && !value.mentionRoleId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mentionRoleId'],
      message: 'Bitte eine Rolle wählen.',
    });
  }
});

export const sendEventSchema = z
  .object({
    ...baseFields,
    /** ISO-Zeitpunkt in UTC. Die Oberfläche rechnet aus Europe/Zurich um. */
    startsAt: z
      .string()
      .datetime({ message: 'Bitte ein gültiges Datum und eine Uhrzeit wählen.' })
      .transform((value) => new Date(value)),
    responsibleDiscordId: snowflakeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mention === 'role' && !value.mentionRoleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mentionRoleId'],
        message: 'Bitte eine Rolle wählen.',
      });
    }
  });

export const sendPollSchema = z.object(baseFields);

export type SendNewsInput = z.infer<typeof sendNewsSchema>;
export type SendEventInput = z.infer<typeof sendEventSchema>;
export type SendPollInput = z.infer<typeof sendPollSchema>;

export const communicationHistoryQuerySchema = z.object({
  type: z.enum(['ALL', 'NEWS', 'EVENT', 'POLL']).default('ALL'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export type CommunicationHistoryQuery = z.infer<typeof communicationHistoryQuerySchema>;
