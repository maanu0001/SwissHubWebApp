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

/**
 * Wen die Nachricht anpingen darf.
 *
 * Bewusst eine feste Auswahl statt eines Textfeldes: der alte Bot nahm hier
 * beliebigen Text entgegen und schrieb ihn unverändert in die Nachricht -
 * damit liess sich jede Rolle anpingen, unabhängig von der Berechtigung.
 */
export const mentionSchema = z.enum(['none', 'everyone', 'here', 'role', 'user']).default('none');

const baseFields = {
  channelId: snowflakeSchema,
  title: titleSchema,
  content: contentSchema,
  bannerUrl: bannerUrlSchema,
  mention: mentionSchema,
  /** Rollen- oder Benutzer-ID, je nach `mention`. */
  mentionTarget: snowflakeSchema.optional(),
  /** Alte Bezeichnung - bleibt, damit gespeicherte Formulare weiter passen. */
  mentionRoleId: snowflakeSchema.optional(),
  /** Verhindert doppeltes Senden bei Doppelklick oder Retry. */
  idempotencyKey: z.string().uuid('Ungültiger Idempotency Key'),
  /** Verbindet Browser-Anfrage, Server Action, Discord-Aufruf und Audit-Eintrag. */
  correlationId: z.string().max(64).optional(),
};

/** Ein Ziel muss da sein, wenn eine Rolle oder Person erwähnt werden soll. */
function requireMentionTarget(
  value: { mention: string; mentionTarget?: string; mentionRoleId?: string },
  ctx: z.RefinementCtx,
): void {
  const target = value.mentionTarget ?? value.mentionRoleId;
  if (value.mention === 'role' && !target) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mentionTarget'],
      message: 'Bitte eine Rolle wählen.',
    });
  }
  if (value.mention === 'user' && !target) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mentionTarget'],
      message: 'Bitte eine Person wählen.',
    });
  }
}

/** Wie man sich zu einem Event anmeldet. */
export const registrationTypeSchema = z.enum(['NONE', 'TEXT', 'TICKET', 'CHANNEL', 'URL']).default('NONE');

/** Freitext, Channel-ID oder Adresse - je nach Anmeldungsart. */
const registrationValueSchema = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value && value.length > 0 ? sanitizeText(value, 200) : undefined));

export const LOCATION_MAX = 200;

const locationSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Treffpunkt angeben.')
  .max(LOCATION_MAX)
  .transform((value) => sanitizeText(value, LOCATION_MAX));

export const sendNewsSchema = z.object(baseFields).superRefine(requireMentionTarget);

export const sendEventSchema = z
  .object({
    ...baseFields,
    /** Treffpunkt - beim Vorgänger ein Pflichtfeld, hier ebenso. */
    location: locationSchema,
    /**
     * ISO-Zeitpunkt in UTC. Die Oberfläche rechnet aus Europe/Zurich um.
     *
     * Der Slash Command darf stattdessen `startsAtText` liefern: das
     * Discord-Modal kennt keinen Datumsauswähler, und freien Text lässt sich
     * nicht zuverlässig deuten.
     */
    startsAt: z
      .string()
      .datetime({ message: 'Bitte ein gültiges Datum und eine Uhrzeit wählen.' })
      .transform((value) => new Date(value))
      .optional(),
    startsAtText: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => (value && value.length > 0 ? sanitizeText(value, 120) : undefined)),
    responsibleDiscordId: snowflakeSchema.optional(),
    registrationType: registrationTypeSchema,
    registrationValue: registrationValueSchema,
  })
  .superRefine((value, ctx) => {
    requireMentionTarget(value, ctx);

    if (!value.startsAt && !value.startsAtText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startsAt'],
        message: 'Bitte ein Datum und eine Uhrzeit wählen.',
      });
    }
    if (value.registrationType === 'TEXT' && !value.registrationValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationValue'],
        message: 'Bitte angeben, wie man sich anmeldet.',
      });
    }
    if (value.registrationType === 'CHANNEL' && !value.registrationValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationValue'],
        message: 'Bitte einen Channel wählen.',
      });
    }
    if (value.registrationType === 'URL') {
      const issue = value.registrationValue
        ? validateBannerUrl(value.registrationValue)
        : 'Bitte eine Adresse angeben.';
      if (issue) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['registrationValue'], message: issue });
      }
    }
  });

export const sendPollSchema = z.object(baseFields).superRefine(requireMentionTarget);

export type SendNewsInput = z.infer<typeof sendNewsSchema>;
export type SendEventInput = z.infer<typeof sendEventSchema>;
export type SendPollInput = z.infer<typeof sendPollSchema>;

export const communicationHistoryQuerySchema = z.object({
  type: z.enum(['ALL', 'NEWS', 'EVENT', 'POLL']).default('ALL'),
  status: z.enum(['ALL', 'SENT', 'FAILED', 'DELETED']).default('ALL'),
  channelId: z.string().optional(),
  sentBy: z.string().optional(),
  /** Freitextsuche über Titel und Inhalt. */
  search: z.string().trim().max(120).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

/**
 * Filter aus der Adresszeile lesen.
 *
 * Bewusst nachsichtig: Adressparameter kommen aus einem Lesezeichen, einem
 * Link oder von Hand. Etwas Unsinniges darin soll die Seite nicht mit einem
 * Fehler abbrechen lassen - dann wird eben der Standardwert genommen.
 */
export function parseHistoryQuery(params: Record<string, string | undefined>): CommunicationHistoryQuery {
  const parsed = communicationHistoryQuerySchema.safeParse(params);
  if (parsed.success) {
    return parsed.data;
  }
  // Feld für Feld erneut versuchen, damit ein einzelner unsinniger Wert nicht
  // sämtliche übrigen Filter verwirft.
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    const attempt = communicationHistoryQuerySchema.safeParse({ [key]: value });
    if (attempt.success) {
      cleaned[key] = value;
    }
  }
  return communicationHistoryQuerySchema.parse(cleaned);
}

/** Ein Entwurf - dieselben Felder, aber nichts davon ist Pflicht ausser Titel und Text. */
export const draftSchema = z.object({
  id: z.string().cuid().optional(),
  type: z.enum(['NEWS', 'EVENT', 'POLL']),
  title: titleSchema,
  content: contentSchema,
  bannerUrl: bannerUrlSchema,
  channelId: snowflakeSchema.optional(),
  mention: mentionSchema,
  mentionTarget: snowflakeSchema.optional(),
  location: z
    .string()
    .trim()
    .max(LOCATION_MAX)
    .optional()
    .transform((value) => (value && value.length > 0 ? sanitizeText(value, LOCATION_MAX) : undefined)),
  startsAt: z
    .string()
    .datetime()
    .transform((value) => new Date(value))
    .optional(),
  responsibleDiscordId: snowflakeSchema.optional(),
  registrationType: registrationTypeSchema,
  registrationValue: registrationValueSchema,
});

export type DraftInput = z.infer<typeof draftSchema>;

export type CommunicationHistoryQuery = z.infer<typeof communicationHistoryQuerySchema>;
