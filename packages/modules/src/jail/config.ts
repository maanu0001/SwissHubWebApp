import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const JAIL_MODULE_ID = 'jail';

/** Permissions des Jail-Moduls. */
export const JAIL_PERMISSIONS = {
  view: 'jail.view',
  create: 'jail.create',
  edit: 'jail.edit',
  release: 'jail.release',
  settings: 'jail.settings',
} as const;

/** Obergrenze, die auch per Konfiguration nicht überschritten werden kann. */
export const JAIL_MAX_DURATION_SECONDS = 365 * 24 * 60 * 60;

export const jailSettingsSchema = z.object({
  /** Rolle, die während des Jails vergeben wird. */
  jailRoleId: optionalSnowflakeSchema,
  /** Channel, in dem das Mitglied über den Jail informiert wird. */
  jailChannelId: optionalSnowflakeSchema,
  /** Channel für das Moderationslog (überschreibt die Kerneinstellung). */
  moderationLogChannelId: optionalSnowflakeSchema,
  /** Maximale Jail-Dauer in Sekunden. */
  maxDurationSeconds: z
    .number()
    .int()
    .min(60)
    .max(JAIL_MAX_DURATION_SECONDS)
    .default(7 * 24 * 60 * 60),
  /** Zusätzliche Rollen, die während des Jails erhalten bleiben. */
  keepRoleIds: z
    .array(z.string().regex(/^\d{17,20}$/u))
    .max(50)
    .default([]),
  /** Embed im Moderationslog posten. */
  postModerationLog: z.boolean().default(true),
  /** Hinweis im Jail-Channel posten. */
  notifyInJailChannel: z.boolean().default(true),
});

export type JailSettings = z.infer<typeof jailSettingsSchema>;

/**
 * Beschreibung der Einstellungen für die generische Oberfläche.
 *
 * Aus dieser Liste entsteht die Einstellungsseite des Moduls - inklusive
 * Rollen- und Channel-Auswahl. Es gibt deshalb keine ID-Eingabefelder mehr und
 * keine Rollen-IDs in Umgebungsvariablen.
 */
export const jailSettingsFields: SettingsField[] = [
  {
    key: 'jailRoleId',
    type: 'discord-role',
    label: 'Jail-Rolle',
    description:
      'Diese Rolle erhält ein Mitglied während des Jails. Sie muss unterhalb der Bot-Rolle liegen.',
    group: 'Discord',
    required: true,
    mustBeManageable: true,
  },
  {
    key: 'keepRoleIds',
    type: 'discord-role-list',
    label: 'Rollen behalten',
    description: 'Diese Rollen bleiben während eines Jails erhalten (z.B. eine Sprachsperre).',
    group: 'Discord',
  },
  {
    key: 'jailChannelId',
    type: 'discord-channel',
    label: 'Jail-Channel',
    description: 'Channel, in dem das Mitglied über den Jail informiert wird.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'moderationLogChannelId',
    type: 'discord-channel',
    label: 'Moderations-Log',
    description: 'Überschreibt den zentralen Moderations-Log für dieses Modul.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'maxDurationSeconds',
    type: 'duration',
    label: 'Maximale Jail-Dauer',
    description: 'Längere Strafen lassen sich im Dashboard nicht anlegen.',
    group: 'Verhalten',
    min: 60,
    max: JAIL_MAX_DURATION_SECONDS,
    presets: [60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60],
  },
  {
    key: 'postModerationLog',
    type: 'boolean',
    label: 'Embed im Moderations-Log posten',
    group: 'Benachrichtigungen',
  },
  {
    key: 'notifyInJailChannel',
    type: 'boolean',
    label: 'Hinweis im Jail-Channel posten',
    group: 'Benachrichtigungen',
  },
];

/**
 * Gesundheitsprüfung des Moduls.
 *
 * Beantwortet konkret, was fehlt - jeweils mit Link auf die passende
 * Einstellung, damit sich das Problem in einem Klick beheben lässt.
 */
async function jailHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<JailSettings>(JAIL_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const settingsHref = `/modules/${JAIL_MODULE_ID}`;

  const role = settings.jailRoleId
    ? context.roles.find((entry) => entry.id === settings.jailRoleId)
    : undefined;

  if (!settings.jailRoleId) {
    checks.push({
      label: 'Jail-Rolle',
      status: 'error',
      detail: 'Es ist keine Jail-Rolle gewählt. Ohne sie kann niemand gejailt werden.',
      fixHref: settingsHref,
    });
  } else if (!role || role.deleted) {
    checks.push({
      label: 'Jail-Rolle',
      status: 'error',
      detail: 'Die gewählte Jail-Rolle existiert auf Discord nicht mehr.',
      fixHref: settingsHref,
    });
  } else if (context.botHighestPosition > 0 && role.position >= context.botHighestPosition) {
    checks.push({
      label: 'Rollenhierarchie',
      status: 'error',
      detail: `"${role.name}" liegt auf oder über der Bot-Rolle - der Bot kann sie nicht vergeben.`,
      fixHref: '/server/roles',
    });
  } else {
    checks.push({ label: 'Jail-Rolle', status: 'ok', detail: role.name });
  }

  if (settings.notifyInJailChannel && !settings.jailChannelId) {
    checks.push({
      label: 'Jail-Channel',
      status: 'warning',
      detail: 'Die Benachrichtigung ist aktiv, es ist aber kein Channel gewählt.',
      fixHref: settingsHref,
    });
  }

  if (settings.postModerationLog && !settings.moderationLogChannelId) {
    checks.push({
      label: 'Moderations-Log',
      status: 'warning',
      detail: 'Ohne Channel wird der zentrale Moderations-Log aus den Einstellungen verwendet.',
      fixHref: '/settings',
    });
  }

  return checks;
}

export const jailModule: ModuleDefinition = registerModule({
  id: JAIL_MODULE_ID,
  name: 'Jail',
  description:
    'SwissHub Jail-System: Mitglieder temporär isolieren, Rollen sichern und automatisch wieder freigeben.',
  icon: 'Lock',
  tagline: 'Verwalte Jails und Strafen',
  permissionPrefix: 'jail',
  defaultEnabled: true,
  settingsSchema: jailSettingsSchema,
  settingsFields: jailSettingsFields,
  configVersion: 2,
  requiredDiscordPermissions: ['MANAGE_ROLES', 'SEND_MESSAGES', 'EMBED_LINKS', 'VIEW_CHANNEL'],
  healthChecks: jailHealthChecks,
  permissions: [
    {
      key: JAIL_PERMISSIONS.view,
      label: 'Jails ansehen',
      description: 'Aktive und vergangene Jail-Strafen einsehen.',
      module: JAIL_MODULE_ID,
    },
    {
      key: JAIL_PERMISSIONS.create,
      label: 'Jail erstellen',
      description: 'Mitglieder jailen. Führt eine echte Discord-Aktion aus.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
    {
      key: JAIL_PERMISSIONS.edit,
      label: 'Jail bearbeiten',
      description: 'Grund oder Dauer eines laufenden Jails anpassen.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
    {
      key: JAIL_PERMISSIONS.release,
      label: 'Jail aufheben',
      description: 'Mitglieder vorzeitig freilassen.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
    {
      key: JAIL_PERMISSIONS.settings,
      label: 'Jail-Einstellungen',
      description: 'Jail-Rolle, Channels und maximale Dauer konfigurieren.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/jail',
      label: 'Jail',
      description: 'Aktive und vergangene Jail-Strafen des SwissHub Discord-Servers',
      permission: JAIL_PERMISSIONS.view,
      icon: 'Lock',
      group: 'moderation',
      order: 30,
      counter: 'activeJails',
    },
  ],
});
