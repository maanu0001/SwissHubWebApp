import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';

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
