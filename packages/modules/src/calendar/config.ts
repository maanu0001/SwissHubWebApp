import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const CALENDAR_MODULE_ID = 'calendar';

/** SwissHub-Rot, wie im Kommunikations- und Turniermodul. */
export const CALENDAR_ACCENT_COLOR = 0x83060a;

/** Anzeigezone des Servers. Termine ohne eigene Angabe erben sie. */
export const DEFAULT_TIMEZONE = 'Europe/Zurich';

/**
 * Berechtigungen des Kalendermoduls.
 *
 * Bewusst fein geschnitten und ohne jeden Bezug auf Rollennamen: welche Rolle
 * «Moderator» heisst, entscheidet jeder Server selbst, und eine Pruefung auf
 * den Namen waere auf dem naechsten Server falsch. Was jemand darf, steht
 * unter Server → Berechtigungen.
 *
 * `manageOwn` ist der Grund fuer den Zuschnitt: wer einen Community-Abend
 * ausrichtet, soll seinen eigenen Termin pflegen koennen, ohne damit Zugriff
 * auf jeden fremden Termin zu bekommen.
 */
export const CALENDAR_PERMISSIONS = {
  view: 'calendar.view',
  /** Sich selbst an- und abmelden. */
  participate: 'calendar.participate',

  create: 'calendar.create',
  /** Fremde Termine bearbeiten. */
  edit: 'calendar.edit',
  /** Nur eigene Termine bzw. solche, bei denen man Organisator ist. */
  manageOwn: 'calendar.manageOwn',
  publish: 'calendar.publish',
  cancel: 'calendar.cancel',
  delete: 'calendar.delete',

  /** Teilnehmerliste sehen, auch wenn sie nicht oeffentlich ist. */
  registrationsView: 'calendar.registrations.view',
  manageRegistrations: 'calendar.manageRegistrations',
  manageReminders: 'calendar.manageReminders',

  categoriesManage: 'calendar.categories.manage',
  statsView: 'calendar.stats.view',
} as const;

export type CalendarPermission = (typeof CALENDAR_PERMISSIONS)[keyof typeof CALENDAR_PERMISSIONS];

export const calendarSettingsSchema = z.object({
  /** Wohin Ankuendigungen gehen, wenn ein Termin nichts eigenes setzt. */
  defaultAnnouncementChannelId: z.string().nullable().default(null),
  /**
   * Rollen, die ueberhaupt erwaehnt werden duerfen.
   *
   * Ein freies Textfeld am Termin waere ein Ping-Knopf fuer den ganzen
   * Server. Erwaehnt wird nur, was hier steht - dieselbe Regel wie im
   * Turniermodul.
   */
  mentionableRoleIds: z.array(z.string()).default([]),
  /** Vorgabe-Vorlaufzeiten neuer Termine, in Minuten. */
  defaultReminderMinutes: z.array(z.number().int().positive()).default([1440, 60]),
  /**
   * Dauer, die ein Termin ohne Endzeit im Kalender und im ICS-Export
   * einnimmt. Erfunden wird dabei nichts: die Detailseite zeigt weiterhin
   * «offenes Ende».
   */
  defaultDurationMinutes: z.number().int().min(15).max(1440).default(120),
  /** Wie lange nach dem Ende ein Termin als «laufend» gilt, ehe er endet. */
  autoCompleteGraceMinutes: z.number().int().min(0).max(1440).default(0),
  /** Erinnerungen ueberhaupt verschicken. */
  remindersEnabled: z.boolean().default(true),
});

export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

const calendarSettingsFields: SettingsField[] = [
  {
    key: 'defaultAnnouncementChannelId',
    label: 'Ankündigungs-Channel',
    description: 'Wohin Event-Ankündigungen gehen, wenn beim Event nichts anderes gewählt wurde.',
    type: 'discord-channel',
    channelKinds: ['text'],
    group: 'Discord',
  },
  {
    key: 'mentionableRoleIds',
    label: 'Erwähnbare Rollen',
    description:
      'Nur diese Rollen lassen sich bei Ankündigungen und Erinnerungen pingen. Ohne Eintrag pingt der Kalender niemanden.',
    type: 'discord-role-list',
    group: 'Discord',
  },
  {
    key: 'remindersEnabled',
    label: 'Erinnerungen verschicken',
    description: 'Aus: geplante Erinnerungen bleiben stehen, werden aber nicht gesendet.',
    type: 'boolean',
    group: 'Erinnerungen',
  },
  {
    key: 'defaultDurationMinutes',
    label: 'Vorgabedauer ohne Endzeit',
    description:
      'Wie lang ein Event ohne Endzeit im Kalender und im ICS-Export erscheint. Die Detailseite zeigt weiterhin «offenes Ende».',
    type: 'number',
    min: 15,
    max: 1440,
    step: 15,
    unit: 'Minuten',
    group: 'Darstellung',
  },
  {
    key: 'autoCompleteGraceMinutes',
    label: 'Nachlauf vor «Beendet»',
    description: 'Wie lange ein Event nach seinem Ende noch als laufend gilt.',
    type: 'number',
    min: 0,
    max: 1440,
    step: 15,
    unit: 'Minuten',
    group: 'Darstellung',
  },
];

/**
 * Was am Kalender schiefstehen kann, ohne dass es jemandem auffaellt.
 *
 * Beide Faelle sind still: Ankuendigungen laufen ins Leere und Erinnerungen
 * bleiben liegen, waehrend auf der Webseite alles richtig aussieht.
 */
async function calendarHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const { prisma } = await import('@swisshub/database');
  const settings = await getModuleSettings<CalendarSettings>(CALENDAR_MODULE_ID);

  // --- Ankuendigungskanal ------------------------------------------------
  if (!settings.defaultAnnouncementChannelId) {
    checks.push({
      label: 'Ankündigungs-Channel',
      status: 'warning',
      detail: 'Nicht gesetzt - Events brauchen dann je einen eigenen.',
      fixHref: `/modules/${CALENDAR_MODULE_ID}`,
    });
  } else {
    const name = context.channels.find(
      (eintrag) => eintrag.id === settings.defaultAnnouncementChannelId,
    )?.name;
    checks.push(
      name
        ? { label: 'Ankündigungs-Channel', status: 'ok', detail: `#${name}` }
        : {
            label: 'Ankündigungs-Channel',
            status: 'error',
            detail: 'Der gewählte Channel existiert auf Discord nicht mehr.',
            fixHref: `/modules/${CALENDAR_MODULE_ID}`,
          },
    );
  }

  // --- Erwaehnbare Rollen ------------------------------------------------
  const verschwundene = settings.mentionableRoleIds.filter(
    (id) => !context.roles.some((rolle) => rolle.id === id),
  );
  if (settings.mentionableRoleIds.length === 0) {
    checks.push({
      label: 'Erwähnbare Rollen',
      status: 'ok',
      detail: 'Keine freigegeben - Ankündigungen pingen niemanden.',
    });
  } else if (verschwundene.length > 0) {
    checks.push({
      label: 'Erwähnbare Rollen',
      status: 'warning',
      detail: `${verschwundene.length} freigegebene Rolle(n) gibt es auf Discord nicht mehr.`,
      fixHref: `/modules/${CALENDAR_MODULE_ID}`,
    });
  } else {
    checks.push({
      label: 'Erwähnbare Rollen',
      status: 'ok',
      detail: `${settings.mentionableRoleIds.length} freigegeben.`,
    });
  }

  // --- Liegengebliebene Erinnerungen -------------------------------------
  //
  // Faellig, aber nicht gesendet, und das seit ueber einer Stunde: dann
  // laeuft der Arbeitslauf nicht mehr. Ohne diese Pruefung faellt es erst
  // auf, wenn jemand fragt, warum keine Erinnerung kam.
  const grenze = new Date(Date.now() - 60 * 60 * 1000);
  const liegengeblieben = await prisma.calendarReminder
    .count({ where: { sentAt: null, dueAt: { lt: grenze } } })
    .catch(() => null);
  if (liegengeblieben === null) {
    checks.push({ label: 'Erinnerungen', status: 'warning', detail: 'Nicht prüfbar.' });
  } else if (liegengeblieben > 0) {
    checks.push({
      label: 'Erinnerungen',
      status: 'error',
      detail: `${liegengeblieben} Erinnerung(en) sind seit über einer Stunde überfällig.`,
    });
  } else {
    checks.push({ label: 'Erinnerungen', status: 'ok', detail: 'Keine überfälligen.' });
  }

  // --- Ankuendigungen, die niemand mehr findet ---------------------------
  const verwaist = await prisma.calendarEvent
    .count({ where: { discordMessageMissing: true, status: { in: ['SCHEDULED', 'ONGOING'] } } })
    .catch(() => null);
  if (verwaist !== null && verwaist > 0) {
    checks.push({
      label: 'Discord-Ankündigungen',
      status: 'warning',
      detail: `${verwaist} Ankündigung(en) wurden auf Discord gelöscht und lassen sich neu senden.`,
      fixHref: '/kalender/verwaltung',
    });
  }

  return checks;
}

export const calendarModule: ModuleDefinition = registerModule({
  id: CALENDAR_MODULE_ID,
  name: 'Community-Kalender',
  description:
    'Zentraler Terminkalender: Community-Abende, Turniere, Streams und Treffen - mit Anmeldung, Discord-Ankündigung und Erinnerungen.',
  icon: 'CalendarDays',
  permissionPrefix: 'calendar',
  defaultEnabled: false,
  settingsSchema: calendarSettingsSchema,
  settingsFields: calendarSettingsFields,
  healthChecks: calendarHealthChecks,
  permissions: [
    {
      key: CALENDAR_PERMISSIONS.view,
      label: 'Kalender ansehen',
      description: 'Veröffentlichte Events und deren Detailseiten sehen.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.participate,
      label: 'An Events teilnehmen',
      description: 'Sich selbst an- und wieder abmelden.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.create,
      label: 'Events anlegen',
      description: 'Neue Events als Entwurf erstellen.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.manageOwn,
      label: 'Eigene Events verwalten',
      description:
        'Events bearbeiten, bei denen man Ersteller oder eingetragener Organisator ist - fremde nicht.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.edit,
      label: 'Alle Events bearbeiten',
      description: 'Jedes Event bearbeiten, unabhängig davon, wer es angelegt hat.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.publish,
      label: 'Events veröffentlichen',
      description: 'Einen Entwurf veröffentlichen und auf Discord ankündigen.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.cancel,
      label: 'Events absagen',
      description: 'Ein veröffentlichtes Event absagen. Das Event bleibt erhalten.',
      module: CALENDAR_MODULE_ID,
      critical: true,
    },
    {
      key: CALENDAR_PERMISSIONS.delete,
      label: 'Events löschen',
      description:
        'Ein Event endgültig entfernen. Für vergangene Events gedacht - absagen bleibt der Regelweg.',
      module: CALENDAR_MODULE_ID,
      critical: true,
    },
    {
      key: CALENDAR_PERMISSIONS.registrationsView,
      label: 'Teilnehmerlisten sehen',
      description: 'Teilnehmer auch dann sehen, wenn die Liste nicht öffentlich ist.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.manageRegistrations,
      label: 'Anmeldungen verwalten',
      description: 'Teilnehmer entfernen, nachrücken lassen und Antworten einsehen.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.manageReminders,
      label: 'Erinnerungen verwalten',
      description: 'Vorlaufzeiten, Zielkanal und Erwähnung der Erinnerungen festlegen.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.categoriesManage,
      label: 'Kategorien verwalten',
      description: 'Event-Kategorien anlegen, umbenennen, einfärben und stilllegen.',
      module: CALENDAR_MODULE_ID,
    },
    {
      key: CALENDAR_PERMISSIONS.statsView,
      label: 'Event-Statistiken',
      description: 'Kennzahlen zu Events, Anmeldungen und Kategorien einsehen.',
      module: CALENDAR_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/kalender',
      label: 'Community-Kalender',
      description: 'Termine, Anmeldungen und Ankündigungen der Community',
      permission: CALENDAR_PERMISSIONS.view,
      icon: 'CalendarDays',
      group: 'modules',
      order: 30,
      /**
       * Wer den Kalender nicht sehen darf, aber Events anlegen soll, landet
       * trotzdem an der richtigen Stelle. Rechte gewaehrt das nicht - die
       * Seite prueft weiterhin serverseitig.
       */
      altPermissions: [CALENDAR_PERMISSIONS.create, CALENDAR_PERMISSIONS.manageOwn],
    },
  ],
});
