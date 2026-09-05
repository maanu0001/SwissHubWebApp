import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const AUTOMATION_MODULE_ID = 'automation';

/**
 * Berechtigungen der Automation Engine.
 *
 * Fein geschnitten, und das aus einem Grund: eine Automation ist ein
 * Werkzeug, das im Namen des Servers handelt. Wer sie **anlegen** darf, hat
 * damit noch nicht das Recht, sie **einzuschalten** - erst das Einschalten
 * macht aus einem Entwurf etwas, das nachts von selbst Rollen vergibt.
 *
 * Ebenso getrennt: `execute` (von Hand starten) und `webhooks.manage` (nach
 * aussen senden). Ein Webhook trägt Serverdaten an eine fremde Adresse; das
 * ist eine andere Frage als «darf jemand eine Willkommensnachricht bauen».
 *
 * Backend-Durchsetzung ist Pflicht - die Oberfläche versteckt nur, was
 * ohnehin abgewiesen würde (§21).
 */
export const AUTOMATION_PERMISSIONS = {
  view: 'automations.view',
  create: 'automations.create',
  edit: 'automations.edit',
  delete: 'automations.delete',
  /** Ein- und Ausschalten. Getrennt vom Bearbeiten - siehe oben. */
  enable: 'automations.enable',
  /** Von Hand starten und Probelauf. */
  execute: 'automations.execute',
  historyView: 'automations.history.view',
  /** Angehaltene Aktionen freigeben (§32). */
  approve: 'automations.approve',
  templatesManage: 'automations.templates.manage',
  /** Systemautomationen sehen und schalten. */
  systemManage: 'automations.system.manage',
  webhooksManage: 'automations.webhooks.manage',
} as const;

export type AutomationPermission = (typeof AUTOMATION_PERMISSIONS)[keyof typeof AUTOMATION_PERMISSIONS];

export const automationSettingsSchema = z.object({
  /**
   * Wohin gemeldet wird, wenn eine Automation endgültig scheitert (§26).
   *
   * Ohne Kanal bleibt der Fehler-Posteingang im Dashboard die einzige
   * Anlaufstelle - und der wird nur gesehen, wenn jemand hinsieht.
   */
  meldeKanalId: z.string().nullable().default(null),
  /** Rolle, die bei einem Fehler erwähnt wird. Leer = keine Erwähnung. */
  meldeRolleId: z.string().nullable().default(null),
  /** Auch dann melden, wenn ein einzelner Schritt scheitert, der Lauf aber weiterläuft. */
  meldeAuchSchrittfehler: z.boolean().default(false),
  /**
   * Wohin eine angehaltene Aktion zur Freigabe gemeldet wird (§32).
   *
   * Ohne diesen Kanal wartet eine Freigabe still im Dashboard - und wer nicht
   * hinsieht, lässt einen Lauf tagelang stehen.
   */
  freigabeKanalId: z.string().nullable().default(null),
  /** Wie lange Läufe im Verlauf bleiben (§34). */
  verlaufTage: z.number().int().min(7).max(365).default(30),
  /** Wie lange verarbeitete Ereignisse bleiben. */
  ereignisseTage: z.number().int().min(1).max(90).default(7),
  /**
   * Obergrenze eingeschalteter Automationen je Server.
   *
   * Kein Geschäftsmodell, sondern eine Schutzmauer: tausend eingeschaltete
   * Automationen wären bei jedem Ereignis tausend Prüfungen.
   */
  maxAktive: z.number().int().min(1).max(500).default(100),
});

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

const automationSettingsFields: SettingsField[] = [
  {
    key: 'meldeKanalId',
    label: 'Meldekanal',
    description: 'Wohin gemeldet wird, wenn eine Automation endgültig scheitert.',
    type: 'discord-channel',
    group: 'Meldungen',
  },
  {
    key: 'meldeRolleId',
    label: 'Rolle bei Fehlern erwähnen',
    description: 'Leer lassen, wenn niemand erwähnt werden soll.',
    type: 'discord-role',
    group: 'Meldungen',
  },
  {
    key: 'meldeAuchSchrittfehler',
    label: 'Auch einzelne Schrittfehler melden',
    description:
      'Aus als Vorgabe. Ein Schritt mit «Bei Fehler: weiter» soll nicht bei jedem Durchgang melden.',
    type: 'boolean',
    group: 'Meldungen',
  },
  {
    key: 'freigabeKanalId',
    label: 'Freigabekanal',
    description: 'Wohin gemeldet wird, wenn ein Lauf auf eine menschliche Freigabe wartet.',
    type: 'discord-channel',
    group: 'Meldungen',
  },
  {
    key: 'verlaufTage',
    label: 'Verlauf aufbewahren',
    description: 'Abgeschlossene Läufe werden danach entfernt. Fehler bleiben länger sichtbar.',
    type: 'number',
    min: 7,
    max: 365,
    unit: 'Tage',
    group: 'Aufbewahrung',
  },
  {
    key: 'ereignisseTage',
    label: 'Ereignisse aufbewahren',
    description: 'Nur verarbeitete. Was noch offen ist, bleibt liegen.',
    type: 'number',
    min: 1,
    max: 90,
    unit: 'Tage',
    group: 'Aufbewahrung',
  },
  {
    key: 'maxAktive',
    label: 'Höchstzahl aktiver Automationen',
    type: 'number',
    min: 1,
    max: 500,
    group: 'Grenzen',
  },
];

async function automationHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const { schedulerGesundheit } = await import('@swisshub/automation');
  const settings = await getModuleSettings<AutomationSettings>(AUTOMATION_MODULE_ID);
  const fix = `/modules/${AUTOMATION_MODULE_ID}`;

  if (settings.meldeKanalId) {
    const kanal = context.channels.find((eintrag) => eintrag.id === settings.meldeKanalId);
    checks.push(
      kanal
        ? { label: 'Meldekanal', status: 'ok', detail: `#${kanal.name}` }
        : {
            label: 'Meldekanal',
            status: 'error',
            detail: 'Diesen Kanal gibt es auf Discord nicht mehr.',
            fixHref: fix,
          },
    );
  } else {
    checks.push({
      label: 'Meldekanal',
      status: 'warning',
      detail: 'Nicht gesetzt - gescheiterte Läufe fallen nur im Dashboard auf.',
      fixHref: fix,
    });
  }

  // Die aussagekräftigste Zahl: läuft der Takt überhaupt noch? Steht die
  // Verzögerung bei Stunden, wartet jeder geplante Lauf - und das sieht man
  // an keiner anderen Zahl (§39).
  try {
    const zustand = await schedulerGesundheit();
    const verzug = zustand.aeltesteVerzoegerungSekunden ?? 0;
    checks.push({
      label: 'Zeitplaner',
      status: verzug > 600 ? 'error' : verzug > 120 ? 'warning' : 'ok',
      detail:
        zustand.aeltesteVerzoegerungSekunden === null
          ? 'Keine fälligen Aufgaben.'
          : `Älteste fällige Aufgabe seit ${verzug} Sekunden offen.`,
    });
    if (zustand.tot > 0) {
      checks.push({
        label: 'Gescheiterte Aufgaben',
        status: 'warning',
        detail: `${zustand.tot} Aufgaben endgültig gescheitert.`,
        fixHref: '/automationen/fehler',
      });
    }
  } catch {
    checks.push({
      label: 'Zeitplaner',
      status: 'warning',
      detail: 'Der Zustand liess sich gerade nicht abfragen.',
    });
  }

  return checks;
}

export const automationModule: ModuleDefinition = registerModule({
  id: AUTOMATION_MODULE_ID,
  name: 'Automationen',
  description:
    'Wenn etwas geschieht, geschieht etwas anderes: Nachrichten, Rollen und Meldungen ohne Handgriff - mit Probelauf, Verlauf und Freigabe für alles, was nicht zurückzunehmen ist.',
  icon: 'Workflow',
  permissionPrefix: 'automations',
  defaultEnabled: false,
  settingsSchema: automationSettingsSchema,
  settingsFields: automationSettingsFields,
  healthChecks: automationHealthChecks,
  permissions: [
    {
      key: AUTOMATION_PERMISSIONS.view,
      label: 'Automationen ansehen',
      description: 'Übersicht, Vorlagen und Zustand sehen.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.create,
      label: 'Automationen anlegen',
      description: 'Neue Automationen als Entwurf anlegen. Einschalten ist eine eigene Berechtigung.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.edit,
      label: 'Automationen bearbeiten',
      description: 'Auslöser, Bedingungen und Schritte ändern.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.delete,
      label: 'Automationen löschen',
      description: 'Automationen archivieren. Verlauf und Prüfspur bleiben lesbar.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.enable,
      label: 'Automationen einschalten',
      description:
        'Aus einem Entwurf etwas machen, das von selbst handelt - deshalb getrennt vom Bearbeiten.',
      module: AUTOMATION_MODULE_ID,
      critical: true,
    },
    {
      key: AUTOMATION_PERMISSIONS.execute,
      label: 'Von Hand starten',
      description: 'Eine Automation auslösen oder einen Probelauf machen.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.historyView,
      label: 'Verlauf einsehen',
      description: 'Läufe mit jedem Schritt und seinem Ergebnis.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.approve,
      label: 'Angehaltene Aktionen freigeben',
      description: 'Über Aktionen entscheiden, die auf einen Menschen warten.',
      module: AUTOMATION_MODULE_ID,
      critical: true,
    },
    {
      key: AUTOMATION_PERMISSIONS.templatesManage,
      label: 'Vorlagen verwalten',
      description: 'Vorlagen übernehmen und pflegen.',
      module: AUTOMATION_MODULE_ID,
    },
    {
      key: AUTOMATION_PERMISSIONS.systemManage,
      label: 'Systemautomationen verwalten',
      description: 'Von SwissHub mitgelieferte Automationen einsehen und schalten.',
      module: AUTOMATION_MODULE_ID,
      critical: true,
    },
    {
      key: AUTOMATION_PERMISSIONS.webhooksManage,
      label: 'Webhooks verwenden',
      description: 'Automationen bauen, die nach aussen senden. Trägt Serverdaten an eine fremde Adresse.',
      module: AUTOMATION_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/automationen',
      label: 'Automationen',
      description: 'Wenn etwas geschieht, geschieht etwas anderes',
      permission: AUTOMATION_PERMISSIONS.view,
      icon: 'Workflow',
      group: 'system',
      order: 25,
      altPermissions: [AUTOMATION_PERMISSIONS.create, AUTOMATION_PERMISSIONS.historyView],
    },
  ],
});
