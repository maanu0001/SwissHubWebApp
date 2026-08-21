import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const COMMUNICATION_MODULE_ID = 'communication';

/** Berechtigungen des Kommunikationsmoduls. */
export const COMMUNICATION_PERMISSIONS = {
  view: 'communication.view',
  send: 'communication.send',
  news: 'communication.news',
  event: 'communication.event',
  poll: 'communication.poll',
  history: 'communication.history',
  manage: 'communication.manage',
  /** Erlaubt @everyone/@here und Rollen-Pings. Bewusst getrennt vom Senden. */
  mention: 'communication.mention',
  /**
   * @everyone und @here im Besonderen.
   *
   * Getrennt von `mention`: eine Rolle anzupingen betrifft eine Gruppe, den
   * ganzen Server anzupingen betrifft alle - das soll nicht dieselbe
   * Berechtigung sein.
   */
  mentionEveryone: 'communication.mentionEveryone',
  /** Entwürfe anlegen und bearbeiten. */
  draft: 'communication.draft',
  /** Einstellungen des Moduls ändern. */
  settingsManage: 'communication.settings.manage',
} as const;

/**
 * Eine Adresse, die im Browser geladen werden darf.
 *
 * Nur `https`. `javascript:`, `data:` und `file:` sind ausgeschlossen - sonst
 * liesse sich über ein Banner Code einschleusen oder eine lokale Datei
 * einbinden.
 */
const bannerUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .default('')
  .refine(
    (value) => value === '' || /^https:\/\/[^\s]+$/iu.test(value),
    'Bitte eine vollständige https-Adresse angeben.',
  );

export const communicationSettingsSchema = z.object({
  /** Vorausgewählter Channel im Formular. */
  defaultChannelId: optionalSnowflakeSchema,
  /** Je Nachrichtenart ein eigener Vorschlag - leer heisst "Standard-Channel". */
  defaultNewsChannelId: optionalSnowflakeSchema,
  defaultEventChannelId: optionalSnowflakeSchema,
  defaultPollChannelId: optionalSnowflakeSchema,
  /**
   * Channel für die Anmeldung per Ticket.
   *
   * Ersetzt die im alten Bot fest eingetragene Channel-ID. Wer beim Event
   * "Anmeldung via Ticket" wählt, verweist auf diesen Channel.
   */
  ticketChannelId: optionalSnowflakeSchema,
  /** Fusszeile der Embeds. */
  footerText: z.string().max(120).default('SwissHub • Zäme hock, zäme zocke'),
  /**
   * Standardbanner je Nachrichtenart.
   *
   * Ersetzt den im alten Bot fest eingetragenen Imgur-Link. Ohne Eintrag
   * erscheint das Embed ohne Bild.
   */
  defaultNewsBannerUrl: bannerUrlSchema,
  defaultEventBannerUrl: bannerUrlSchema,
  defaultPollBannerUrl: bannerUrlSchema,
  /** Reaktionen für Umfragen automatisch setzen. */
  autoPollReactions: z.boolean().default(true),
  /** @everyone/@here überhaupt zulassen (zusätzlich zur Berechtigung). */
  allowEveryoneMention: z.boolean().default(false),
});

export type CommunicationSettings = z.infer<typeof communicationSettingsSchema>;

export const communicationSettingsFields: SettingsField[] = [
  {
    key: 'defaultChannelId',
    type: 'discord-channel',
    label: 'Standard-Channel',
    description: 'Im Formular vorausgewählt. Lässt sich pro Nachricht überschreiben.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'defaultNewsChannelId',
    type: 'discord-channel',
    label: 'Channel für Neuigkeiten',
    description: 'Leer lassen, um den Standard-Channel zu verwenden.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'defaultEventChannelId',
    type: 'discord-channel',
    label: 'Channel für Events',
    description: 'Leer lassen, um den Standard-Channel zu verwenden.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'defaultPollChannelId',
    type: 'discord-channel',
    label: 'Channel für Umfragen',
    description: 'Leer lassen, um den Standard-Channel zu verwenden.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'ticketChannelId',
    type: 'discord-channel',
    label: 'Ticket-Channel',
    description:
      'Wird verwendet, wenn bei einem Event "Anmeldung via Ticket" gewählt ist. Ersetzt die früher fest im Bot eingetragene Channel-ID.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'defaultEventBannerUrl',
    type: 'text',
    label: 'Standard-Banner für Events',
    description:
      'https-Adresse. Wird verwendet, wenn beim Event kein eigenes Banner angegeben ist. Leer lassen für kein Banner.',
    group: 'Darstellung',
    maxLength: 1000,
  },
  {
    key: 'defaultNewsBannerUrl',
    type: 'text',
    label: 'Standard-Banner für Neuigkeiten',
    description: 'https-Adresse. Leer lassen für kein Banner.',
    group: 'Darstellung',
    maxLength: 1000,
  },
  {
    key: 'defaultPollBannerUrl',
    type: 'text',
    label: 'Standard-Banner für Umfragen',
    description: 'https-Adresse. Leer lassen für kein Banner.',
    group: 'Darstellung',
    maxLength: 1000,
  },
  {
    key: 'footerText',
    type: 'text',
    label: 'Fusszeile',
    description: 'Erscheint unten in jedem Embed.',
    group: 'Darstellung',
    maxLength: 120,
  },
  {
    key: 'autoPollReactions',
    type: 'boolean',
    label: 'Umfragen automatisch mit 👍 / 👎 versehen',
    group: 'Verhalten',
  },
  {
    key: 'allowEveryoneMention',
    type: 'boolean',
    label: '@everyone und @here zulassen',
    description:
      'Zusätzlich zur Berechtigung "Erwähnungen senden". Ohne diesen Schalter pingt keine Nachricht den ganzen Server.',
    group: 'Verhalten',
  },
];

/**
 * Gesundheitsprüfung.
 *
 * Geprüft wird, was das Modul tatsächlich braucht: einen erreichbaren Channel
 * und die passenden Discord-Rechte des Bots darin.
 */
async function communicationHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<CommunicationSettings>(COMMUNICATION_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const settingsHref = `/modules/${COMMUNICATION_MODULE_ID}`;

  // `text` umfasst auch Ankündigungs-Channels (siehe `channelKind`).
  const textChannels = context.channels.filter((channel) => !channel.deleted && channel.kind === 'text');
  if (textChannels.length === 0) {
    checks.push({
      label: 'Channels',
      status: 'warning',
      detail: 'Es sind keine Textchannels synchronisiert.',
      fixHref: '/system/discord',
    });
    return checks;
  }

  if (!settings.defaultChannelId) {
    checks.push({
      label: 'Standard-Channel',
      status: 'warning',
      detail: 'Kein Standard-Channel gewählt - er muss dann bei jeder Nachricht ausgewählt werden.',
      fixHref: settingsHref,
    });
    return checks;
  }

  const channel = context.channels.find((entry) => entry.id === settings.defaultChannelId);
  if (!channel || channel.deleted) {
    checks.push({
      label: 'Standard-Channel',
      status: 'error',
      detail: 'Der gewählte Channel existiert auf Discord nicht mehr.',
      fixHref: settingsHref,
    });
    return checks;
  }

  const { discord, missingPermissions } = await import('@swisshub/discord');
  const permissions = await discord.channels.botPermissions(channel.id).catch(() => null);
  if (permissions === null) {
    checks.push({
      label: 'Standard-Channel',
      status: 'warning',
      detail: `#${channel.name} - die Berechtigungen des Bots konnten nicht geprüft werden.`,
    });
    return checks;
  }

  // Reaktionen nur prüfen, wenn Umfragen sie auch setzen sollen.
  const required = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'READ_MESSAGE_HISTORY'] as const;
  const missing = missingPermissions(permissions, [
    ...required,
    ...(settings.autoPollReactions ? (['ADD_REACTIONS'] as const) : []),
  ]);

  checks.push(
    missing.length === 0
      ? { label: 'Standard-Channel', status: 'ok', detail: `#${channel.name}` }
      : {
          label: 'Standard-Channel',
          status: 'error',
          detail: `Dem Bot fehlen in #${channel.name}: ${missing.join(', ')}.`,
          fixHref: '/system/bot',
        },
  );

  return checks;
}

export const communicationModule: ModuleDefinition = registerModule({
  id: COMMUNICATION_MODULE_ID,
  name: 'Kommunikation',
  description:
    'Neuigkeiten, Events und Umfragen als professionelle Discord-Embeds im Namen des SwissHub Bots senden.',
  icon: 'Megaphone',
  tagline: 'Embeds, Events und Umfragen',
  permissionPrefix: 'communication',
  defaultEnabled: true,
  settingsSchema: communicationSettingsSchema,
  settingsFields: communicationSettingsFields,
  configVersion: 1,
  requiredDiscordPermissions: [
    'VIEW_CHANNEL',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'ADD_REACTIONS',
    'READ_MESSAGE_HISTORY',
  ],
  healthChecks: communicationHealthChecks,
  permissions: [
    {
      key: COMMUNICATION_PERMISSIONS.view,
      label: 'Kommunikation ansehen',
      description: 'Bereich öffnen und den Verlauf einsehen.',
      module: COMMUNICATION_MODULE_ID,
    },
    {
      key: COMMUNICATION_PERMISSIONS.send,
      label: 'Nachrichten senden',
      description: 'Grundberechtigung zum Senden. Führt eine echte Discord-Aktion aus.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.news,
      label: 'Neuigkeiten senden',
      description: 'Neuigkeiten als Embed veröffentlichen.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.event,
      label: 'Events senden',
      description: 'Events mit Datum und verantwortlicher Person ankündigen.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.poll,
      label: 'Umfragen senden',
      description: 'Umfragen mit 👍/👎 veröffentlichen.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.history,
      label: 'Verlauf ansehen',
      description: 'Bereits gesendete Nachrichten einsehen.',
      module: COMMUNICATION_MODULE_ID,
    },
    {
      key: COMMUNICATION_PERMISSIONS.mention,
      label: 'Erwähnungen senden',
      description: '@everyone, @here und Rollen anpingen.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.mentionEveryone,
      label: '@everyone und @here anpingen',
      description:
        'Den ganzen Server benachrichtigen. Bewusst getrennt von "Erwähnungen senden" - eine Rolle betrifft eine Gruppe, @everyone betrifft alle.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.draft,
      label: 'Entwürfe bearbeiten',
      description: 'Nachrichten vorbereiten, ohne sie zu senden.',
      module: COMMUNICATION_MODULE_ID,
    },
    {
      key: COMMUNICATION_PERMISSIONS.settingsManage,
      label: 'Einstellungen ändern',
      description: 'Standard-Channels, Ticket-Channel, Banner und Fusszeile ändern.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
    {
      key: COMMUNICATION_PERMISSIONS.manage,
      label: 'Kommunikation verwalten',
      description: 'Einstellungen ändern und gesendete Nachrichten auf Discord löschen.',
      module: COMMUNICATION_MODULE_ID,
      critical: true,
    },
  ],
  // Ein Eintrag pro Modul. Der Verlauf ist eine Unterseite und wird innerhalb
  // des Moduls über die Bereichsnavigation erreicht - die Seitenleiste bleibt
  // dadurch übersichtlich.
  navigation: [
    {
      href: '/communication',
      label: 'Kommunikation',
      description: 'Neuigkeiten, Events und Umfragen als Discord-Embed senden',
      permission: COMMUNICATION_PERMISSIONS.view,
      icon: 'Megaphone',
      group: 'modules',
      order: 45,
    },
  ],
});
