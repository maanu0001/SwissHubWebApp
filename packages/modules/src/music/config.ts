import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const MUSIC_MODULE_ID = 'music';

/**
 * Berechtigungen des Musik-Moduls.
 *
 * Der Legacy-Bot kannte nur zwei Discord-Rollen und pruefte sie direkt im
 * Befehl. Das bleibt als *Zuweisungspolitik* erhalten - wer Controller und
 * wer nur Worker bekommt -, ist aber keine Autorisierung mehr: was jemand in
 * der WebApp darf, entscheidet wie ueberall das zentrale Rechtesystem.
 */
export const MUSIC_PERMISSIONS = {
  view: 'music.view',
  play: 'music.play',
  pause: 'music.pause',
  skip: 'music.skip',
  queueManage: 'music.queue.manage',
  volume: 'music.volume',
  loop: 'music.loop',
  sessionStart: 'music.session.start',
  sessionStop: 'music.session.stop',
  sessionsViewAll: 'music.sessions.viewAll',
  sessionsManageAll: 'music.sessions.manageAll',
  workersView: 'music.workers.view',
  workersManage: 'music.workers.manage',
  settingsView: 'music.settings.view',
  settingsManage: 'music.settings.manage',
} as const;

export const musicSettingsSchema = z.object({
  /** Legacy `roles.music_role_id` - darf den Controller belegen. */
  musicRoleId: z.string().nullable().default(null),
  /** Legacy `roles.worker_only_role_id` - bekommt ausschliesslich Worker. */
  workerOnlyRoleId: z.string().nullable().default(null),
  /** Legacy `behavior.idle_disconnect_seconds`. */
  idleDisconnectSeconds: z.number().int().min(30).max(24 * 3600).default(600),
  /** Legacy `behavior.alone_disconnect_seconds`. */
  aloneDisconnectSeconds: z.number().int().min(15).max(24 * 3600).default(120),
  defaultVolume: z.number().int().min(0).max(150).default(50),
  maxVolume: z.number().int().min(1).max(150).default(150),
  queueLimit: z.number().int().min(1).max(1000).default(100),
  /** 0 = keine Begrenzung. Verhindert zehnstuendige Videos in der Queue. */
  maxTrackSeconds: z.number().int().min(0).max(24 * 3600).default(0),
  searchResultLimit: z.number().int().min(1).max(10).default(5),
  /**
   * Darf der Controller normale Sessions uebernehmen?
   *
   * Standard entspricht dem Legacy-Verhalten: ja, fuer Mitglieder mit der
   * normalen Musik-Rolle. Wer nur die Worker-Rolle hat, bekommt ihn nie.
   */
  controllerPlaysMusic: z.boolean().default(true),
});

export type MusicSettings = z.infer<typeof musicSettingsSchema>;

const musicSettingsFields: SettingsField[] = [
  {
    key: 'musicRoleId',
    type: 'discord-role',
    label: 'Musik-Rolle',
    description: 'Darf Musik steuern und den Controller belegen, wenn dieser frei ist.',
    group: 'Discord',
  },
  {
    key: 'workerOnlyRoleId',
    type: 'discord-role',
    label: 'Worker-only Rolle',
    description: 'Erhält bei einer neuen Session ausschliesslich einen Worker, nie den Controller.',
    group: 'Discord',
  },
  {
    key: 'controllerPlaysMusic',
    type: 'boolean',
    label: 'Controller für Wiedergabe verwenden',
    description: 'Aus: der Controller bleibt frei und es spielen ausschliesslich Worker.',
    group: 'Zuweisung',
  },
  {
    key: 'idleDisconnectSeconds',
    type: 'duration',
    label: 'Leerlauf-Disconnect',
    description: 'Nichts läuft, Warteschlange leer, Loop aus - danach verlässt der Bot den Kanal.',
    group: 'Verhalten',
  },
  {
    key: 'aloneDisconnectSeconds',
    type: 'duration',
    label: 'Disconnect wenn niemand zuhört',
    description: 'Andere Bots zählen dabei nicht als Zuhörer.',
    group: 'Verhalten',
  },
  {
    key: 'defaultVolume',
    type: 'number',
    label: 'Standard-Lautstärke',
    description: 'In Prozent. Gilt für neue Sessions.',
    group: 'Wiedergabe',
    min: 0,
    max: 150,
  },
  {
    key: 'maxVolume',
    type: 'number',
    label: 'Maximale Lautstärke',
    description: 'In Prozent. Das Legacy-System erlaubt bis 150.',
    group: 'Wiedergabe',
    min: 1,
    max: 150,
  },
  {
    key: 'queueLimit',
    type: 'number',
    label: 'Maximale Warteschlange',
    description: 'Verhindert, dass eine einzelne Person tausende Titel einreiht.',
    group: 'Wiedergabe',
    min: 1,
    max: 1000,
  },
  {
    key: 'maxTrackSeconds',
    type: 'duration',
    label: 'Maximale Titellänge',
    description: '0 bedeutet keine Begrenzung.',
    group: 'Wiedergabe',
  },
  {
    key: 'searchResultLimit',
    type: 'number',
    label: 'Suchergebnisse',
    description: 'Wie viele Treffer angeboten werden. Discord zeigt höchstens fünf Knöpfe.',
    group: 'Wiedergabe',
    min: 1,
    max: 10,
  },
];

/**
 * Modul-Gesundheit.
 *
 * Musik haengt an mehr beweglichen Teilen als jedes andere Modul: den
 * Bot-Identitaeten, der Voice-Laufzeit und einer fremden Suchquelle. Was
 * davon fehlt, gehoert ins Dashboard und nicht ins Protokoll.
 */
async function musicHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const { prisma } = await import('@swisshub/database');
  const settings = await getModuleSettings<MusicSettings>(MUSIC_MODULE_ID);

  const rolle = (id: string | null, label: string): void => {
    if (!id) {
      checks.push({
        label,
        status: 'warning',
        detail: 'Nicht zugeordnet - die Zuweisungspolitik greift dann nicht.',
        fixHref: `/modules/${MUSIC_MODULE_ID}`,
      });
      return;
    }
    const treffer = context.roles.find((entry) => entry.id === id);
    checks.push(
      treffer
        ? { label, status: 'ok', detail: `@${treffer.name}` }
        : { label, status: 'error', detail: 'Rolle existiert auf Discord nicht mehr.' },
    );
  };

  rolle(settings.musicRoleId, 'Musik-Rolle');
  rolle(settings.workerOnlyRoleId, 'Worker-only Rolle');

  // Bot-Pool. Ohne konfigurierte Bots kann nichts spielen; das ist der
  // haeufigste Zustand direkt nach dem Deployment.
  const bots = await prisma.musicBotInstance.findMany();
  if (bots.length === 0) {
    checks.push({
      label: 'Musik-Bots',
      status: 'error',
      detail: 'Kein Bot konfiguriert. Die Voice-Laufzeit meldet sich selbst an, sobald sie läuft.',
    });
  } else {
    const online = bots.filter(
      (bot) => bot.enabled && bot.status !== 'OFFLINE' && bot.status !== 'DISABLED',
    ).length;
    checks.push({
      label: 'Musik-Bots',
      status: online === 0 ? 'error' : online < bots.length ? 'warning' : 'ok',
      detail: `${online} von ${bots.length} verfügbar`,
    });
  }

  return checks;
}

export const musicModule: ModuleDefinition = registerModule({
  id: MUSIC_MODULE_ID,
  name: 'Musik',
  description:
    'Mehrere Discord-Musik-Bots, ein Webplayer: Suche, Warteschlange und Wiedergabe für mehrere Voice-Kanäle gleichzeitig.',
  icon: 'Music',
  tagline: 'Webplayer und Bot-Pool',
  permissionPrefix: 'music',
  // Bewusst aus: das Modul braucht eine laufende Voice-Runtime und eigene
  // Bot-Tokens. Eingeschaltet wird, wenn beides steht.
  defaultEnabled: false,
  settingsSchema: musicSettingsSchema,
  settingsFields: musicSettingsFields,
  configVersion: 1,
  requiredDiscordPermissions: ['VIEW_CHANNEL', 'CONNECT', 'SPEAK'],
  healthChecks: musicHealthChecks,
  permissions: [
    {
      key: MUSIC_PERMISSIONS.view,
      label: 'Musik ansehen',
      description: 'Player und Warteschlange der eigenen Session einsehen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.play,
      label: 'Musik abspielen',
      description: 'Titel suchen und zur Warteschlange hinzufügen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.pause,
      label: 'Pausieren und fortsetzen',
      description: 'Die Wiedergabe anhalten und wieder starten.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.skip,
      label: 'Titel überspringen',
      description: 'Zum nächsten Titel springen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.queueManage,
      label: 'Warteschlange verwalten',
      description: 'Titel entfernen, verschieben und mischen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.volume,
      label: 'Lautstärke ändern',
      description: 'Die Lautstärke der Session anpassen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.loop,
      label: 'Wiederholung ändern',
      description: 'Zwischen aus, Titel und Warteschlange umschalten.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.sessionStart,
      label: 'Session starten',
      description: 'Einen Musik-Bot in den eigenen Voice-Kanal holen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.sessionStop,
      label: 'Session beenden',
      description: 'Die Wiedergabe stoppen und den Bot entlassen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.sessionsViewAll,
      label: 'Alle Sessions ansehen',
      description: 'Auch Sessions fremder Voice-Kanäle einsehen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.sessionsManageAll,
      label: 'Alle Sessions steuern',
      description: 'Fremde Sessions pausieren, überspringen und beenden.',
      module: MUSIC_MODULE_ID,
      critical: true,
    },
    {
      key: MUSIC_PERMISSIONS.workersView,
      label: 'Bot-Pool ansehen',
      description: 'Zustand und Auslastung der Musik-Bots einsehen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.workersManage,
      label: 'Bot-Pool verwalten',
      description: 'Bots abschalten, entleeren und wieder freigeben.',
      module: MUSIC_MODULE_ID,
      critical: true,
    },
    {
      key: MUSIC_PERMISSIONS.settingsView,
      label: 'Musik-Einstellungen ansehen',
      description: 'Rollen, Zeitlimits und Wiedergabegrenzen einsehen.',
      module: MUSIC_MODULE_ID,
    },
    {
      key: MUSIC_PERMISSIONS.settingsManage,
      label: 'Musik-Einstellungen ändern',
      description: 'Rollen, Zeitlimits und Wiedergabegrenzen ändern.',
      module: MUSIC_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/musik',
      label: 'Musik',
      icon: 'Music',
      permission: MUSIC_PERMISSIONS.view,
      description: 'Suche, Warteschlange und Wiedergabe deiner Voice-Session.',
      group: 'modules',
      order: 56,
    },
  ],
});
