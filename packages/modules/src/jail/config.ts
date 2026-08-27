import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import {
  DEFAULT_PERMANENT_PUBLIC_TEMPLATE,
  DEFAULT_PING_TEMPLATE,
  DEFAULT_PUBLIC_TEMPLATE,
  DEFAULT_RELEASE_TEMPLATE,
  JAIL_TEMPLATE_PLACEHOLDERS,
} from './templates';
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
  /** Darf eine Community-Abstimmung starten. */
  voteStart: 'jail.vote.start',
  /**
   * Darf in einer Abstimmung mehrfach stimmen.
   * Bewusst eine eigene Berechtigung statt einer fest verdrahteten Adminliste -
   * so ist das Verhalten im Dashboard steuerbar.
   */
  voteMultivote: 'jail.vote.multivote',
  /**
   * Darf trotz laufender Sperrfrist eine neue Abstimmung starten.
   * Ersetzt die feste Admin-Prüfung des alten Bots.
   */
  voteBypassCooldown: 'jail.vote.bypassCooldown',
  /** Darf die alte Jail-Datenbank importieren. */
  import: 'jail.import',
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

  // --- Vote Jail ----------------------------------------------------------
  /** Community-Abstimmungen aktivieren. */
  voteJailEnabled: z.boolean().default(false),
  /** Channel, in dem die Abstimmung veröffentlicht wird. */
  voteJailChannelId: optionalSnowflakeSchema,
  /** Stimmen, die für einen erfolgreichen Vote Jail nötig sind. */
  voteJailRequiredVotes: z.number().int().min(1).max(100).default(5),
  /** Laufzeit der Abstimmung in Sekunden. */
  voteJailDurationSeconds: z
    .number()
    .int()
    .min(60)
    .max(24 * 60 * 60)
    .default(5 * 60),
  /** Jail-Dauer bei erfolgreicher Abstimmung, in Sekunden. */
  voteJailResultSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 60 * 60)
    .default(30 * 60),
  /**
   * Sperrfrist für Initiatoren nach einer erfolgreichen Abstimmung.
   * Wer `jail.vote.bypassCooldown` hat, ist davon ausgenommen.
   */
  voteJailCooldownHours: z.number().int().min(0).max(168).default(12),

  // --- Öffentliche Nachrichten -------------------------------------------
  /** Channel für die öffentliche Ankündigung (früher ANNOUNCE_CHANNEL_ID). */
  announcementChannelId: optionalSnowflakeSchema,
  /** Channel, in dem das Mitglied gepingt wird (früher JAIL_PING_CHANNEL_ID). */
  jailPingChannelId: optionalSnowflakeSchema,
  /** Öffentliche Ankündigung senden. */
  announcePublicly: z.boolean().default(true),
  /** Mitglied im Jail-Ping-Channel erwähnen. */
  pingOnJail: z.boolean().default(true),
  /** Neue Jails standardmässig ohne öffentliche Ankündigung anlegen. */
  silentByDefault: z.boolean().default(false),
  publicJailTemplate: z.string().max(1000).default(DEFAULT_PUBLIC_TEMPLATE),
  publicPermanentJailTemplate: z.string().max(1000).default(DEFAULT_PERMANENT_PUBLIC_TEMPLATE),
  publicReleaseTemplate: z.string().max(1000).default(DEFAULT_RELEASE_TEMPLATE),
  jailPingTemplate: z.string().max(1000).default(DEFAULT_PING_TEMPLATE),
  voteJailPingTemplate: z
    .string()
    .max(1000)
    .default('Hoi {mention}, d Community het defür abgstumme dich in Jail z stecke ({end_relative}).'),

  // --- Verhalten ----------------------------------------------------------
  /**
   * Booster-Rolle. Sie bleibt während des Jails erhalten - im alten Bot war
   * die ID fest im Code, hier ist sie konfigurierbar und optional.
   */
  boosterRoleId: optionalSnowflakeSchema,
  keepBoosterRole: z.boolean().default(true),
  /** Mitglied beim Jail aus dem Sprachkanal trennen. */
  disconnectFromVoice: z.boolean().default(true),
  /** Jail beim erneuten Beitritt automatisch wieder anwenden. */
  reapplyOnRejoin: z.boolean().default(true),

  // --- Geschlechterrollen (optional) --------------------------------------
  /**
   * Nur für die Anrede in den Vorlagen (`{gendered:...}`, `{pronoun}`).
   * Ohne Konfiguration bleiben alle Texte neutral.
   */
  genderMaleRoleId: optionalSnowflakeSchema,
  genderFemaleRoleId: optionalSnowflakeSchema,
});

export type JailSettings = z.infer<typeof jailSettingsSchema>;

/** Platzhalterhilfe - steht direkt am ersten Vorlagenfeld. */
const PLACEHOLDER_HELP = `Verfügbare Platzhalter: ${JAIL_TEMPLATE_PLACEHOLDERS.map(
  (entry) => entry.token,
).join(', ')}. Unbekannte Platzhalter bleiben unverändert stehen.`;

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
  {
    key: 'voteJailEnabled',
    type: 'boolean',
    label: 'Vote Jail aktiv',
    description: 'Erlaubt Berechtigten, eine Community-Abstimmung über einen Jail zu starten.',
    group: 'Vote Jail',
  },
  {
    key: 'voteJailChannelId',
    type: 'discord-channel',
    label: 'Vote Jail Channel',
    description: 'Channel, in dem die Abstimmung veröffentlicht wird.',
    group: 'Vote Jail',
    channelKinds: ['text'],
  },
  {
    key: 'voteJailRequiredVotes',
    type: 'number',
    label: 'Benötigte Stimmen',
    description: 'So viele Stimmen führen zum Jail.',
    group: 'Vote Jail',
    min: 1,
    max: 100,
    unit: 'Stimmen',
  },
  {
    key: 'voteJailDurationSeconds',
    type: 'duration',
    label: 'Voting-Dauer',
    description: 'Danach endet die Abstimmung ohne Ergebnis.',
    group: 'Vote Jail',
    min: 60,
    max: 24 * 60 * 60,
    presets: [5 * 60, 10 * 60, 30 * 60, 60 * 60],
  },
  {
    key: 'voteJailResultSeconds',
    type: 'duration',
    label: 'Jail-Dauer bei Erfolg',
    group: 'Vote Jail',
    min: 60,
    max: 7 * 24 * 60 * 60,
    presets: [30 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60],
  },
  {
    key: 'voteJailCooldownHours',
    type: 'number',
    label: 'Sperrfrist nach erfolgreicher Abstimmung',
    description:
      'So lange darf dieselbe Person keine neue Abstimmung starten. 0 deaktiviert die Sperrfrist. Ausgenommen ist, wer "Vote Jail: Sperrfrist umgehen" besitzt.',
    group: 'Vote Jail',
    min: 0,
    max: 168,
    unit: 'Stunden',
  },

  // --- Discord: weitere Channels und Rollen --------------------------------
  {
    key: 'announcementChannelId',
    type: 'discord-channel',
    label: 'Ankündigungs-Channel',
    description: 'Hier erscheint die öffentliche Meldung, wenn jemand gejailt oder freigelassen wird.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'jailPingChannelId',
    type: 'discord-channel',
    label: 'Jail-Ping-Channel',
    description: 'Hier wird das Mitglied direkt erwähnt, damit es die Strafe mitbekommt.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'boosterRoleId',
    type: 'discord-role',
    label: 'Booster-Rolle',
    description: 'Optional. Wird während eines Jails nicht entzogen, solange die Option unten aktiv ist.',
    group: 'Discord',
  },
  {
    key: 'genderMaleRoleId',
    type: 'discord-role',
    label: 'Rolle "männlich"',
    description: 'Optional - wird ausschliesslich für die Anrede in den Textvorlagen verwendet.',
    group: 'Anrede',
  },
  {
    key: 'genderFemaleRoleId',
    type: 'discord-role',
    label: 'Rolle "weiblich"',
    description: 'Optional - wird ausschliesslich für die Anrede in den Textvorlagen verwendet.',
    group: 'Anrede',
  },

  // --- Verhalten -----------------------------------------------------------
  {
    key: 'keepBoosterRole',
    type: 'boolean',
    label: 'Booster-Rolle behalten',
    description: 'Server-Booster verlieren ihre Booster-Rolle während des Jails nicht.',
    group: 'Verhalten',
  },
  {
    key: 'disconnectFromVoice',
    type: 'boolean',
    label: 'Aus Sprachkanal trennen',
    description: 'Beim Jail wird das Mitglied aus einem laufenden Sprachkanal entfernt.',
    group: 'Verhalten',
  },
  {
    key: 'reapplyOnRejoin',
    type: 'boolean',
    label: 'Jail beim Wiedereintritt erneut anwenden',
    description:
      'Verlässt jemand den Server während eines Jails, wird die Strafe beim erneuten Beitritt automatisch wieder gesetzt.',
    group: 'Verhalten',
  },
  {
    key: 'silentByDefault',
    type: 'boolean',
    label: 'Neue Jails standardmässig still',
    description: 'Die öffentliche Ankündigung ist dann im Formular vorab abgewählt.',
    group: 'Verhalten',
  },

  // --- Öffentliche Texte ---------------------------------------------------
  {
    key: 'announcePublicly',
    type: 'boolean',
    label: 'Öffentliche Ankündigung senden',
    group: 'Öffentliche Nachrichten',
  },
  {
    key: 'pingOnJail',
    type: 'boolean',
    label: 'Mitglied im Jail-Ping-Channel erwähnen',
    group: 'Öffentliche Nachrichten',
  },
  {
    key: 'publicJailTemplate',
    type: 'textarea',
    label: 'Ankündigung: Jail auf Zeit',
    description: PLACEHOLDER_HELP,
    group: 'Öffentliche Nachrichten',
    maxLength: 1000,
  },
  {
    key: 'publicPermanentJailTemplate',
    type: 'textarea',
    label: 'Ankündigung: permanenter Jail',
    description: 'Wie oben, aber ohne Enddatum. Dieselben Platzhalter.',
    group: 'Öffentliche Nachrichten',
    maxLength: 1000,
  },
  {
    key: 'publicReleaseTemplate',
    type: 'textarea',
    label: 'Ankündigung: Freilassung',
    description: 'Dieselben Platzhalter. {end_time} ist hier ohne Bedeutung.',
    group: 'Öffentliche Nachrichten',
    maxLength: 1000,
  },
  {
    key: 'jailPingTemplate',
    type: 'textarea',
    label: 'Ping an das gejailte Mitglied',
    description: 'Dieselben Platzhalter.',
    group: 'Öffentliche Nachrichten',
    maxLength: 1000,
  },
  {
    key: 'voteJailPingTemplate',
    type: 'textarea',
    label: 'Ping nach einer Abstimmung',
    description: 'Wird anstelle des normalen Pings verwendet, wenn der Jail aus einer Abstimmung stammt.',
    group: 'Öffentliche Nachrichten',
    maxLength: 1000,
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

  if (settings.announcePublicly && !settings.announcementChannelId) {
    checks.push({
      label: 'Ankündigungs-Channel',
      status: 'warning',
      detail: 'Die öffentliche Ankündigung ist aktiv, es ist aber kein Channel gewählt.',
      fixHref: settingsHref,
    });
  }

  if (settings.pingOnJail && !settings.jailPingChannelId) {
    checks.push({
      label: 'Jail-Ping-Channel',
      status: 'warning',
      detail: 'Der Ping ist aktiv, es ist aber kein Channel gewählt.',
      fixHref: settingsHref,
    });
  }

  if (settings.keepBoosterRole && !settings.boosterRoleId) {
    checks.push({
      label: 'Booster-Rolle',
      status: 'warning',
      detail: 'Booster-Rollen sollen erhalten bleiben, es ist aber keine Rolle gewählt.',
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

  // --- Vote Jail ----------------------------------------------------------
  if (settings.voteJailEnabled) {
    const channel = settings.voteJailChannelId
      ? context.channels.find((entry) => entry.id === settings.voteJailChannelId)
      : undefined;

    if (!settings.voteJailChannelId) {
      checks.push({
        label: 'Vote Jail Channel',
        status: 'error',
        detail: 'Vote Jail ist aktiv, aber es ist kein Channel gewählt.',
        fixHref: settingsHref,
      });
    } else if (!channel || channel.deleted) {
      checks.push({
        label: 'Vote Jail Channel',
        status: 'error',
        detail: 'Der gewählte Vote-Jail-Channel existiert auf Discord nicht mehr.',
        fixHref: settingsHref,
      });
    } else {
      // Ohne Schreib-, Embed- und Button-Rechte bleibt die Abstimmung unsichtbar.
      const { discord, DISCORD_PERMISSIONS, missingPermissions } = await import('@swisshub/discord');
      const permissions = await discord.channels.botPermissions(settings.voteJailChannelId).catch(() => null);

      if (permissions === null) {
        checks.push({
          label: 'Vote Jail Channel',
          status: 'warning',
          detail: `#${channel.name} - die Berechtigungen des Bots konnten nicht geprüft werden.`,
        });
      } else {
        const missing = missingPermissions(permissions, ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS']);
        void DISCORD_PERMISSIONS;
        checks.push(
          missing.length === 0
            ? { label: 'Vote Jail Channel', status: 'ok', detail: `#${channel.name}` }
            : {
                label: 'Vote Jail Channel',
                status: 'error',
                detail: `Dem Bot fehlen in #${channel.name}: ${missing.join(', ')}.`,
                fixHref: '/system/bot',
              },
        );
      }
    }
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
  configVersion: 3,
  requiredDiscordPermissions: [
    'MANAGE_ROLES',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'VIEW_CHANNEL',
    'USE_APPLICATION_COMMANDS',
  ],
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
    {
      key: JAIL_PERMISSIONS.voteStart,
      label: 'Vote Jail starten',
      description: 'Eine Community-Abstimmung über einen Jail starten.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
    {
      key: JAIL_PERMISSIONS.voteMultivote,
      label: 'Vote Jail: Mehrfachstimme',
      description: 'Darf in einer Abstimmung mehrfach stimmen (für Administratoren).',
      module: JAIL_MODULE_ID,
      critical: true,
    },
    {
      key: JAIL_PERMISSIONS.voteBypassCooldown,
      label: 'Vote Jail: Sperrfrist umgehen',
      description: 'Darf eine neue Abstimmung starten, ohne die Sperrfrist abzuwarten.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
    {
      key: JAIL_PERMISSIONS.import,
      label: 'Alte Jail-Datenbank importieren',
      description: 'Darf die SQLite-Datei des früheren Jail-Bots hochladen und übernehmen.',
      module: JAIL_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    // Ein Eintrag fuer das ganze Modul. Vote Jails und der Import standen
    // frueher als eigene Eintraege daneben - drei Zeilen fuer einen Bereich,
    // und die beiden hinteren nur fuer wenige sichtbar. Sie sind jetzt
    // Bereiche innerhalb des Jail-Moduls.
    {
      href: '/jail',
      label: 'Jail',
      description: 'Jail-Strafen, Community-Abstimmungen und Import',
      permission: JAIL_PERMISSIONS.view,
      // Wer abstimmen lassen darf, kommt ebenfalls hinein - er sieht dort
      // die Abstimmungen, nicht die Strafakte.
      // Wer die Uebersicht nicht sehen darf, aber Abstimmungen starten oder
      // importieren: der bekommt den Eintrag, der zu seinem Recht passt -
      // statt «Jail» und dahinter eine 403-Seite.
      alternatives: [
        {
          permission: JAIL_PERMISSIONS.voteStart,
          href: '/jail/votes',
          label: 'Vote Jail',
          description: 'Community-Abstimmungen starten und mitstimmen',
          icon: 'Gavel',
        },
        {
          permission: JAIL_PERMISSIONS.import,
          href: '/jail/import',
          label: 'Jail-Import',
          description: 'Bestand aus dem alten Bot übernehmen',
        },
      ],
      icon: 'Lock',
      group: 'moderation',
      order: 30,
      counter: 'activeJails',
    },
  ],
});
