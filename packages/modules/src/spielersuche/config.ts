import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const SPIELERSUCHE_MODULE_ID = 'spielersuche';

/**
 * Berechtigungen der Spielersuche.
 *
 * Der alte Bot kannte zwei fest verdrahtete Rollen-IDs (`ALLOWED_ROLE_ID_1/2`)
 * und darüber hinaus nur "ist Discord-Administrator". Hier ist jede Fähigkeit
 * eine eigene Berechtigung, die im Dashboard einer Rolle zugewiesen wird -
 * dieselbe Zuordnung gilt für Slash Command und Web-Oberfläche.
 */
export const SPIELERSUCHE_PERMISSIONS = {
  view: 'spielersuche.view',
  create: 'spielersuche.create',
  join: 'spielersuche.join',
  closeOwn: 'spielersuche.closeOwn',
  closeAny: 'spielersuche.closeAny',
  gamesView: 'spielersuche.games.view',
  gamesManage: 'spielersuche.games.manage',
  settingsView: 'spielersuche.settings.view',
  settingsManage: 'spielersuche.settings.manage',
  statsViewOwn: 'spielersuche.stats.viewOwn',
  statsViewAll: 'spielersuche.stats.viewAll',
  onboardingManage: 'spielersuche.onboarding.manage',
  import: 'spielersuche.import',
} as const;

/** Farbe des alten Bots (`DEFAULT_COLOR = 0xAFDBF5`). */
export const DEFAULT_ACCENT_COLOR = '#AFDBF5';

/** Fusszeile des alten Bots - bleibt als Standard erhalten. */
export const DEFAULT_FOOTER_TEXT =
  'SwissHub Spielersuche • Suech jetzt in Mitspieler für dis Game mit /spielersuche';

export const DEFAULT_ONBOARDING_TITLE = '🎮 Suechsch Mitspieler? So gahts:';

export const DEFAULT_ONBOARDING_TEXT = `\`/spielersuche\` → Spiel, Azahl Mitspieler & Kommentar uswähle → de Bot macht automatisch en Voice-Channel + d Suechi

**So funktionierts**
✅ Anderi klicke uf **Mitmache** und sind sofort debi
✅ Neui Lüt us de SwissHub-Community kenneleere
✅ Nur eini aktivi Suechi glichziitig – so bliibts übersichtlich

**Aktiv sii lohnt sich**
💰 Wenn de aktiv derbi bisch, gits immer wieder chliini Gäld-Priise!`;

/** Vorlage für den Namen des Sprachkanals. */
export const DEFAULT_VOICE_NAME_TEMPLATE = '🎮・{game}・{creator}';

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/u, 'Bitte eine Hex-Farbe wie #AFDBF5 angeben.')
  .default(DEFAULT_ACCENT_COLOR);

export const spielersucheSettingsSchema = z.object({
  // --- Discord -------------------------------------------------------------
  /** Channel, in dem die Suchen veröffentlicht werden (früher `search_channel_id`). */
  searchChannelId: optionalSnowflakeSchema,
  /** Kategorie für die Sprachkanäle (früher `voice_category_id`). */
  voiceCategoryId: optionalSnowflakeSchema,

  // --- Verhalten -----------------------------------------------------------
  /** Automatisches Schliessen nach dieser Zeit (früher `expiry_hours`). */
  expiryHours: z.number().int().min(1).max(168).default(12),
  /**
   * Gleichzeitig offene Suchen pro Person. Der alte Bot erlaubte genau eine;
   * das bleibt der Standard.
   */
  maxActiveSearchesPerUser: z.number().int().min(1).max(10).default(1),
  /** Obergrenze für "gsuechti Spieler", wenn das Spiel keine Squad-Grösse hat. */
  maxRequestedPlayers: z.number().int().min(1).max(50).default(20),

  // --- Rollen-Ping ---------------------------------------------------------
  /** Spielrolle beim Start einer Suche erwähnen. */
  rolePingEnabled: z.boolean().default(true),
  /** Sperrfrist je Spiel in Minuten (früher fest 5). */
  rolePingCooldownMinutes: z.number().int().min(0).max(1440).default(5),

  // --- Darstellung ---------------------------------------------------------
  accentColor: hexColorSchema,
  footerText: z.string().max(200).default(DEFAULT_FOOTER_TEXT),

  // --- Voice ---------------------------------------------------------------
  /** Sprachkanal je Suche automatisch erstellen. */
  voiceEnabled: z.boolean().default(true),
  /** Platzhalter: {game}, {creator}, {id}. */
  voiceNameTemplate: z.string().min(1).max(90).default(DEFAULT_VOICE_NAME_TEMPLATE),
  /** Leere Spielersuche-Kanäle automatisch löschen. */
  voiceAutoCleanup: z.boolean().default(true),
  /**
   * Zusätzliche Moderationsrechte für den Ersteller in seinem Sprachkanal
   * (Mitglieder stummschalten, verschieben). Ohne diese Option erhält er nur
   * die üblichen Sprechrechte.
   */
  voiceCreatorModeration: z.boolean().default(true),

  // --- Onboarding ----------------------------------------------------------
  onboardingEnabled: z.boolean().default(false),
  /** Uhrzeit in Europe/Zurich, Format HH:MM. */
  onboardingTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Bitte eine Uhrzeit im Format HH:MM angeben.')
    .default('16:00'),
  /** Ohne eigene Wahl wird der Spielersuche-Channel verwendet. */
  onboardingChannelId: optionalSnowflakeSchema,
  onboardingTitle: z.string().max(200).default(DEFAULT_ONBOARDING_TITLE),
  onboardingText: z.string().max(3000).default(DEFAULT_ONBOARDING_TEXT),
  onboardingBannerUrl: z.string().max(1000).default(''),
  onboardingFooterText: z.string().max(200).default(''),
});

export type SpielersucheSettings = z.infer<typeof spielersucheSettingsSchema>;

export const spielersucheSettingsFields: SettingsField[] = [
  {
    key: 'searchChannelId',
    type: 'discord-channel',
    label: 'Spielersuche-Channel',
    description: 'Hier werden die Suchen veröffentlicht. Der Bot muss dort schreiben dürfen.',
    group: 'Discord',
    required: true,
    channelKinds: ['text'],
  },
  {
    key: 'voiceCategoryId',
    type: 'discord-channel',
    label: 'Voice-Kategorie',
    description: 'In dieser Kategorie entstehen die Sprachkanäle der Suchen.',
    group: 'Discord',
    channelKinds: ['category'],
  },
  {
    key: 'expiryHours',
    type: 'number',
    label: 'Automatisch schliessen nach',
    description: 'Danach wird eine Suche automatisch beendet.',
    group: 'Verhalten',
    min: 1,
    max: 168,
    unit: 'Stunden',
  },
  {
    key: 'maxActiveSearchesPerUser',
    type: 'number',
    label: 'Aktive Suchen pro Person',
    description: 'Der frühere Bot erlaubte genau eine gleichzeitig offene Suche.',
    group: 'Verhalten',
    min: 1,
    max: 10,
  },
  {
    key: 'maxRequestedPlayers',
    type: 'number',
    label: 'Maximal gesuchte Spieler',
    description: 'Gilt für Spiele ohne eigene Squad-Grösse.',
    group: 'Verhalten',
    min: 1,
    max: 50,
  },
  {
    key: 'rolePingEnabled',
    type: 'boolean',
    label: 'Spielrolle erwähnen',
    description: 'Beim Start einer Suche wird die Rolle des Spiels gepingt.',
    group: 'Rollen-Ping',
  },
  {
    key: 'rolePingCooldownMinutes',
    type: 'number',
    label: 'Ping-Sperrfrist je Spiel',
    description:
      'Innerhalb dieser Zeit wird dieselbe Spielrolle nicht erneut erwähnt. Die Suche entsteht trotzdem. 0 deaktiviert die Sperrfrist.',
    group: 'Rollen-Ping',
    min: 0,
    max: 1440,
    unit: 'Minuten',
  },
  {
    key: 'accentColor',
    type: 'text',
    label: 'Embed-Farbe',
    description: 'Hex-Farbe der Suchen-Embeds, z.B. #AFDBF5.',
    group: 'Darstellung',
    maxLength: 7,
    placeholder: DEFAULT_ACCENT_COLOR,
  },
  {
    key: 'footerText',
    type: 'text',
    label: 'Fusszeile',
    group: 'Darstellung',
    maxLength: 200,
  },
  {
    key: 'voiceEnabled',
    type: 'boolean',
    label: 'Sprachkanal automatisch erstellen',
    group: 'Voice',
  },
  {
    key: 'voiceNameTemplate',
    type: 'text',
    label: 'Name des Sprachkanals',
    description: 'Platzhalter: {game}, {creator}, {id}.',
    group: 'Voice',
    maxLength: 90,
  },
  {
    key: 'voiceAutoCleanup',
    type: 'boolean',
    label: 'Leere Sprachkanäle löschen',
    description: 'Nur Kanäle, die von diesem Modul erstellt wurden.',
    group: 'Voice',
  },
  {
    key: 'voiceCreatorModeration',
    type: 'boolean',
    label: 'Ersteller darf im eigenen Kanal moderieren',
    description: 'Mitglieder stummschalten und verschieben. Ohne diese Option nur Sprechrechte.',
    group: 'Voice',
  },
  {
    key: 'onboardingEnabled',
    type: 'boolean',
    label: 'Tägliche Hinweisnachricht senden',
    group: 'Onboarding',
  },
  {
    key: 'onboardingTime',
    type: 'text',
    label: 'Uhrzeit',
    description: 'Format HH:MM, Zeitzone Europe/Zurich.',
    group: 'Onboarding',
    maxLength: 5,
    placeholder: '16:00',
  },
  {
    key: 'onboardingChannelId',
    type: 'discord-channel',
    label: 'Channel',
    description: 'Ohne eigene Wahl wird der Spielersuche-Channel verwendet.',
    group: 'Onboarding',
    channelKinds: ['text'],
  },
  {
    key: 'onboardingTitle',
    type: 'text',
    label: 'Titel',
    group: 'Onboarding',
    maxLength: 200,
  },
  {
    key: 'onboardingText',
    type: 'textarea',
    label: 'Text',
    description: 'Discord-Markdown ist erlaubt. Erwähnungen bleiben wirkungslos.',
    group: 'Onboarding',
    maxLength: 3000,
  },
  {
    key: 'onboardingBannerUrl',
    type: 'text',
    label: 'Banner-URL',
    description: 'Nur https. Leer lassen für kein Bild.',
    group: 'Onboarding',
    maxLength: 1000,
  },
  {
    key: 'onboardingFooterText',
    type: 'text',
    label: 'Fusszeile',
    description: 'Leer lassen für die allgemeine Fusszeile.',
    group: 'Onboarding',
    maxLength: 200,
  },
];

/**
 * Gesundheitsprüfung.
 *
 * Beantwortet konkret, was fehlt, damit eine Suche überhaupt funktionieren
 * kann - mit Link auf die passende Einstellung.
 */
async function spielersucheHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<SpielersucheSettings>(SPIELERSUCHE_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const settingsHref = `/modules/${SPIELERSUCHE_MODULE_ID}`;

  // --- Suchen-Channel ------------------------------------------------------
  const searchChannel = settings.searchChannelId
    ? context.channels.find((entry) => entry.id === settings.searchChannelId)
    : undefined;

  if (!settings.searchChannelId) {
    checks.push({
      label: 'Spielersuche-Channel',
      status: 'error',
      detail: 'Ohne Channel kann keine Suche veröffentlicht werden.',
      fixHref: settingsHref,
    });
  } else if (!searchChannel || searchChannel.deleted) {
    checks.push({
      label: 'Spielersuche-Channel',
      status: 'error',
      detail: 'Der gewählte Channel existiert auf Discord nicht mehr.',
      fixHref: settingsHref,
    });
  } else {
    const { discord, missingPermissions } = await import('@swisshub/discord');
    const permissions = await discord.channels.botPermissions(settings.searchChannelId).catch(() => null);

    if (permissions === null) {
      checks.push({
        label: 'Spielersuche-Channel',
        status: 'warning',
        detail: `#${searchChannel.name} - die Berechtigungen des Bots konnten nicht geprüft werden.`,
      });
    } else {
      const missing = missingPermissions(permissions, ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS']);
      checks.push(
        missing.length === 0
          ? { label: 'Spielersuche-Channel', status: 'ok', detail: `#${searchChannel.name}` }
          : {
              label: 'Spielersuche-Channel',
              status: 'error',
              detail: `Dem Bot fehlen in #${searchChannel.name}: ${missing.join(', ')}.`,
              fixHref: '/system/bot',
            },
      );
    }
  }

  // --- Voice-Kategorie -----------------------------------------------------
  if (settings.voiceEnabled) {
    const category = settings.voiceCategoryId
      ? context.channels.find((entry) => entry.id === settings.voiceCategoryId)
      : undefined;

    if (!settings.voiceCategoryId) {
      checks.push({
        label: 'Voice-Kategorie',
        status: 'error',
        detail: 'Sprachkanäle sind aktiv, aber es ist keine Kategorie gewählt.',
        fixHref: settingsHref,
      });
    } else if (!category || category.deleted) {
      checks.push({
        label: 'Voice-Kategorie',
        status: 'error',
        detail: 'Die gewählte Kategorie existiert auf Discord nicht mehr.',
        fixHref: settingsHref,
      });
    } else {
      checks.push({ label: 'Voice-Kategorie', status: 'ok', detail: category.name });
    }
  }

  // --- Spiele --------------------------------------------------------------
  const { listGames } = await import('./games');
  const games = await listGames({ includeDisabled: true }).catch(() => []);
  const active = games.filter((game) => game.enabled);

  if (active.length === 0) {
    checks.push({
      label: 'Spiele',
      status: 'error',
      detail: 'Es ist kein aktives Spiel hinterlegt - /spielersuche hat nichts zur Auswahl.',
      fixHref: '/spielersuche/spiele',
    });
  } else {
    const orphaned = active.filter(
      (game) => !context.roles.some((role) => role.id === game.roleId && !role.deleted),
    );
    checks.push(
      orphaned.length === 0
        ? { label: 'Spiele', status: 'ok', detail: `${active.length} aktiv` }
        : {
            label: 'Spielrollen',
            status: 'warning',
            detail: `Rolle fehlt bei: ${orphaned.map((game) => game.name).join(', ')}.`,
            fixHref: '/spielersuche/spiele',
          },
    );
  }

  return checks;
}

export const spielersucheModule: ModuleDefinition = registerModule({
  id: SPIELERSUCHE_MODULE_ID,
  name: 'Spielersuche',
  description:
    'Mitspieler finden: Suche starten, Gruppe füllen, Sprachkanal automatisch erstellen - über Discord und über das Dashboard.',
  icon: 'UserSearch',
  tagline: 'Spieler zusammenbringen',
  permissionPrefix: 'spielersuche',
  defaultEnabled: true,
  settingsSchema: spielersucheSettingsSchema,
  settingsFields: spielersucheSettingsFields,
  configVersion: 1,
  requiredDiscordPermissions: [
    'VIEW_CHANNEL',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'MANAGE_CHANNELS',
    'MOVE_MEMBERS',
    'CONNECT',
    'USE_APPLICATION_COMMANDS',
  ],
  healthChecks: spielersucheHealthChecks,
  permissions: [
    {
      key: SPIELERSUCHE_PERMISSIONS.view,
      label: 'Spielersuchen ansehen',
      description: 'Aktive und vergangene Suchen einsehen.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.create,
      label: 'Spielersuche starten',
      description: 'Eine Suche erstellen - über /spielersuche und über das Dashboard.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.join,
      label: 'Suche beitreten',
      description: 'Über den Knopf "Mitmache" einer Gruppe beitreten.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.closeOwn,
      label: 'Eigene Suche beenden',
      description: 'Die selbst gestartete Suche vorzeitig schliessen.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.closeAny,
      label: 'Fremde Suche beenden',
      description: 'Jede Suche schliessen - ersetzt die frühere Administratorprüfung.',
      module: SPIELERSUCHE_MODULE_ID,
      critical: true,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.gamesView,
      label: 'Spiele ansehen',
      description: 'Die Liste der konfigurierten Spiele einsehen.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.gamesManage,
      label: 'Spiele verwalten',
      description: 'Spiele anlegen, bearbeiten, deaktivieren und löschen.',
      module: SPIELERSUCHE_MODULE_ID,
      critical: true,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.settingsView,
      label: 'Einstellungen ansehen',
      description: 'Die Konfiguration des Moduls einsehen, ohne sie zu ändern.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.settingsManage,
      label: 'Einstellungen ändern',
      description: 'Channel, Kategorie, Ablaufzeit und Sperrfristen konfigurieren.',
      module: SPIELERSUCHE_MODULE_ID,
      critical: true,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.statsViewOwn,
      label: 'Eigene Statistik ansehen',
      description: 'Die eigenen Suchen, Teilnahmen und Voice-Zeit einsehen.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.statsViewAll,
      label: 'Statistik aller Mitglieder ansehen',
      description: 'Rangliste und fremde Statistiken - ersetzt die frühere Administratorprüfung.',
      module: SPIELERSUCHE_MODULE_ID,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.onboardingManage,
      label: 'Onboarding verwalten',
      description: 'Tägliche Hinweisnachricht konfigurieren und testen.',
      module: SPIELERSUCHE_MODULE_ID,
      critical: true,
    },
    {
      key: SPIELERSUCHE_PERMISSIONS.import,
      label: 'Alte Spielersuche-Datenbank importieren',
      description: 'Die SQLite-Datei des früheren Spielersuche-Bots übernehmen.',
      module: SPIELERSUCHE_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/spielersuche',
      label: 'Spielersuche',
      description: 'Mitspieler finden, Gruppen füllen und Sprachkanäle verwalten',
      permission: SPIELERSUCHE_PERMISSIONS.view,
      icon: 'UserSearch',
      group: 'modules',
      order: 50,
    },
  ],
});
