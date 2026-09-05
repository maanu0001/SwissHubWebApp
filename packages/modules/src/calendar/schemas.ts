import { z } from 'zod';
import { optionalSnowflakeSchema, ortszeitAlsUtc, sanitizeText } from '@swisshub/shared';
import { validateBannerUrl } from '../communication/schemas';
import { DEFAULT_TIMEZONE } from './config';

/**
 * Eingabeprüfung des Kalendermoduls.
 *
 * Dieselben Schemata prüfen das Formular im Dashboard und alles, was über die
 * Server Actions hereinkommt. Der Browser darf keine dieser Regeln umgehen.
 */

export interface CalendarActor {
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
    .transform((value) => (value && value.trim().length > 0 ? sanitizeText(value, max) : null));

/**
 * Ein Datumsfeld aus dem Formular.
 *
 * Zwei Schreibweisen kommen an: eine vollstaendige Zeitangabe (mit `Z` oder
 * Versatz), wie sie eine Server Action schickt, und eine blosse Ortszeit
 * (`2026-09-04T20:00`), wie sie `<input type="datetime-local">` liefert. Das
 * Feld kennt keine Zeitzone - es zeigt nur, was drinsteht.
 *
 * Die blosse Ortszeit mit `new Date()` zu lesen hiesse, sie in der Zone des
 * **Servers** zu deuten. Fuer ein Event in einer anderen Zone waere das
 * schlicht falsch, und die richtige Antwort haenge daran, wie der Container
 * gestartet wurde. Deshalb wird sie hier ausdruecklich in der Zone des
 * Events gerechnet - das ist auch die Stelle, an der die Zeitumstellung
 * richtig behandelt wird.
 */
const NUR_ORTSZEIT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/u;

export function leseZeitpunkt(wert: Date | string, zone: string): Date | null {
  if (wert instanceof Date) {
    return Number.isNaN(wert.getTime()) ? null : wert;
  }
  const treffer = NUR_ORTSZEIT.exec(wert.trim());
  if (treffer) {
    return ortszeitAlsUtc(
      zone,
      Number(treffer[1]),
      Number(treffer[2]),
      Number(treffer[3]),
      Number(treffer[4]),
      Number(treffer[5]),
    );
  }
  const datum = new Date(wert);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/** Roher Wert - die Umrechnung geschieht erst, wenn die Zone feststeht. */
const rohesDatum = z.union([z.date(), z.string()]);
const optionalRohesDatum = z.union([z.date(), z.string(), z.null()]).optional();

const optionalUrl = z
  .string()
  .max(1000)
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : null));

/**
 * Zeitzonen-Kennung, die diese Laufzeitumgebung wirklich kennt.
 *
 * Geprüft statt aus einer Liste gewählt: die Liste veraltet, `Intl` nicht.
 * Ein unbekannter Name liesse später jede Datumsformatierung scheitern.
 */
export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .default(DEFAULT_TIMEZONE)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('de-CH', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Diese Zeitzone ist unbekannt.');

export const questionInputSchema = z.object({
  id: z.string().optional(),
  label: text(120).refine((value) => value.length > 0, 'Bitte die Frage benennen.'),
  hint: optionalText(200),
  required: z.coerce.boolean().default(false),
  /** Leer = Freitext. Mit Einträgen wird daraus eine Auswahl. */
  choices: z.array(text(80)).max(20).default([]),
});

export const eventInputSchema = z
  .object({
    title: text(140).refine((value) => value.length > 0, 'Bitte einen Namen angeben.'),
    description: text(8000).refine((value) => value.length > 0, 'Bitte eine Beschreibung angeben.'),
    shortDescription: optionalText(200),
    categoryId: z
      .string()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : null)),

    startAt: rohesDatum,
    endAt: optionalRohesDatum,
    timezone: timezoneSchema,
    allDay: z.coerce.boolean().default(false),

    /**
     * Zwei Arten, nicht vier.
     *
     * «Online» und «Hybrid» klangen nach einer Wahl, waren aber keine:
     * «Online» hiess in der Praxis Discord, «Hybrid» hiess hinfahren. Wer
     * das Formular ausfuellte, musste vier Moeglichkeiten abwaegen, um
     * zwischen zwei zu entscheiden. Alte Zeilen behalten ihren Wert - siehe
     * `ortsArt`.
     */
    locationKind: z.enum(['DISCORD', 'REAL_LIFE']).default('DISCORD'),
    locationChannelId: optionalSnowflakeSchema,
    locationVoiceId: optionalSnowflakeSchema,
    locationUrl: optionalUrl,
    locationName: optionalText(160),
    locationAddress: optionalText(300),

    bannerUrl: optionalUrl,
    iconUrl: optionalUrl,

    organizerDiscordIds: z.array(z.string()).max(20).default([]),
    contactNote: optionalText(200),

    registrationEnabled: z.coerce.boolean().default(false),
    capacity: z.coerce.number().int().min(0).max(100_000).default(0),
    registrationClosesAt: optionalRohesDatum,
    waitlistEnabled: z.coerce.boolean().default(true),
    allowSelfCancel: z.coerce.boolean().default(true),
    cancelDeadlineAt: optionalRohesDatum,
    participantsPublic: z.coerce.boolean().default(true),

    announceOnDiscord: z.coerce.boolean().default(false),
    announcementChannelId: optionalSnowflakeSchema,
    mentionRoleId: optionalSnowflakeSchema,

    /** Vorlaufzeiten in Minuten. Doppelte werden verworfen. */
    reminderMinutes: z
      .array(
        z.coerce
          .number()
          .int()
          .min(1)
          .max(60 * 24 * 30),
      )
      .max(10)
      .default([])
      .transform((value) => [...new Set(value)].sort((a, b) => b - a)),
    reminderChannelId: optionalSnowflakeSchema,
    reminderMentionRoleId: optionalSnowflakeSchema,
    reminderMentionRegistrants: z.coerce.boolean().default(false),

    questions: z.array(questionInputSchema).max(10).default([]),
  })
  // Erst hier stehen Zeiten und Zone zusammen zur Verfuegung - vorher liesse
  // sich eine blosse Ortszeit nicht deuten.
  .transform((input) => ({
    ...input,
    startAt: leseZeitpunkt(input.startAt, input.timezone),
    endAt: input.endAt ? leseZeitpunkt(input.endAt, input.timezone) : null,
    registrationClosesAt: input.registrationClosesAt
      ? leseZeitpunkt(input.registrationClosesAt, input.timezone)
      : null,
    cancelDeadlineAt: input.cancelDeadlineAt ? leseZeitpunkt(input.cancelDeadlineAt, input.timezone) : null,
  }))
  .superRefine((input, ctx) => {
    if (!input.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['startAt'],
        message: 'Bitte ein gültiges Datum und eine Uhrzeit wählen.',
      });
      return;
    }
    if (input.endAt && input.endAt <= input.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'Das Ende muss nach dem Beginn liegen.',
      });
    }
    if (input.registrationClosesAt && input.registrationClosesAt > input.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['registrationClosesAt'],
        message: 'Der Anmeldeschluss kann nicht nach dem Beginn liegen.',
      });
    }
    if (input.cancelDeadlineAt && input.cancelDeadlineAt > input.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['cancelDeadlineAt'],
        message: 'Der Abmeldeschluss kann nicht nach dem Beginn liegen.',
      });
    }
    for (const [feld, wert] of [
      ['locationUrl', input.locationUrl],
      ['bannerUrl', input.bannerUrl],
      ['iconUrl', input.iconUrl],
    ] as const) {
      if (wert) {
        const problem = validateBannerUrl(wert);
        if (problem) {
          ctx.addIssue({ code: 'custom', path: [feld], message: problem });
        }
      }
    }
    if (input.locationKind === 'REAL_LIFE' && !input.locationName) {
      ctx.addIssue({
        code: 'custom',
        path: ['locationName'],
        message: 'Bitte den Veranstaltungsort angeben.',
      });
    }
    if (input.announceOnDiscord && !input.announcementChannelId) {
      // Ohne Kanal ginge die Ankuendigung ins Leere - und niemand merkte es.
      ctx.addIssue({
        code: 'custom',
        path: ['announcementChannelId'],
        message: 'Bitte einen Channel für die Ankündigung wählen.',
      });
    }
    if (!input.registrationEnabled && input.capacity > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: 'Eine Teilnehmerzahl ergibt nur mit aktivierter Anmeldung Sinn.',
      });
    }
  });

export type EventInput = z.infer<typeof eventInputSchema>;

export const eventIdSchema = z.object({ eventId: z.string().min(1) });

export const cancelEventSchema = z.object({
  eventId: z.string().min(1),
  reason: text(300).refine((value) => value.length >= 5, 'Bitte einen Grund angeben.'),
  /** Angemeldete über die Absage benachrichtigen. */
  notifyParticipants: z.coerce.boolean().default(true),
});

export const deleteEventSchema = z.object({
  eventId: z.string().min(1),
  reason: text(300).refine((value) => value.length >= 5, 'Bitte einen Grund angeben.'),
});

export const duplicateEventSchema = z
  .object({
    eventId: z.string().min(1),
    startAt: rohesDatum,
    endAt: optionalRohesDatum,
    /** Zone des neuen Termins - wie beim Anlegen. */
    timezone: timezoneSchema,
    title: optionalText(140),
  })
  .transform((input) => ({
    ...input,
    startAt: leseZeitpunkt(input.startAt, input.timezone),
    endAt: input.endAt ? leseZeitpunkt(input.endAt, input.timezone) : null,
  }))
  .superRefine((input, ctx) => {
    if (!input.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['startAt'],
        message: 'Bitte ein gültiges Datum und eine Uhrzeit wählen.',
      });
    }
  });

export const registerSchema = z.object({
  eventId: z.string().min(1),
  answers: z.record(z.string(), z.string().max(500)).default({}),
});

export const registrationIdSchema = z.object({ registrationId: z.string().min(1) });

export const removeRegistrationSchema = z.object({
  registrationId: z.string().min(1),
  reason: optionalText(300),
});

export const notifyChangeSchema = z.object({
  eventId: z.string().min(1),
  message: optionalText(500),
});

export const categoryInputSchema = z
  .object({
    id: z.string().optional(),
    name: text(60).refine((value) => value.length > 0, 'Bitte einen Namen angeben.'),
    description: optionalText(200),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/u, 'Bitte eine Hex-Farbe wie #83060A angeben.')
      .default('#83060A'),
    icon: optionalText(40),
    /**
     * Vorgabe-Banner der Kategorie.
     *
     * Wiederkehrende Reihen haben ihr eigenes Bild. Es an jedem einzelnen
     * Termin nachzutragen ist Arbeit, die niemand zwanzigmal richtig macht -
     * und eine vergessene Zeile heisst nackte Ankuendigung.
     */
    defaultBannerUrl: optionalUrl,
    active: z.coerce.boolean().default(true),
    position: z.coerce.number().int().min(0).max(999).default(0),
  })
  .superRefine((input, ctx) => {
    // Dieselbe Pruefung wie beim Banner eines Termins: eine Adresse, die
    // Discord nicht laedt, faellt sonst erst im Kanal auf.
    if (input.defaultBannerUrl) {
      const problem = validateBannerUrl(input.defaultBannerUrl);
      if (problem) {
        ctx.addIssue({ code: 'custom', path: ['defaultBannerUrl'], message: problem });
      }
    }
  });

export const categoryIdSchema = z.object({ categoryId: z.string().min(1) });

/** Filter der Kalender- und Verwaltungsansicht. */
export const calendarQuerySchema = z.object({
  view: z.enum(['month', 'week', 'agenda']).default('month'),
  /** Ankerdatum des angezeigten Zeitraums (ISO). */
  anchor: z.string().optional(),
  categoryId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  /** Nur Events, bei denen der Betrachter angemeldet ist. */
  mine: z.coerce.boolean().default(false),
  /** Nur Events mit Anmeldung. */
  withRegistration: z.coerce.boolean().default(false),
  /** Nur Events, bei denen noch Plätze frei sind. */
  withFreeSeats: z.coerce.boolean().default(false),
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
