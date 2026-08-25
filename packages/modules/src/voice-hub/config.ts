import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';
import type { SettingsField } from '../settings/fields';

export const VOICE_HUB_MODULE_ID = 'voiceHub';

/**
 * Berechtigungen des Voice Hub.
 *
 * Getrennt nach dem, was jemand mit dem eigenen Talk tut, und dem, was jemand
 * mit fremden tut. Wer seinen Talk umbenennt, braucht keine Verwaltungsrechte
 * - und wer Verwaltungsrechte hat, soll dafuer nicht Besitzer sein muessen.
 */
export const VOICE_HUB_PERMISSIONS = {
  view: 'voiceHub.view',
  use: 'voiceHub.use',
  manageOwn: 'voiceHub.manageOwn',
  manageUsers: 'voiceHub.manageUsers',
  transferOwnership: 'voiceHub.transferOwnership',

  adminView: 'voiceHub.admin.view',
  adminManage: 'voiceHub.admin.manage',
  adminDelete: 'voiceHub.admin.delete',
  hubsManage: 'voiceHub.hubs.manage',
  presetsManage: 'voiceHub.presets.manage',
  settingsManage: 'voiceHub.settings',
  statsView: 'voiceHub.stats.view',
} as const;

export const voiceHubSettingsSchema = z.object({
  /**
   * Wie viele Talks jemand gleichzeitig besitzen darf.
   *
   * Eins ist die richtige Voreinstellung: wer den Hub ein zweites Mal
   * betritt, will fast immer zurueck in seinen Talk und keinen neuen.
   */
  maxActivePerUser: z.number().int().min(1).max(10).default(1),

  /**
   * Wie lange ein leerer Talk stehen bleibt, wenn das Preset nichts sagt.
   *
   * Null waere hart: wer kurz die Verbindung verliert, faende seinen Talk
   * nicht mehr vor.
   */
  defaultDeleteGraceSeconds: z.number().int().min(0).max(3600).default(30),

  /** Bedienfeld im Textchat des Talks anlegen? */
  controlPanelEnabled: z.boolean().default(true),

  /**
   * Darf jemand seine Voreinstellungen speichern?
   *
   * Bewusst abschaltbar und ausdruecklich freiwillig: eine Anwendung, die
   * sich merkt, wie jemand seinen Kanal nennt und wen er hereinlaesst, soll
   * das tun, weil er es will.
   */
  userPreferencesEnabled: z.boolean().default(true),

  /** Duerfen Vertrauenspersonen jeden neuen Talk betreten? */
  trustedMembersEnabled: z.boolean().default(true),

  /** Hoechste Bitrate, die jemand selbst setzen darf (bit/s). */
  maxBitrate: z.number().int().min(8000).max(384000).default(96000),

  /** Wie lange geschlossene Talks fuer die Statistik aufbewahrt werden. */
  historyRetentionDays: z.number().int().min(0).max(730).default(90),

  /** Keine neuen Talks; bestehende bleiben bedienbar. */
  maintenanceMode: z.boolean().default(false),
});

export type VoiceHubSettings = z.infer<typeof voiceHubSettingsSchema>;

const voiceHubSettingsFields: SettingsField[] = [
  {
    key: 'maxActivePerUser',
    type: 'number',
    label: 'Talks je Person',
    description: 'Wie viele eigene Talks jemand gleichzeitig haben darf.',
    group: 'Verhalten',
    min: 1,
    max: 10,
  },
  {
    key: 'defaultDeleteGraceSeconds',
    type: 'number',
    label: 'Leeren Talk löschen nach',
    description: 'Sekunden. Gilt, wenn das Preset nichts anderes sagt.',
    group: 'Verhalten',
    min: 0,
    max: 3600,
    unit: 'Sekunden',
  },
  {
    key: 'maxBitrate',
    type: 'number',
    label: 'Höchste Bitrate',
    description: 'In bit/s. Was der Server nicht kann, lehnt Discord ab.',
    group: 'Verhalten',
    min: 8000,
    max: 384000,
    unit: 'bit/s',
  },
  {
    key: 'controlPanelEnabled',
    type: 'boolean',
    label: 'Bedienfeld im Talk',
    description: 'Postet nach dem Erstellen ein Bedienfeld in den Textchat des Talks.',
    group: 'Discord',
  },
  {
    key: 'userPreferencesEnabled',
    type: 'boolean',
    label: 'Persönliche Voreinstellungen',
    description: 'Mitglieder dürfen Name, Limit und Sperre für künftige Talks speichern.',
    group: 'Mitglieder',
  },
  {
    key: 'trustedMembersEnabled',
    type: 'boolean',
    label: 'Vertrauenspersonen',
    description: 'Mitglieder dürfen eine Liste führen, die jeden ihrer Talks betreten darf.',
    group: 'Mitglieder',
  },
  {
    key: 'historyRetentionDays',
    type: 'number',
    label: 'Statistik aufbewahren',
    description: 'Tage. 0 = unbegrenzt.',
    group: 'Betrieb',
    min: 0,
    max: 730,
    unit: 'Tage',
  },
  {
    key: 'maintenanceMode',
    type: 'boolean',
    label: 'Wartungsmodus',
    description: 'Es entstehen keine neuen Talks. Bestehende bleiben bedienbar.',
    group: 'Betrieb',
  },
];

/**
 * Was dem Modul zum Arbeiten fehlt.
 *
 * Der Voice Hub kann eingerichtet aussehen und trotzdem nichts tun: ohne Hub
 * passiert beim Betreten nichts, ohne Rolle mit «Talk erstellen» darf es
 * niemand, und ohne die Discord-Rechte scheitert der Bot still. Das faellt
 * sonst erst auf, wenn die ersten Mitglieder nachfragen.
 */
async function voiceHubHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { prisma } = await import('@swisshub/database');
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<VoiceHubSettings>(VOICE_HUB_MODULE_ID);

  const hubs = await prisma.voiceHub.findMany({ where: { enabled: true } }).catch(() => []);

  if (hubs.length === 0) {
    checks.push({
      label: 'Hub-Channels',
      status: 'error',
      detail: 'Kein aktiver Hub - das Betreten eines Channels erzeugt nichts.',
      fixHref: '/voice/hubs',
    });
  } else {
    checks.push({
      label: 'Hub-Channels',
      status: 'ok',
      detail: `${hubs.length} aktiv.`,
    });
  }

  // Jeder Hub braucht seinen Channel und seine Kategorie.
  for (const hub of hubs) {
    const kanal = context.channels.find((eintrag) => eintrag.id === hub.discordChannelId);
    if (!kanal) {
      checks.push({
        label: `Hub «${hub.name}»`,
        status: 'error',
        detail: 'Der Hub-Channel existiert auf Discord nicht mehr.',
        fixHref: '/voice/hubs',
      });
      continue;
    }
    const kategorie = context.channels.find((eintrag) => eintrag.id === hub.targetCategoryId);
    if (!kategorie) {
      checks.push({
        label: `Hub «${hub.name}»`,
        status: 'error',
        detail: 'Die Zielkategorie existiert auf Discord nicht mehr.',
        fixHref: '/voice/hubs',
      });
    }
  }

  // Darf ueberhaupt jemand einen Talk erstellen?
  const { loadRoleConfiguration } = await import('@swisshub/permissions');
  const rollen = await loadRoleConfiguration().catch(() => null);
  const darfNutzen =
    rollen?.mappings.some((zuordnung) => zuordnung.permission === VOICE_HUB_PERMISSIONS.use) ??
    false;
  checks.push(
    darfNutzen
      ? { label: 'Talk erstellen', status: 'ok', detail: 'Mindestens eine Rolle darf es.' }
      : {
          label: 'Talk erstellen',
          status: 'error',
          detail: 'Keine Rolle hat «Eigenen Talk erstellen» - niemand kann einen Talk öffnen.',
          fixHref: '/server/permissions',
        },
  );

  if (settings.maintenanceMode) {
    checks.push({
      label: 'Betrieb',
      status: 'warning',
      detail: 'Wartungsmodus aktiv - es entstehen keine neuen Talks.',
    });
  }

  // Verwaiste Zeilen deuten auf einen Abgleich hin, der nicht laeuft.
  const reservierungen = await prisma.temporaryVoiceChannel
    .count({
      where: {
        closedAt: null,
        discordChannelId: null,
        createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
    })
    .catch(() => 0);
  if (reservierungen > 0) {
    checks.push({
      label: 'Abgleich',
      status: 'warning',
      detail: `${reservierungen} angefangene Talks wurden nie fertig. Läuft der Bot?`,
    });
  }

  return checks;
}

export const voiceHubModule: ModuleDefinition = registerModule({
  id: VOICE_HUB_MODULE_ID,
  name: 'Voice Hub',
  description:
    'Eigene Sprachkanäle auf Zuruf: Wer den Hub betritt, bekommt seinen eigenen Talk - mit Bedienfeld im Kanal und Verwaltung im Dashboard.',
  icon: 'Mic',
  tagline: 'Talks auf Zuruf',
  permissionPrefix: 'voiceHub',
  // Bewusst aus: das Modul legt Discord-Kanäle an. Eingeschaltet wird, wenn
  // Hub und Kategorie stehen.
  defaultEnabled: false,
  settingsSchema: voiceHubSettingsSchema,
  settingsFields: voiceHubSettingsFields,
  configVersion: 1,
  requiredDiscordPermissions: [
    'MANAGE_CHANNELS',
    'VIEW_CHANNEL',
    'MOVE_MEMBERS',
    'CONNECT',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'READ_MESSAGE_HISTORY',
  ],
  healthChecks: voiceHubHealthChecks,
  // Ohne Vorlage stuende der Verwalter vor einer leeren Seite und muesste
  // raten, was ein Preset ueberhaupt ist. Idempotent - das Modul laesst sich
  // beliebig oft aus- und wieder einschalten.
  onEnable: async () => {
    const { seedPresets } = await import('./presets');
    await seedPresets();
  },
  permissions: [
    {
      key: VOICE_HUB_PERMISSIONS.view,
      label: 'Voice Hub ansehen',
      description: 'Den Voice-Hub-Bereich im Dashboard öffnen.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.use,
      label: 'Eigenen Talk erstellen',
      description: 'Über einen Hub-Channel einen eigenen Sprachkanal öffnen.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.manageOwn,
      label: 'Eigenen Talk verwalten',
      description: 'Namen, Limit, Sperre und Sichtbarkeit des eigenen Talks ändern.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.manageUsers,
      label: 'Zugriff im eigenen Talk steuern',
      description: 'Einzelne Mitglieder zulassen, sperren oder aus dem Talk entfernen.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.transferOwnership,
      label: 'Talk übergeben',
      description: 'Den eigenen Talk an jemand anderen abgeben.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.adminView,
      label: 'Alle Talks sehen',
      description: 'Die laufenden Talks des Servers einsehen.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.adminManage,
      label: 'Fremde Talks verwalten',
      description: 'Namen, Limit, Zugriff und Besitzer fremder Talks ändern.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.adminDelete,
      label: 'Fremde Talks schliessen',
      description: 'Einen laufenden Talk beenden.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.hubsManage,
      label: 'Hub-Channels verwalten',
      description: 'Join-to-Create-Channels anlegen, ändern und abschalten.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.presetsManage,
      label: 'Presets verwalten',
      description: 'Vorlagen für neue Talks anlegen und ändern.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.settingsManage,
      label: 'Voice-Hub-Einstellungen',
      description: 'Die Moduleinstellungen ändern.',
      module: VOICE_HUB_MODULE_ID,
    },
    {
      key: VOICE_HUB_PERMISSIONS.statsView,
      label: 'Voice-Statistiken',
      description: 'Auswertungen über Talks und Nutzung ansehen.',
      module: VOICE_HUB_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/voice',
      label: 'Voice Hub',
      icon: 'Mic',
      permission: VOICE_HUB_PERMISSIONS.view,
      description: 'Eigene Talks, Hub-Channels und Vorlagen.',
      group: 'modules',
      order: 45,
    },
  ],
});
