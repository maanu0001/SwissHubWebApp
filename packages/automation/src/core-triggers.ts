import { z } from 'zod';
import { istBekannteZeitzone, ortszeitAlsUtc, teileIn } from '@swisshub/shared';
import { getEventDefinition, listEventDefinitions } from './contract';
import { registerTrigger, type AutomationField, type ValidationIssue } from './registry';

/**
 * Die drei Trigger, die kein Modul brauchen.
 *
 * - `event`    reagiert auf etwas, das geschehen ist
 * - `schedule` läuft zu einer Zeit
 * - `manual`   läuft, wenn jemand darauf drückt
 *
 * Alles Modulspezifische - «drei Tage vor einem Turnier» etwa - trägt das
 * jeweilige Modul selbst ein. Diese Datei kennt kein Modul und soll keines
 * kennenlernen.
 */

export const STANDARD_ZEITZONE = 'Europe/Zurich';

// --- Ereignis ---------------------------------------------------------------

export const eventTriggerConfigSchema = z.object({
  eventType: z.string().min(3).max(80),
});

const eventFelder: AutomationField[] = [
  {
    key: 'eventType',
    label: 'Ereignis',
    description: 'Worauf diese Automation reagiert.',
    type: 'select',
    required: true,
    options: [],
  },
];

registerTrigger({
  id: 'event',
  label: 'Wenn etwas geschieht',
  description: 'Startet, sobald ein bestimmtes Ereignis im Server eintritt.',
  icon: 'zap',
  configSchema: eventTriggerConfigSchema,
  get fields(): AutomationField[] {
    // Die Auswahl entsteht aus den angemeldeten Ereignissen. Eine feste Liste
    // müsste bei jedem neuen Modul angefasst werden - genau das soll sie nicht.
    return [
      {
        ...eventFelder[0]!,
        options: listEventDefinitions().map((definition) => ({
          value: definition.type,
          label: definition.label,
        })),
      },
    ];
  },
  matches(config, context) {
    const geprueft = eventTriggerConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return false;
    }
    return context.event.type === geprueft.data.eventType;
  },
  async validate(config): Promise<ValidationIssue[]> {
    const geprueft = eventTriggerConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return [{ severity: 'error', message: 'Es ist kein Ereignis gewählt.', path: 'trigger' }];
    }
    if (!getEventDefinition(geprueft.data.eventType)) {
      return [
        {
          severity: 'error',
          message: `Das Ereignis «${geprueft.data.eventType}» gibt es nicht (mehr).`,
          path: 'trigger',
        },
      ];
    }
    return [];
  },
});

// --- Zeitplan ---------------------------------------------------------------

export const ZEITPLAN_MODI = ['INTERVALL', 'TAEGLICH', 'WOECHENTLICH', 'MONATLICH'] as const;

export const scheduleTriggerConfigSchema = z
  .object({
    modus: z.enum(ZEITPLAN_MODI),
    /** Nur bei `INTERVALL`. Fünf Minuten ist die kleinste sinnvolle Einheit. */
    intervallMinuten: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 30)
      .optional(),
    /** `HH:MM` in der gewählten Zeitzone. */
    zeit: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/u, 'muss die Form HH:MM haben')
      .optional(),
    /** 0 = Sonntag … 6 = Samstag. Nur bei `WOECHENTLICH`. */
    wochentage: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    /** 1 … 28. Nur bei `MONATLICH` - der 29. fehlt im Februar. */
    monatstag: z.number().int().min(1).max(28).optional(),
    zeitzone: z.string().min(1).max(64).default(STANDARD_ZEITZONE),
  })
  .superRefine((wert, ctx) => {
    if (wert.modus === 'INTERVALL' && !wert.intervallMinuten) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ein Intervall fehlt.',
        path: ['intervallMinuten'],
      });
    }
    if (wert.modus !== 'INTERVALL' && !wert.zeit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Eine Uhrzeit fehlt.', path: ['zeit'] });
    }
    if (wert.modus === 'WOECHENTLICH' && (wert.wochentage ?? []).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Es ist kein Wochentag gewählt.',
        path: ['wochentage'],
      });
    }
    if (wert.modus === 'MONATLICH' && !wert.monatstag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ein Monatstag fehlt.', path: ['monatstag'] });
    }
  });

export type ScheduleTriggerConfig = z.infer<typeof scheduleTriggerConfigSchema>;

/**
 * Der nächste Termin nach `von`.
 *
 * Gerechnet wird über die Zeitzonenhelfer des Projekts, nicht mit einer
 * festen Stundenverschiebung: «jeden Tag um 20:00» heisst in Zürich im Winter
 * 19:00 UTC und im Sommer 18:00 UTC. Wer das mit einer Zahl löst, liegt
 * zweimal im Jahr daneben - und zwar an den beiden Tagen, an denen es
 * auffällt.
 *
 * Der Rückgabewert liegt **immer echt nach** `von`. Andernfalls plante der
 * Zeitplaner denselben Termin unmittelbar wieder ein und die Automation liefe
 * in einer Schleife.
 */
export function naechsterTermin(config: ScheduleTriggerConfig, von: Date): Date | null {
  const zone = istBekannteZeitzone(config.zeitzone) ? config.zeitzone : STANDARD_ZEITZONE;

  if (config.modus === 'INTERVALL') {
    const minuten = config.intervallMinuten ?? 60;
    return new Date(von.getTime() + minuten * 60_000);
  }

  const [stundeRoh, minuteRoh] = (config.zeit ?? '00:00').split(':');
  const stunde = Number(stundeRoh);
  const minute = Number(minuteRoh);

  if (config.modus === 'TAEGLICH') {
    return naechsterPassender(
      von,
      zone,
      60,
      (teile) => {
        void teile;
        return true;
      },
      stunde,
      minute,
    );
  }

  if (config.modus === 'WOECHENTLICH') {
    const tage = new Set(config.wochentage ?? []);
    return naechsterPassender(von, zone, 60, (teile) => tage.has(teile.wochentag), stunde, minute);
  }

  const monatstag = config.monatstag ?? 1;
  return naechsterPassender(von, zone, 400, (teile) => teile.tag === monatstag, stunde, minute);
}

/**
 * Tag für Tag vorwärts, bis einer passt.
 *
 * Kein Rechnen mit Kalenderregeln, sondern Ausprobieren - über höchstens
 * `maxTage` Tage. Das ist genügsam genug (ein Durchgang ist eine
 * Datumsformatierung) und kommt ohne Sonderfälle für Monatsenden,
 * Schaltjahre und Zeitumstellungen aus.
 */
function naechsterPassender(
  von: Date,
  zone: string,
  maxTage: number,
  passt: (teile: { tag: number; wochentag: number }) => boolean,
  stunde: number,
  minute: number,
): Date | null {
  for (let versatz = 0; versatz <= maxTage; versatz += 1) {
    const tagesMitte = new Date(von.getTime() + versatz * 24 * 3600_000);
    const teile = teileIn(tagesMitte, zone);
    if (!passt(teile)) {
      continue;
    }
    const kandidat = ortszeitAlsUtc(zone, teile.jahr, teile.monat, teile.tag, stunde, minute);
    if (kandidat.getTime() > von.getTime()) {
      return kandidat;
    }
  }
  return null;
}

registerTrigger({
  id: 'schedule',
  label: 'Zu einer Zeit',
  description: 'Startet nach einem Zeitplan - stündlich, täglich, wöchentlich oder monatlich.',
  icon: 'clock',
  configSchema: scheduleTriggerConfigSchema,
  fields: [
    {
      key: 'modus',
      label: 'Wiederholung',
      type: 'select',
      required: true,
      options: [
        { value: 'INTERVALL', label: 'Alle X Minuten' },
        { value: 'TAEGLICH', label: 'Täglich' },
        { value: 'WOECHENTLICH', label: 'Wöchentlich' },
        { value: 'MONATLICH', label: 'Monatlich' },
      ],
      default: 'TAEGLICH',
    },
    {
      key: 'intervallMinuten',
      label: 'Abstand',
      description: 'Nur bei «Alle X Minuten». Mindestens fünf Minuten.',
      type: 'number',
      min: 5,
      max: 60 * 24 * 30,
      unit: 'Minuten',
    },
    { key: 'zeit', label: 'Uhrzeit', type: 'time', placeholder: '20:00' },
    { key: 'wochentage', label: 'Wochentage', type: 'weekdays' },
    {
      key: 'monatstag',
      label: 'Tag im Monat',
      description: 'Höchstens der 28. - jeder Monat hat ihn.',
      type: 'number',
      min: 1,
      max: 28,
    },
    {
      key: 'zeitzone',
      label: 'Zeitzone',
      type: 'text',
      default: STANDARD_ZEITZONE,
      placeholder: STANDARD_ZEITZONE,
    },
  ],
  nextRunAt(config, von) {
    const geprueft = scheduleTriggerConfigSchema.safeParse(config);
    return geprueft.success ? naechsterTermin(geprueft.data, von) : null;
  },
  async validate(config): Promise<ValidationIssue[]> {
    const geprueft = scheduleTriggerConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return geprueft.error.issues.map((problem) => ({
        severity: 'error' as const,
        message: problem.message,
        path: 'trigger',
      }));
    }
    const probleme: ValidationIssue[] = [];
    if (!istBekannteZeitzone(geprueft.data.zeitzone)) {
      probleme.push({
        severity: 'error',
        message: `Die Zeitzone «${geprueft.data.zeitzone}» ist unbekannt.`,
        path: 'trigger',
      });
    }
    if (!naechsterTermin(geprueft.data, new Date())) {
      probleme.push({
        severity: 'error',
        message: 'Aus diesem Zeitplan ergibt sich kein Termin.',
        path: 'trigger',
      });
    }
    return probleme;
  },
});

// --- Von Hand ---------------------------------------------------------------

export const manualTriggerConfigSchema = z.object({});

registerTrigger({
  id: 'manual',
  label: 'Von Hand',
  description: 'Läuft nur, wenn jemand sie im Dashboard startet.',
  icon: 'play',
  configSchema: manualTriggerConfigSchema,
  fields: [],
  // Weder `matches` noch `nextRunAt`: dieser Trigger wird von niemandem
  // ausgelöst ausser von einem Menschen mit der nötigen Berechtigung.
});
