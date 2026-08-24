import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const TOURNAMENTS_MODULE_ID = 'tournaments';

/** SwissHub-Rot, wie im Kommunikationsmodul. */
export const ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen des Turniermoduls.
 *
 * Sie reihen sich in das bestehende Rechtesystem ein. Zusaetzlich wirkt eine
 * zweite Ebene, die es sonst nur beim Ticketmodul gibt: die Zustaendigkeit
 * fuer ein bestimmtes Turnier. Wer `tournaments.manage` traegt, verwaltet
 * damit nicht jedes Turnier - sondern die, bei denen er als Staff eingetragen
 * ist. Wer beides braucht, bekommt `tournaments.admin`.
 *
 * Ohne die zweite Ebene waere jede Turnierrolle faktisch eine
 * Vollberechtigung, und ein Gastorganisator koennte in fremden Turnieren
 * Resultate aendern.
 */
export const TOURNAMENT_PERMISSIONS = {
  view: 'tournaments.view',
  /** Sich selbst anmelden, Team gruenden, einchecken. */
  participate: 'tournaments.participate',

  create: 'tournaments.create',
  manage: 'tournaments.manage',
  publish: 'tournaments.publish',

  registrationsView: 'tournaments.registrations.view',
  registrationsManage: 'tournaments.registrations.manage',
  teamsManage: 'tournaments.teams.manage',
  checkinManage: 'tournaments.checkin.manage',

  bracketManage: 'tournaments.bracket.manage',
  matchesManage: 'tournaments.matches.manage',
  resultsOverride: 'tournaments.results.override',
  disputesManage: 'tournaments.disputes.manage',

  streamManage: 'tournaments.stream.manage',
  prizesManage: 'tournaments.prizes.manage',

  staffManage: 'tournaments.staff.manage',
  blockManage: 'tournaments.block.manage',

  statsView: 'tournaments.stats.view',
  archiveView: 'tournaments.archive.view',

  /** Alle Turniere, unabhaengig von der Zustaendigkeit. */
  admin: 'tournaments.admin',
} as const;

export const tournamentSettingsSchema = z.object({
  /** Wohin Ankuendigungen gehen, wenn ein Turnier nichts eigenes setzt. */
  defaultAnnouncementChannelId: z.string().nullable().default(null),
  /** Kategorie, in der Match-Kanaele entstehen. */
  defaultMatchCategoryId: z.string().nullable().default(null),
  /** Kategorie fuer die Kanaele der Turnierleitung. */
  defaultStaffCategoryId: z.string().nullable().default(null),
  defaultStreamChannelId: z.string().nullable().default(null),

  /** Rollen, die ohne eigene Zuordnung Turniere betreuen duerfen. */
  defaultStaffRoleIds: z.array(z.string()).default([]),
  /** Rollen, die bei Ankuendigungen erwaehnt werden duerfen. */
  defaultPingRoleIds: z.array(z.string()).default([]),

  /** Match-Kanaele ueberhaupt anlegen? */
  createMatchChannels: z.boolean().default(true),
  /**
   * Wie lange ein Match-Kanal nach dem Match bleibt.
   *
   * 0 bedeutet: bis zum Turnierende. Sofort zu loeschen nimmt beiden Teams
   * die Moeglichkeit, das Gespraech nochmals zu lesen - und der Verwaltung
   * die Moeglichkeit, einen Fehlgriff zu bemerken.
   */
  matchChannelRetentionHours: z.number().int().min(0).max(720).default(0),

  /** Erinnerungen ueberhaupt senden? */
  remindersEnabled: z.boolean().default(true),
  /** Stunden vor Anmeldeschluss, zu denen erinnert wird. */
  reminderHoursBeforeRegistrationClose: z.array(z.number().int().min(1).max(168)).default([24, 1]),
  /** Minuten vor Check-in-Ende. */
  reminderMinutesBeforeCheckinClose: z.number().int().min(0).max(240).default(15),
  /** Minuten vor Turnierstart. */
  reminderMinutesBeforeStart: z.number().int().min(0).max(240).default(15),
  /** Minuten vor einem geplanten Match. */
  reminderMinutesBeforeMatch: z.number().int().min(0).max(240).default(10),
  /**
   * Nach wie vielen Minuten ohne Resultat gemahnt wird.
   *
   * Ein Match ohne Resultat blockiert die ganze Runde; ohne diese Frist
   * merkt es die Verwaltung erst, wenn jemand sich beschwert.
   */
  overdueResultMinutes: z.number().int().min(15).max(1440).default(60),

  /** Voreinstellung neuer Turniere: Check-in verlangen. */
  defaultCheckinRequired: z.boolean().default(true),
  defaultMinTeamSize: z.number().int().min(1).max(20).default(5),
  defaultMaxTeamSize: z.number().int().min(1).max(20).default(5),
  defaultMaxSubstitutes: z.number().int().min(0).max(10).default(1),
  defaultBestOf: z.number().int().min(1).max(9).default(1),

  /** Keine neuen Anmeldungen, laufende Turniere bleiben bedienbar. */
  maintenanceMode: z.boolean().default(false),
});

export type TournamentSettings = z.infer<typeof tournamentSettingsSchema>;

const tournamentSettingsFields: SettingsField[] = [
  {
    key: 'defaultAnnouncementChannelId',
    type: 'discord-channel',
    label: 'Ankündigungs-Channel',
    description: 'Wohin Turnier-Ankündigungen gehen, wenn ein Turnier nichts eigenes setzt.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'defaultMatchCategoryId',
    type: 'discord-channel',
    label: 'Kategorie für Match-Channels',
    description: 'Hier entstehen die Kanäle der einzelnen Matches.',
    group: 'Discord',
    channelKinds: ['category'],
  },
  {
    key: 'defaultStaffCategoryId',
    type: 'discord-channel',
    label: 'Kategorie für die Turnierleitung',
    description: 'Für interne Kanäle rund um ein Turnier.',
    group: 'Discord',
    channelKinds: ['category'],
  },
  {
    key: 'defaultStreamChannelId',
    type: 'discord-channel',
    label: 'Stream-Channel',
    description: 'Hier meldet der Bot, wenn ein Stream startet.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'defaultStaffRoleIds',
    type: 'discord-role-list',
    label: 'Standard-Turnierleitung',
    description: 'Diese Rollen betreuen Turniere, für die niemand eigens eingetragen ist.',
    group: 'Discord',
  },
  {
    key: 'defaultPingRoleIds',
    type: 'discord-role-list',
    label: 'Erwähnbare Rollen',
    description: 'Nur diese Rollen dürfen in Turnier-Ankündigungen erwähnt werden.',
    group: 'Discord',
  },
  {
    key: 'createMatchChannels',
    type: 'boolean',
    label: 'Match-Channels anlegen',
    description: 'Je Match ein eigener Kanal für beide Teams und die Leitung.',
    group: 'Matches',
  },
  {
    key: 'matchChannelRetentionHours',
    type: 'number',
    label: 'Match-Channels aufbewahren (Stunden)',
    description: '0 bedeutet: bis zum Turnierende.',
    group: 'Matches',
    min: 0,
    max: 720,
  },
  {
    key: 'defaultBestOf',
    type: 'number',
    label: 'Standard-Format (Best of)',
    description: 'Einzelne Runden dürfen davon abweichen.',
    group: 'Matches',
    min: 1,
    max: 9,
  },
  {
    key: 'overdueResultMinutes',
    type: 'number',
    label: 'Resultat überfällig nach (Minuten)',
    description: 'Danach erscheint das Match in den Warnungen der Leitung.',
    group: 'Matches',
    min: 15,
    max: 1440,
  },
  {
    key: 'remindersEnabled',
    type: 'boolean',
    label: 'Erinnerungen senden',
    description: 'Anmeldeschluss, Check-in, Turnierstart und Matches.',
    group: 'Erinnerungen',
  },
  {
    key: 'reminderMinutesBeforeCheckinClose',
    type: 'number',
    label: 'Vor Check-in-Ende (Minuten)',
    group: 'Erinnerungen',
    min: 0,
    max: 240,
  },
  {
    key: 'reminderMinutesBeforeStart',
    type: 'number',
    label: 'Vor Turnierstart (Minuten)',
    group: 'Erinnerungen',
    min: 0,
    max: 240,
  },
  {
    key: 'reminderMinutesBeforeMatch',
    type: 'number',
    label: 'Vor einem Match (Minuten)',
    group: 'Erinnerungen',
    min: 0,
    max: 240,
  },
  {
    key: 'defaultCheckinRequired',
    type: 'boolean',
    label: 'Check-in verlangen',
    description: 'Voreinstellung für neue Turniere.',
    group: 'Voreinstellungen',
  },
  {
    key: 'defaultMinTeamSize',
    type: 'number',
    label: 'Mindest-Teamgrösse',
    group: 'Voreinstellungen',
    min: 1,
    max: 20,
  },
  {
    key: 'defaultMaxTeamSize',
    type: 'number',
    label: 'Höchst-Teamgrösse',
    group: 'Voreinstellungen',
    min: 1,
    max: 20,
  },
  {
    key: 'defaultMaxSubstitutes',
    type: 'number',
    label: 'Ersatzspieler',
    description: 'Zusätzlich zur Höchst-Teamgrösse.',
    group: 'Voreinstellungen',
    min: 0,
    max: 10,
  },
  {
    key: 'maintenanceMode',
    type: 'boolean',
    label: 'Keine neuen Anmeldungen annehmen',
    description: 'Laufende Turniere bleiben vollständig bedienbar.',
    group: 'Betrieb',
  },
];

async function tournamentHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const { prisma } = await import('@swisshub/database');
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);

  const kanal = (id: string | null): string | null =>
    id ? (context.channels.find((eintrag) => eintrag.id === id)?.name ?? null) : null;

  // Ankuendigungskanal.
  if (!settings.defaultAnnouncementChannelId) {
    checks.push({
      label: 'Ankündigungs-Channel',
      status: 'warning',
      detail: 'Nicht gesetzt - Turniere brauchen dann je einen eigenen.',
      fixHref: `/modules/${TOURNAMENTS_MODULE_ID}`,
    });
  } else {
    const name = kanal(settings.defaultAnnouncementChannelId);
    checks.push(
      name
        ? { label: 'Ankündigungs-Channel', status: 'ok', detail: `#${name}` }
        : {
            label: 'Ankündigungs-Channel',
            status: 'error',
            detail: 'Der gewählte Channel existiert auf Discord nicht mehr.',
          },
    );
  }

  // Darf ueberhaupt jemand teilnehmen?
  //
  // Ohne diese Berechtigung laesst sich ein Turnier anlegen, veroeffentlichen
  // und ankuendigen - nur anmelden kann sich niemand, und der Knopf sagt
  // lediglich, dass eine Berechtigung fehlt. Das faellt sonst erst auf, wenn
  // die ersten Mitglieder nachfragen.
  const { loadRoleConfiguration } = await import('@swisshub/permissions');
  const rollen = await loadRoleConfiguration().catch(() => null);
  const darfTeilnehmen =
    rollen?.mappings.some(
      (zuordnung) => zuordnung.permission === TOURNAMENT_PERMISSIONS.participate,
    ) ?? false;
  checks.push(
    darfTeilnehmen
      ? { label: 'Teilnahme', status: 'ok', detail: 'Mindestens eine Rolle darf teilnehmen.' }
      : {
          label: 'Teilnahme',
          status: 'error',
          detail:
            'Keine Rolle hat «An Turnieren teilnehmen» - niemand kann sich anmelden.',
          fixHref: '/server/permissions',
        },
  );

  // Match-Kategorie.
  if (settings.createMatchChannels) {
    if (!settings.defaultMatchCategoryId) {
      checks.push({
        label: 'Match-Kategorie',
        status: 'error',
        detail: 'Nicht gesetzt - ohne sie kann kein Match-Channel entstehen.',
        fixHref: `/modules/${TOURNAMENTS_MODULE_ID}`,
      });
    } else {
      const name = kanal(settings.defaultMatchCategoryId);
      checks.push(
        name
          ? { label: 'Match-Kategorie', status: 'ok', detail: name }
          : {
              label: 'Match-Kategorie',
              status: 'error',
              detail: 'Die gewählte Kategorie existiert auf Discord nicht mehr.',
            },
      );
    }
  } else {
    checks.push({
      label: 'Match-Channels',
      status: 'ok',
      detail: 'Abgeschaltet - Matches laufen ohne eigene Kanäle.',
    });
  }

  // Laufende Turniere.
  const laufend = await prisma.tournament.count({
    where: { status: { in: ['RUNNING', 'PAUSED', 'CHECKIN_OPEN', 'READY'] } },
  });
  const offeneDisputes = await prisma.tournamentDispute.count({
    where: { status: { in: ['OPEN', 'IN_REVIEW'] } },
  });

  checks.push({
    label: 'Laufende Turniere',
    status: 'ok',
    detail: laufend === 0 ? 'Derzeit keines' : `${laufend} aktiv`,
  });

  if (offeneDisputes > 0) {
    checks.push({
      label: 'Offene Einsprüche',
      status: 'warning',
      detail: `${offeneDisputes} warten auf eine Entscheidung.`,
      fixHref: '/turniere/matches?status=DISPUTED',
    });
  }

  // Verwaiste Discord-Ressourcen.
  const fehlend = await prisma.tournamentResource.count({
    where: { removedAt: null, missingSince: { not: null } },
  });
  if (fehlend > 0) {
    checks.push({
      label: 'Discord-Ressourcen',
      status: 'warning',
      detail: `${fehlend} vom Modul angelegte Kanäle oder Nachrichten sind verschwunden.`,
    });
  }

  if (settings.maintenanceMode) {
    checks.push({
      label: 'Betrieb',
      status: 'warning',
      detail: 'Wartungsmodus aktiv - es werden keine neuen Anmeldungen angenommen.',
    });
  }

  return checks;
}

export const tournamentsModule: ModuleDefinition = registerModule({
  id: TOURNAMENTS_MODULE_ID,
  name: 'Turniere',
  description:
    'Turnier-Leitstand für SwissHub: Anmeldung, Teams, Check-in, Gruppen, Bracket, Matches, Resultate, Livestream und Archiv - im Dashboard und auf Discord.',
  icon: 'Trophy',
  tagline: 'Turnier-Leitstand',
  permissionPrefix: 'tournaments',
  // Bewusst aus: das Modul legt Discord-Kanäle an. Eingeschaltet wird, wenn
  // Kategorie und Ankündigungs-Channel stehen.
  defaultEnabled: false,
  settingsSchema: tournamentSettingsSchema,
  settingsFields: tournamentSettingsFields,
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
  healthChecks: tournamentHealthChecks,
  permissions: [
    { key: TOURNAMENT_PERMISSIONS.view, label: 'Turniere ansehen', description: 'Den Turnierbereich im Dashboard öffnen.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.participate, label: 'An Turnieren teilnehmen', description: 'Anmelden, Team gründen, einchecken, Resultate melden.', module: TOURNAMENTS_MODULE_ID },

    { key: TOURNAMENT_PERMISSIONS.create, label: 'Turniere erstellen', description: 'Neue Turniere anlegen.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.manage, label: 'Turniere verwalten', description: 'Turniere bearbeiten, für die man als Leitung eingetragen ist.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.publish, label: 'Turniere veröffentlichen', description: 'Ein Turnier sichtbar schalten und starten.', module: TOURNAMENTS_MODULE_ID, critical: true },

    { key: TOURNAMENT_PERMISSIONS.registrationsView, label: 'Anmeldungen ansehen', description: 'Teilnehmerlisten mit Angaben aus dem Anmeldeformular.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.registrationsManage, label: 'Anmeldungen verwalten', description: 'Freigeben, ablehnen, nachrücken lassen.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.teamsManage, label: 'Teams verwalten', description: 'Roster ändern, Teams disqualifizieren.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.checkinManage, label: 'Check-in verwalten', description: 'Check-in öffnen, schliessen, von Hand bestätigen.', module: TOURNAMENTS_MODULE_ID },

    { key: TOURNAMENT_PERMISSIONS.bracketManage, label: 'Bracket verwalten', description: 'Setzliste und Bracket erzeugen.', module: TOURNAMENTS_MODULE_ID, critical: true },
    { key: TOURNAMENT_PERMISSIONS.matchesManage, label: 'Matches verwalten', description: 'Ansetzen, starten, Kanäle anlegen.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.resultsOverride, label: 'Resultate korrigieren', description: 'Ein bestätigtes Resultat mit Begründung ändern.', module: TOURNAMENTS_MODULE_ID, critical: true },
    { key: TOURNAMENT_PERMISSIONS.disputesManage, label: 'Einsprüche bearbeiten', description: 'Strittige Resultate entscheiden.', module: TOURNAMENTS_MODULE_ID },

    { key: TOURNAMENT_PERMISSIONS.streamManage, label: 'Livestream verwalten', description: 'Streams planen, Caster zuweisen.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.prizesManage, label: 'Preise verwalten', description: 'Preise pflegen und als übergeben markieren.', module: TOURNAMENTS_MODULE_ID },

    { key: TOURNAMENT_PERMISSIONS.staffManage, label: 'Turnierleitung zuteilen', description: 'Bestimmen, wer ein Turnier betreut.', module: TOURNAMENTS_MODULE_ID, critical: true },
    { key: TOURNAMENT_PERMISSIONS.blockManage, label: 'Turniersperren verwalten', description: 'Mitglieder von der Teilnahme ausschliessen.', module: TOURNAMENTS_MODULE_ID, critical: true },

    { key: TOURNAMENT_PERMISSIONS.statsView, label: 'Turnier-Statistiken ansehen', description: 'Kennzahlen über alle Turniere.', module: TOURNAMENTS_MODULE_ID },
    { key: TOURNAMENT_PERMISSIONS.archiveView, label: 'Turnier-Archiv ansehen', description: 'Abgeschlossene Turniere nachschlagen.', module: TOURNAMENTS_MODULE_ID },

    { key: TOURNAMENT_PERMISSIONS.admin, label: 'Alle Turniere verwalten', description: 'Vollzugriff auf jedes Turnier, unabhängig von der Zuständigkeit.', module: TOURNAMENTS_MODULE_ID, critical: true },
  ],
  navigation: [
    {
      href: '/turniere/uebersicht',
      // Die oeffentliche Turnierseite liegt unter `/turniere` und gehoert
      // demselben Modul - der Seitentitel soll dort nicht verschwinden.
      titlePrefix: '/turniere',
      label: 'Turniere',
      icon: 'Trophy',
      permission: TOURNAMENT_PERMISSIONS.view,
      description: 'Turniere planen, durchführen und auswerten.',
      group: 'modules',
      order: 40,
    },
  ],
});
