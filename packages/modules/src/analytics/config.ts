import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck } from '../health/types';
import { ANALYTICS_PERMISSIONS, ANALYTICS_PERMISSION_DEFINITIONS } from './permissions';

export const ANALYTICS_MODULE_ID = 'analytics';

/**
 * Obergrenzen, die auch per Einstellung nicht ueberschritten werden koennen.
 *
 * Sie stehen hier und nicht im Zod-Standardwert, weil sie eine Zusage sind:
 * es gibt keine unbegrenzte Aufbewahrung und keinen unbegrenzten Speicher.
 * Wer die Zahlen aendern will, aendert Code - und sieht dabei diesen Absatz.
 */
export const ANALYTICS_MAX_RETENTION_DAYS = 365;
export const ANALYTICS_MAX_MEDIA_RETENTION_DAYS = 90;
export const ANALYTICS_MAX_MEDIA_QUOTA_MB = 20_480;
/** Groesste Datei, die archiviert wird. Grosse Anhaenge fuellen sonst alles. */
export const ANALYTICS_MAX_MEDIA_FILE_MB = 25;

export const analyticsSettingsSchema = z.object({
  // --- Was aufgezeichnet wird ---------------------------------------------
  /** Nachrichten: Bearbeitung, Loeschung, Sammel-Loeschung. */
  logMessages: z.boolean().default(true),
  /**
   * Auch den Nachrichtentext speichern.
   *
   * Getrennt von `logMessages`, weil «wer hat wann geloescht» und «was stand
   * darin» verschieden schwer wiegen. Ohne das Message-Content-Intent bleibt
   * die Einstellung wirkungslos - der Bot sagt das beim Start.
   */
  storeMessageContent: z.boolean().default(true),
  /** Sprachkanaele: Betreten, Verlassen, Verschieben. */
  logVoice: z.boolean().default(true),
  /** Mitglieder: Beitritt, Austritt, Rollen, Nickname. */
  logMembers: z.boolean().default(true),
  /** Verwaltung: Rollen und Kanaele angelegt, geaendert, geloescht. */
  logAdmin: z.boolean().default(true),

  /** Kanaele, die gar nicht aufgezeichnet werden (z.B. private Bereiche). */
  ignoredChannelIds: z
    .array(z.string().regex(/^\d{17,20}$/u))
    .max(100)
    .default([]),
  /** Nachrichten von Bots aufzeichnen. Standardmaessig nicht - sie rauschen. */
  logBots: z.boolean().default(false),

  // --- Aufbewahrung --------------------------------------------------------
  retentionDays: z.number().int().min(1).max(ANALYTICS_MAX_RETENTION_DAYS).default(90),
  mediaRetentionDays: z.number().int().min(1).max(ANALYTICS_MAX_MEDIA_RETENTION_DAYS).default(30),

  // --- Medienarchiv --------------------------------------------------------
  /** Bilder und Dateien geloeschter Nachrichten sichern. */
  archiveMedia: z.boolean().default(false),
  mediaQuotaMb: z.number().int().min(64).max(ANALYTICS_MAX_MEDIA_QUOTA_MB).default(2048),
  maxMediaFileMb: z.number().int().min(1).max(ANALYTICS_MAX_MEDIA_FILE_MB).default(8),
});

export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;

const analyticsSettingsFields: SettingsField[] = [
  {
    key: 'logMessages',
    type: 'boolean',
    label: 'Nachrichten aufzeichnen',
    description: 'Bearbeitete und gelöschte Nachrichten erscheinen in der Zeitleiste.',
    group: 'Aufzeichnung',
  },
  {
    key: 'storeMessageContent',
    type: 'boolean',
    label: 'Nachrichtentext speichern',
    description:
      'Ohne diese Option steht nur, dass eine Nachricht gelöscht wurde - nicht, was darin stand. Braucht das Message-Content-Intent im Discord Developer Portal.',
    group: 'Aufzeichnung',
  },
  {
    key: 'logVoice',
    type: 'boolean',
    label: 'Sprachkanäle aufzeichnen',
    description: 'Betreten, Verlassen und Verschieben.',
    group: 'Aufzeichnung',
  },
  {
    key: 'logMembers',
    type: 'boolean',
    label: 'Mitglieder aufzeichnen',
    description: 'Beitritt, Austritt, Rollenänderungen und Nicknamen.',
    group: 'Aufzeichnung',
  },
  {
    key: 'logAdmin',
    type: 'boolean',
    label: 'Serververwaltung aufzeichnen',
    description: 'Rollen und Kanäle angelegt, geändert oder gelöscht.',
    group: 'Aufzeichnung',
  },
  {
    key: 'logBots',
    type: 'boolean',
    label: 'Bots mit aufzeichnen',
    description: 'Standardmässig aus - Bot-Nachrichten füllen die Zeitleiste, ohne etwas zu erklären.',
    group: 'Aufzeichnung',
  },
  {
    key: 'ignoredChannelIds',
    type: 'discord-channel-list',
    label: 'Ausgenommene Kanäle',
    description: 'Aus diesen Kanälen wird nichts aufgezeichnet.',
    group: 'Aufzeichnung',
  },
  {
    key: 'retentionDays',
    type: 'number',
    label: 'Aufbewahrung der Ereignisse',
    description: `Ältere Einträge werden automatisch gelöscht. Höchstens ${ANALYTICS_MAX_RETENTION_DAYS} Tage.`,
    min: 1,
    max: ANALYTICS_MAX_RETENTION_DAYS,
    unit: 'Tage',
    group: 'Aufbewahrung',
  },
  {
    key: 'mediaRetentionDays',
    type: 'number',
    label: 'Aufbewahrung der Dateien',
    description: `Archivierte Dateien werden früher gelöscht als die Einträge selbst. Höchstens ${ANALYTICS_MAX_MEDIA_RETENTION_DAYS} Tage.`,
    min: 1,
    max: ANALYTICS_MAX_MEDIA_RETENTION_DAYS,
    unit: 'Tage',
    group: 'Aufbewahrung',
  },
  {
    key: 'archiveMedia',
    type: 'boolean',
    label: 'Dateien archivieren',
    description:
      'Bilder und Anhänge gelöschter Nachrichten werden gesichert. Sie liegen geschützt und sind nur mit eigener Berechtigung abrufbar.',
    group: 'Medienarchiv',
  },
  {
    key: 'mediaQuotaMb',
    type: 'number',
    label: 'Speichergrenze',
    description: 'Ist sie erreicht, wird nichts Neues archiviert - alte Dateien werden nicht überschrieben.',
    min: 64,
    max: ANALYTICS_MAX_MEDIA_QUOTA_MB,
    unit: 'MB',
    group: 'Medienarchiv',
  },
  {
    key: 'maxMediaFileMb',
    type: 'number',
    label: 'Grösste Datei',
    description: 'Grössere Anhänge werden vermerkt, aber nicht gespeichert.',
    min: 1,
    max: ANALYTICS_MAX_MEDIA_FILE_MB,
    unit: 'MB',
    group: 'Medienarchiv',
  },
];

/**
 * Gesundheitsprüfungen des Ereignisprotokolls.
 *
 * Der wichtigste Punkt darin ist der erste: **ohne das Message-Content-Intent
 * gibt es keine Nachrichtentexte.** Das Modul liefe trotzdem und schriebe
 * seine Zeilen - nur stünde in jeder «Nachricht gelöscht» ohne zu sagen,
 * welche. Ein Verlauf, der vollständig aussieht und es nicht ist, ist
 * schlimmer als einer, der seine Lücke benennt. Deshalb steht sie hier.
 *
 * Der zweite Punkt betrifft das Audit Log: ohne `VIEW_AUDIT_LOG` bleibt bei
 * fast jedem Ereignis der Verursacher unbekannt. Auch das ist kein Defekt,
 * sondern eine Einschränkung, die man kennen muss.
 */
async function analyticsHealthChecks(): Promise<ModuleHealthCheck[]> {
  const [{ getModuleSettings }, { discord }] = await Promise.all([
    import('../module-state'),
    import('@swisshub/discord'),
  ]);
  const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const settingsHref = `/modules/${ANALYTICS_MODULE_ID}`;

  if (settings.logMessages && settings.storeMessageContent) {
    const erlaubt = await discord.bot.messageContentAllowed().catch(() => null);
    if (erlaubt === false) {
      checks.push({
        label: 'Nachrichteninhalte',
        status: 'warning',
        detail:
          'Das Message-Content-Intent ist im Discord Developer Portal nicht freigeschaltet. Im Verlauf steht, DASS eine Nachricht gelöscht wurde - nicht, was darin stand.',
        fixHref: settingsHref,
      });
    } else if (erlaubt === null) {
      checks.push({
        label: 'Nachrichteninhalte',
        status: 'warning',
        detail:
          'Discord ist nicht erreichbar - ob Nachrichteninhalte ankommen, lässt sich gerade nicht sagen.',
      });
    } else {
      checks.push({ label: 'Nachrichteninhalte', status: 'ok', detail: 'Intent freigeschaltet.' });
    }
  } else {
    checks.push({
      label: 'Nachrichteninhalte',
      status: 'ok',
      detail: 'Texte werden bewusst nicht gespeichert.',
    });
  }

  const auditLesbar = await discord.guild
    .auditLog({ limit: 1 })
    .then(() => true)
    .catch(() => false);
  checks.push(
    auditLesbar
      ? { label: 'Audit Log', status: 'ok', detail: 'Verursacher können zugeordnet werden.' }
      : {
          label: 'Audit Log',
          status: 'warning',
          detail:
            'Der Bot kann Discords Audit Log nicht lesen (Berechtigung «Audit-Log ansehen»). Bei Löschungen und Rollenänderungen bleibt der Verursacher unbekannt.',
          fixHref: '/server/permissions',
        },
  );

  if (settings.archiveMedia) {
    const { medienBelegung } = await import('./queries');
    const { tryResolveGuildId } = await import('@swisshub/discord');
    const guildId = await tryResolveGuildId();
    const belegt = guildId ? await medienBelegung(guildId).catch(() => 0) : 0;
    const grenze = settings.mediaQuotaMb * 1024 * 1024;
    const anteil = grenze > 0 ? belegt / grenze : 0;
    const mb = (wert: number): string => `${Math.round(wert / 1024 / 1024)} MB`;
    checks.push({
      label: 'Medienarchiv',
      status: anteil >= 0.9 ? 'warning' : 'ok',
      detail:
        anteil >= 0.9
          ? `${mb(belegt)} von ${settings.mediaQuotaMb} MB belegt. Ist die Grenze erreicht, wird nichts Neues mehr archiviert - alte Dateien werden dafür nicht gelöscht.`
          : `${mb(belegt)} von ${settings.mediaQuotaMb} MB belegt.`,
      fixHref: settingsHref,
    });
  }

  checks.push({
    label: 'Aufbewahrung',
    status: 'ok',
    detail: `Ereignisse ${settings.retentionDays} Tage, Dateien ${settings.mediaRetentionDays} Tage. Älteres wird automatisch gelöscht.`,
    fixHref: settingsHref,
  });

  return checks;
}

export const analyticsModule: ModuleDefinition = registerModule({
  id: ANALYTICS_MODULE_ID,
  name: 'Analytics',
  description:
    'Verlauf der Server-Ereignisse: Nachrichten, Sprachkanäle, Mitglieder und Verwaltung an einem Ort.',
  icon: 'Activity',
  tagline: 'Was auf dem Server geschieht',
  permissionPrefix: 'analytics',
  // Bewusst aus: ein Protokoll ueber alles, was Menschen schreiben, entsteht
  // erst, wenn jemand es ausdruecklich einschaltet.
  defaultEnabled: false,
  settingsSchema: analyticsSettingsSchema,
  settingsFields: analyticsSettingsFields,
  configVersion: 1,
  healthChecks: analyticsHealthChecks,
  permissions: ANALYTICS_PERMISSION_DEFINITIONS,
  navigation: [
    {
      href: '/analytics',
      label: 'Analytics',
      description: 'Verlauf der Server-Ereignisse',
      permission: ANALYTICS_PERMISSIONS.view,
      icon: 'Activity',
      group: 'moderation',
      order: 50,
    },
  ],
});
