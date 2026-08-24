import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const TICKETS_MODULE_ID = 'tickets';

/**
 * Berechtigungen des Ticket-Moduls.
 *
 * Sie reihen sich in das bestehende Rechtesystem ein. Zusaetzlich wirkt eine
 * zweite Ebene, die es sonst nirgends gibt: die Kategorie-Zustaendigkeit.
 * Wer `support.view` hat, sieht damit nicht automatisch jedes Ticket -
 * sondern nur die Kategorien, fuer deren Support-Rollen er zustaendig ist.
 * Beides zusammen entscheidet `TicketAccess`.
 */
export const TICKET_PERMISSIONS = {
  view: 'tickets.view',
  viewOwn: 'tickets.viewOwn',
  create: 'tickets.create',

  supportView: 'tickets.support.view',
  supportReply: 'tickets.support.reply',
  supportClaim: 'tickets.support.claim',
  supportAssign: 'tickets.support.assign',
  supportChangeStatus: 'tickets.support.changeStatus',
  supportChangePriority: 'tickets.support.changePriority',
  supportManageTags: 'tickets.support.manageTags',
  supportAddUser: 'tickets.support.addUser',
  supportRemoveUser: 'tickets.support.removeUser',
  supportClose: 'tickets.support.close',
  supportReopen: 'tickets.support.reopen',

  notesView: 'tickets.notes.view',
  notesCreate: 'tickets.notes.create',

  archiveView: 'tickets.archive.view',
  transcriptView: 'tickets.transcript.view',

  categoriesManage: 'tickets.categories.manage',
  panelsManage: 'tickets.panels.manage',
  templatesManage: 'tickets.templates.manage',
  settingsManage: 'tickets.settings.manage',
  blockManage: 'tickets.block.manage',
  statsView: 'tickets.stats.view',

  createForUser: 'tickets.admin.createForUser',
  admin: 'tickets.admin',
} as const;

export const ticketSettingsSchema = z.object({
  /** Discord-Kategorie, wenn eine Ticket-Kategorie keine eigene hat. */
  defaultDiscordCategoryId: z.string().nullable().default(null),
  /** Ausweichkategorie, wenn die erste voll ist. Discord erlaubt 50 Kanaele. */
  overflowDiscordCategoryId: z.string().nullable().default(null),
  /** Rollen, die ohne eigene Kategorie-Zuordnung Zugriff bekommen. */
  defaultSupportRoleIds: z.array(z.string()).default([]),

  maxOpenPerUser: z.number().int().min(1).max(50).default(3),

  ticketNumberPrefix: z.string().max(8).default('#'),
  channelNameTemplate: z.string().min(1).max(64).default('ticket-{number}-{username}'),

  closeBehaviour: z
    .enum(['DELETE_IMMEDIATELY', 'KEEP_24H', 'KEEP_7D', 'KEEP_FOREVER'])
    .default('KEEP_24H'),

  /**
   * Warte-Status automatisch setzen?
   *
   * Support schreibt -> wartet auf Benutzer, Benutzer schreibt -> wartet auf
   * Support. Bequem, aber nicht fuer jedes Team richtig - deshalb abschaltbar.
   */
  autoWaitingStatus: z.boolean().default(true),

  /** Systemmeldungen im Discord-Kanal anzeigen (uebernommen, Status, ...). */
  systemMessagesOnDiscord: z.boolean().default(true),

  feedbackEnabled: z.boolean().default(false),

  /** Keine neuen Tickets, bestehende weiter bearbeitbar. */
  maintenanceMode: z.boolean().default(false),

  /** Aufbewahrung in Tagen; 0 = unbegrenzt. Nichts wird ohne Wert geloescht. */
  transcriptRetentionDays: z.number().int().min(0).max(3650).default(0),
});

export type TicketSettings = z.infer<typeof ticketSettingsSchema>;

const ticketSettingsFields: SettingsField[] = [
  {
    key: 'defaultDiscordCategoryId',
    type: 'discord-channel',
    label: 'Discord-Kategorie',
    description: 'Hier entstehen die Ticket-Kanäle, wenn eine Kategorie keine eigene hat.',
    group: 'Discord',
    channelKinds: ['category'],
  },
  {
    key: 'overflowDiscordCategoryId',
    type: 'discord-channel',
    label: 'Ausweich-Kategorie',
    description: 'Wird verwendet, sobald die erste voll ist. Discord erlaubt 50 Kanäle je Kategorie.',
    group: 'Discord',
    channelKinds: ['category'],
  },
  {
    key: 'defaultSupportRoleIds',
    type: 'discord-role-list',
    label: 'Standard-Support-Rollen',
    description: 'Erhalten Zugriff auf Tickets von Kategorien ohne eigene Rollen.',
    group: 'Discord',
  },
  {
    key: 'maxOpenPerUser',
    type: 'number',
    label: 'Offene Tickets je Mitglied',
    description: 'Eine Kategorie kann eine eigene, strengere Grenze setzen.',
    group: 'Verhalten',
    min: 1,
    max: 50,
  },
  {
    key: 'channelNameTemplate',
    type: 'text',
    label: 'Vorlage des Kanalnamens',
    description: 'Platzhalter: {number}, {username}, {category}.',
    group: 'Verhalten',
    maxLength: 64,
  },
  {
    key: 'ticketNumberPrefix',
    type: 'text',
    label: 'Präfix der Ticketnummer',
    description: 'Steht vor der Nummer, zum Beispiel # oder SH-.',
    group: 'Verhalten',
    maxLength: 8,
  },
  {
    key: 'autoWaitingStatus',
    type: 'boolean',
    label: 'Warte-Status automatisch setzen',
    description: 'Support antwortet → wartet auf Mitglied. Mitglied antwortet → wartet auf Support.',
    group: 'Verhalten',
  },
  {
    key: 'systemMessagesOnDiscord',
    type: 'boolean',
    label: 'Systemmeldungen auf Discord anzeigen',
    description: 'Übernommen, Status geändert, geschlossen. Aus, wenn es zu viel wird.',
    group: 'Verhalten',
  },
  {
    key: 'feedbackEnabled',
    type: 'boolean',
    label: 'Rückmeldung nach dem Schliessen',
    description: 'Fragt das Mitglied nach einer Bewertung von 1 bis 5.',
    group: 'Verhalten',
  },
  {
    key: 'maintenanceMode',
    type: 'boolean',
    label: 'Keine neuen Tickets annehmen',
    description: 'Bestehende Tickets bleiben bearbeitbar.',
    group: 'Betrieb',
  },
  {
    key: 'transcriptRetentionDays',
    type: 'number',
    label: 'Transcripts aufbewahren (Tage)',
    description: '0 bedeutet unbegrenzt. Ohne ausdrücklichen Wert wird nichts gelöscht.',
    group: 'Betrieb',
    min: 0,
    max: 3650,
  },
];

/** Was ein Ticket-Kanal an Rechten braucht, damit der Bot ihn führen kann. */
export const BOT_CHANNEL_PERMISSIONS = [
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'READ_MESSAGE_HISTORY',
  'MANAGE_MESSAGES',
  'MANAGE_CHANNELS',
] as const;

async function ticketHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const { prisma } = await import('@swisshub/database');
  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);

  // Discord-Kategorie.
  if (!settings.defaultDiscordCategoryId) {
    checks.push({
      label: 'Discord-Kategorie',
      status: 'error',
      detail: 'Nicht gesetzt - ohne sie kann kein Ticket-Kanal entstehen.',
      fixHref: `/modules/${TICKETS_MODULE_ID}`,
    });
  } else {
    const kategorie = context.channels.find(
      (eintrag) => eintrag.id === settings.defaultDiscordCategoryId,
    );
    checks.push(
      kategorie
        ? { label: 'Discord-Kategorie', status: 'ok', detail: kategorie.name }
        : {
            label: 'Discord-Kategorie',
            status: 'error',
            detail: 'Die gewählte Kategorie existiert auf Discord nicht mehr.',
          },
    );
  }

  // Ticket-Kategorien.
  const kategorien = await prisma.ticketCategory.count({ where: { active: true } });
  checks.push({
    label: 'Ticket-Kategorien',
    status: kategorien === 0 ? 'error' : 'ok',
    detail:
      kategorien === 0
        ? 'Keine aktive Kategorie - ohne sie lässt sich kein Ticket eröffnen.'
        : `${kategorien} aktiv`,
    fixHref: kategorien === 0 ? '/tickets/kategorien' : undefined,
  });

  // Panels.
  const panels = await prisma.ticketPanel.findMany({ where: { active: true } });
  const fehlend = panels.filter((panel) => panel.discordMessageId === null);
  checks.push({
    label: 'Ticket-Panels',
    status: panels.length === 0 ? 'warning' : fehlend.length > 0 ? 'warning' : 'ok',
    detail:
      panels.length === 0
        ? 'Kein Panel veröffentlicht - Mitglieder können nur über die WebApp eröffnen.'
        : fehlend.length > 0
          ? `${fehlend.length} von ${panels.length} nicht veröffentlicht`
          : `${panels.length} veröffentlicht`,
    fixHref: panels.length === 0 ? '/tickets/panels' : undefined,
  });

  // Support-Rollen.
  const mitRollen = await prisma.ticketCategory.count({
    where: { active: true, NOT: { supportRoleIds: { isEmpty: true } } },
  });
  if (kategorien > 0 && mitRollen === 0 && settings.defaultSupportRoleIds.length === 0) {
    checks.push({
      label: 'Support-Rollen',
      status: 'error',
      detail: 'Keine Rolle zugeordnet - niemand könnte Tickets bearbeiten.',
      fixHref: `/modules/${TICKETS_MODULE_ID}`,
    });
  } else {
    checks.push({ label: 'Support-Rollen', status: 'ok', detail: 'Zugeordnet' });
  }

  // Nachrichten aus den Ticket-Kanaelen.
  const { discord } = await import('@swisshub/discord');
  const inhalte = await discord.bot.messageContentAllowed().catch(() => null);
  checks.push(
    inhalte === null
      ? {
          label: 'Nachrichten aus Discord',
          status: 'warning',
          detail: 'Discord war nicht erreichbar - der Zustand ist unbekannt.',
        }
      : inhalte
        ? { label: 'Nachrichten aus Discord', status: 'ok', detail: 'Werden in den Verlauf übernommen' }
        : {
            label: 'Nachrichten aus Discord',
            status: 'warning',
            detail:
              'Das Intent «Message Content» ist nicht freigeschaltet. Antworten aus dem Ticket-Kanal erscheinen weder im Dashboard noch im Transcript. Im Discord Developer Portal unter Bot → Privileged Gateway Intents aktivieren und den Bot neu starten.',
          },
  );

  if (settings.maintenanceMode) {
    checks.push({
      label: 'Betrieb',
      status: 'warning',
      detail: 'Wartungsmodus aktiv - es werden keine neuen Tickets angenommen.',
    });
  }

  return checks;
}

export const ticketsModule: ModuleDefinition = registerModule({
  id: TICKETS_MODULE_ID,
  name: 'Tickets',
  description:
    'Support-Center für SwissHub: Ticket-Panels auf Discord, eigene Kanäle je Anliegen, und die vollständige Bearbeitung im Dashboard.',
  icon: 'Ticket',
  tagline: 'Support-Center',
  permissionPrefix: 'tickets',
  // Bewusst aus: das Modul legt Discord-Kanäle an. Eingeschaltet wird, wenn
  // Kategorie und Support-Rollen stehen.
  defaultEnabled: false,
  settingsSchema: ticketSettingsSchema,
  settingsFields: ticketSettingsFields,
  configVersion: 1,
  requiredDiscordPermissions: [
    'MANAGE_CHANNELS',
    'VIEW_CHANNEL',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'ATTACH_FILES',
    'READ_MESSAGE_HISTORY',
    'MANAGE_MESSAGES',
  ],
  healthChecks: ticketHealthChecks,
  permissions: [
    { key: TICKET_PERMISSIONS.viewOwn, label: 'Eigene Tickets ansehen', description: 'Die selbst eröffneten Tickets einsehen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.create, label: 'Ticket eröffnen', description: 'Ein neues Ticket erstellen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.view, label: 'Ticket-Bereich ansehen', description: 'Den Ticket-Bereich im Dashboard öffnen.', module: TICKETS_MODULE_ID },

    { key: TICKET_PERMISSIONS.supportView, label: 'Tickets bearbeiten (ansehen)', description: 'Tickets der eigenen zuständigen Kategorien einsehen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportReply, label: 'Auf Tickets antworten', description: 'Als Bot in den Ticket-Kanal schreiben.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportClaim, label: 'Tickets übernehmen', description: 'Ein unzugewiesenes Ticket selbst übernehmen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportAssign, label: 'Tickets zuweisen', description: 'Ein Ticket einer anderen Person zuweisen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportChangeStatus, label: 'Status ändern', description: 'Den Bearbeitungsstand setzen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportChangePriority, label: 'Priorität ändern', description: 'Die Dringlichkeit setzen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportManageTags, label: 'Schlagwörter setzen', description: 'Tickets mit Schlagwörtern versehen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportAddUser, label: 'Teilnehmer hinzufügen', description: 'Weitere Mitglieder in ein Ticket holen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportRemoveUser, label: 'Teilnehmer entfernen', description: 'Hinzugefügte Mitglieder wieder entfernen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportClose, label: 'Tickets schliessen', description: 'Ein Ticket abschliessen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.supportReopen, label: 'Tickets wieder öffnen', description: 'Ein geschlossenes Ticket erneut öffnen.', module: TICKETS_MODULE_ID },

    { key: TICKET_PERMISSIONS.notesView, label: 'Interne Notizen lesen', description: 'Notizen sehen, die nie auf Discord erscheinen.', module: TICKETS_MODULE_ID, critical: true },
    { key: TICKET_PERMISSIONS.notesCreate, label: 'Interne Notizen schreiben', description: 'Notizen für das Team hinterlegen.', module: TICKETS_MODULE_ID },

    { key: TICKET_PERMISSIONS.archiveView, label: 'Archiv ansehen', description: 'Geschlossene Tickets durchsuchen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.transcriptView, label: 'Transcripts herunterladen', description: 'Gesprächsverläufe abrufen.', module: TICKETS_MODULE_ID, critical: true },

    { key: TICKET_PERMISSIONS.categoriesManage, label: 'Kategorien verwalten', description: 'Ticket-Kategorien und ihre Formulare pflegen.', module: TICKETS_MODULE_ID, critical: true },
    { key: TICKET_PERMISSIONS.panelsManage, label: 'Panels verwalten', description: 'Ticket-Panels erstellen und veröffentlichen.', module: TICKETS_MODULE_ID, critical: true },
    { key: TICKET_PERMISSIONS.templatesManage, label: 'Antwortvorlagen verwalten', description: 'Vorlagen für wiederkehrende Antworten pflegen.', module: TICKETS_MODULE_ID },
    { key: TICKET_PERMISSIONS.settingsManage, label: 'Ticket-Einstellungen ändern', description: 'Kategorien, Grenzen und Verhalten festlegen.', module: TICKETS_MODULE_ID, critical: true },
    { key: TICKET_PERMISSIONS.blockManage, label: 'Sperren verwalten', description: 'Mitglieder vom Ticketsystem ausschliessen.', module: TICKETS_MODULE_ID, critical: true },
    { key: TICKET_PERMISSIONS.statsView, label: 'Statistiken ansehen', description: 'Kennzahlen zum Support einsehen.', module: TICKETS_MODULE_ID },

    { key: TICKET_PERMISSIONS.createForUser, label: 'Ticket für andere eröffnen', description: 'Im Namen eines Mitglieds ein Ticket anlegen.', module: TICKETS_MODULE_ID, critical: true },
    { key: TICKET_PERMISSIONS.admin, label: 'Tickets vollständig verwalten', description: 'Alle Tickets sehen und bearbeiten, unabhängig von der Kategorie.', module: TICKETS_MODULE_ID, critical: true },
  ],
  navigation: [
    {
      href: '/tickets',
      label: 'Tickets',
      icon: 'Ticket',
      permission: TICKET_PERMISSIONS.viewOwn,
      description: 'Support-Anfragen eröffnen, bearbeiten und nachschlagen.',
      group: 'moderation',
      order: 30,
    },
  ],
});
