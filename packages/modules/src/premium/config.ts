import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';
import { seedProducts } from './products';

export const PREMIUM_MODULE_ID = 'premium';

/**
 * Berechtigungen des Premium-Moduls.
 *
 * Sie reihen sich in das bestehende rollenbasierte System ein - es gibt kein
 * zweites Rechtemodell. Wer Premium verwalten darf, wird wie ueberall sonst
 * ueber Discord-Rollen im Dashboard bestimmt.
 */
export const PREMIUM_PERMISSIONS = {
  view: 'premium.view',
  manage: 'premium.manage',
  productsManage: 'premium.products.manage',
  paymentsView: 'premium.payments.view',
  subscriptionsManage: 'premium.subscriptions.manage',
  discordSync: 'premium.discord.sync',
  stuebliManage: 'premium.stuebli.manage',
  settings: 'premium.settings',
} as const;

export const premiumSettingsSchema = z.object({
  premiumRoleId: z.string().nullable().default(null),
  stuebliRoleId: z.string().nullable().default(null),
  bundleRoleId: z.string().nullable().default(null),
  stuebliCategoryId: z.string().nullable().default(null),
  /// Schonfrist nach einer fehlgeschlagenen Folgezahlung, in Sekunden.
  gracePeriodSeconds: z.number().int().min(0).max(30 * 86_400).default(3 * 86_400),
  /// Vorlage des Kanalnamens. `{user}` wird ersetzt.
  stuebliNameTemplate: z.string().min(1).max(80).default('🔊・stübli-{user}'),
  /// Teilnehmerlimit des Stüblis; 0 = unbegrenzt.
  stuebliUserLimit: z.number().int().min(0).max(99).default(0),
  /**
   * Darf der Besitzer die Rechte in seinem Kanal selbst verwalten?
   *
   * Standardmaessig aus. `Manage Permissions` erlaubt es, Ausnahmen fuer
   * beliebige Rollen zu setzen - in einem Kanal, dessen Kategorie der Bot
   * verwaltet, ist das eine Rechteausweitung, die man bewusst treffen muss.
   */
  stuebliOwnerManagePermissions: z.boolean().default(false),
});

export type PremiumSettings = z.infer<typeof premiumSettingsSchema>;

const premiumSettingsFields: SettingsField[] = [
  {
    key: 'premiumRoleId',
    type: 'discord-role',
    label: 'Premium-Rolle',
    description: 'Erhält, wer ein Angebot mit Premium-Anspruch gebucht hat.',
    group: 'Discord',
    mustBeManageable: true,
  },
  {
    key: 'stuebliRoleId',
    type: 'discord-role',
    label: 'Premium-Stübli-Rolle',
    description: 'Erhält, wer ein Angebot mit eigenem Sprachkanal gebucht hat.',
    group: 'Discord',
    mustBeManageable: true,
  },
  {
    key: 'bundleRoleId',
    type: 'discord-role',
    label: 'Bundle-Rolle (optional)',
    description: 'Zusätzliche Rolle nur für Bundle-Mitglieder. Leer lassen, wenn nicht gewünscht.',
    group: 'Discord',
    mustBeManageable: true,
  },
  {
    key: 'stuebliCategoryId',
    type: 'discord-channel',
    label: 'Kategorie der Stübli',
    description: 'In dieser Kategorie entstehen die persönlichen Sprachkanäle.',
    group: 'Discord',
    channelKinds: ['category'],
  },
  {
    key: 'stuebliNameTemplate',
    type: 'text',
    label: 'Name des Stüblis',
    description: 'Platzhalter: {user}. Discord kürzt auf 100 Zeichen.',
    group: 'Stübli',
    maxLength: 80,
  },
  {
    key: 'stuebliUserLimit',
    type: 'number',
    label: 'Teilnehmerlimit',
    description: '0 bedeutet unbegrenzt.',
    group: 'Stübli',
    min: 0,
    max: 99,
  },
  {
    key: 'stuebliOwnerManagePermissions',
    type: 'boolean',
    label: 'Besitzer darf Rechte im eigenen Kanal verwalten',
    description:
      'Standardmässig aus. Eingeschaltet kann der Besitzer Ausnahmen für beliebige Rollen setzen - das geht über das Moderieren im eigenen Kanal hinaus.',
    group: 'Stübli',
  },
  {
    key: 'gracePeriodSeconds',
    type: 'duration',
    label: 'Schonfrist nach fehlgeschlagener Zahlung',
    description: 'So lange bleiben die Vorteile bestehen, bevor sie entzogen werden.',
    group: 'Abrechnung',
    min: 0,
    max: 30 * 86_400,
    presets: [0, 86_400, 3 * 86_400, 7 * 86_400],
  },
];

/**
 * Modul-Gesundheit.
 *
 * Premium greift tief in Discord ein; fehlt eine Zuordnung, laesst sich der
 * Anspruch nicht erfuellen. Das soll im Dashboard stehen, statt still im
 * Protokoll zu landen.
 */
async function premiumHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<PremiumSettings>(PREMIUM_MODULE_ID);

  const rolle = (id: string | null, label: string, pflicht: boolean): void => {
    if (!id) {
      checks.push({
        label,
        status: pflicht ? 'error' : 'ok',
        detail: pflicht ? 'Nicht zugeordnet - der Anspruch lässt sich nicht vergeben.' : 'Nicht gesetzt.',
        fixHref: `/modules/${PREMIUM_MODULE_ID}`,
      });
      return;
    }
    const treffer = context.roles.find((entry) => entry.id === id);
    if (!treffer) {
      checks.push({ label, status: 'error', detail: 'Rolle existiert auf Discord nicht mehr.' });
      return;
    }
    if (treffer.position >= context.botHighestPosition) {
      checks.push({
        label,
        status: 'error',
        detail: `"${treffer.name}" steht über der Bot-Rolle und lässt sich nicht vergeben.`,
      });
      return;
    }
    checks.push({ label, status: 'ok', detail: `@${treffer.name}` });
  };

  rolle(settings.premiumRoleId, 'Premium-Rolle', true);
  rolle(settings.stuebliRoleId, 'Premium-Stübli-Rolle', true);
  rolle(settings.bundleRoleId, 'Bundle-Rolle', false);

  if (!settings.stuebliCategoryId) {
    checks.push({
      label: 'Kategorie der Stübli',
      status: 'error',
      detail: 'Ohne Kategorie lässt sich kein Sprachkanal anlegen.',
      fixHref: `/modules/${PREMIUM_MODULE_ID}`,
    });
  } else {
    const kategorie = context.channels.find((entry) => entry.id === settings.stuebliCategoryId);
    checks.push(
      kategorie
        ? { label: 'Kategorie der Stübli', status: 'ok', detail: kategorie.name }
        : { label: 'Kategorie der Stübli', status: 'error', detail: 'Kategorie existiert nicht mehr.' },
    );
  }

  return checks;
}

export const premiumModule: ModuleDefinition = registerModule({
  id: PREMIUM_MODULE_ID,
  name: 'Premium',
  description:
    'Monatliche Abonnements mit automatischen Discord-Vorteilen: Premium-Rolle, Premium-Stübli und persönlicher Sprachkanal.',
  icon: 'Crown',
  tagline: 'Abonnements und Stübli',
  permissionPrefix: 'premium',
  // Bewusst aus: Premium greift auf Discord zu und kostet Geld. Das schaltet
  // die Verwaltung ein, wenn Rollen, Kategorie und Zahlungsanbieter stehen.
  defaultEnabled: false,
  settingsSchema: premiumSettingsSchema,
  settingsFields: premiumSettingsFields,
  configVersion: 1,
  requiredDiscordPermissions: ['MANAGE_ROLES', 'MANAGE_CHANNELS', 'VIEW_CHANNEL'],
  healthChecks: premiumHealthChecks,
  // Ohne Angebote wäre die öffentliche Seite nach dem Einschalten leer, und
  // anlegen lassen sie sich nirgends sonst - die Verwaltung darf bestehende
  // nur bearbeiten.
  onEnable: async () => {
    await seedProducts();
  },
  permissions: [
    {
      key: PREMIUM_PERMISSIONS.view,
      label: 'Premium ansehen',
      description: 'Übersicht, Abonnements und Stübli einsehen.',
      module: PREMIUM_MODULE_ID,
    },
    {
      key: PREMIUM_PERMISSIONS.manage,
      label: 'Premium verwalten',
      description: 'Sammelberechtigung für die Premium-Verwaltung.',
      module: PREMIUM_MODULE_ID,
      critical: true,
    },
    {
      key: PREMIUM_PERMISSIONS.productsManage,
      label: 'Angebote verwalten',
      description: 'Namen, Preise, Vorteile und Ansprüche der Angebote ändern.',
      module: PREMIUM_MODULE_ID,
      critical: true,
    },
    {
      key: PREMIUM_PERMISSIONS.paymentsView,
      label: 'Zahlungen einsehen',
      description: 'Zahlungsverlauf aller Mitglieder einsehen.',
      module: PREMIUM_MODULE_ID,
    },
    {
      key: PREMIUM_PERMISSIONS.subscriptionsManage,
      label: 'Abonnements verwalten',
      description: 'Abonnements administrativ beenden und Schonfristen setzen.',
      module: PREMIUM_MODULE_ID,
      critical: true,
    },
    {
      key: PREMIUM_PERMISSIONS.discordSync,
      label: 'Discord synchronisieren',
      description: 'Rollen und Stübli von Hand abgleichen lassen.',
      module: PREMIUM_MODULE_ID,
      critical: true,
    },
    {
      key: PREMIUM_PERMISSIONS.stuebliManage,
      label: 'Stübli verwalten',
      description: 'Persönliche Sprachkanäle reparieren, neu anlegen und entfernen.',
      module: PREMIUM_MODULE_ID,
      critical: true,
    },
    {
      key: PREMIUM_PERMISSIONS.settings,
      label: 'Premium-Einstellungen ändern',
      description: 'Rollen, Kategorie und Schonfrist zuordnen.',
      module: PREMIUM_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/premium/uebersicht',
      titlePrefix: '/premium',
      label: 'Premium',
      description: 'Abonnements, Zahlungen und Premium-Stübli',
      permission: PREMIUM_PERMISSIONS.view,
      icon: 'Crown',
      group: 'modules',
      order: 60,
    },
  ],
});
