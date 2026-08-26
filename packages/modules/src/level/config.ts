import { z } from 'zod';
import { optionalSnowflakeSchema, snowflakeSchema } from '@swisshub/shared';
import { registerModule } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';
import { DEFAULT_MAX_LEVEL_TOTAL_XP } from './curve';
import { DEFAULT_PAYOUT_FACTOR } from './game-rules';

export const LEVEL_MODULE_ID = 'level';

/**
 * Berechtigungen des Level-Systems.
 *
 * Der alte Bot kannte drei feste Rollen-IDs: `LEVEL_MANAGER_ROLE_ID` durfte
 * alles, `LEVEL5_ROLE_ID` und `LEVEL10_ROLE_ID` schalteten je zwei Spiele
 * frei. Diese Aufteilung bleibt inhaltlich erhalten, ist aber jetzt an
 * benannte Berechtigungen geknüpft, die im Dashboard beliebigen Rollen
 * zugewiesen werden - und für Slash Command und Web-Oberfläche gleich gelten.
 */
export const LEVEL_PERMISSIONS = {
  view: 'level.view',
  membersView: 'level.members.view',
  membersManage: 'level.members.manage',
  leaderboardView: 'level.leaderboard.view',
  gamesView: 'level.games.view',
  /** Ersetzt `LEVEL5_ROLE_ID`: XP-Battle und Schere-Stei-Papier. */
  gamesPlayBasic: 'level.games.play.basic',
  /** Ersetzt `LEVEL10_ROLE_ID`: TicTacToe und 4 Gewinnt. */
  gamesPlayAdvanced: 'level.games.play.advanced',
  gamesManage: 'level.games.manage',
  /**
   * Eine eigene Levelkarte hochladen.
   *
   * Bewusst eine Berechtigung und keine Abfrage auf eine Premium- oder
   * Prestige-Rolle: welche Rollen das duerfen, entscheidet die
   * Rollenverwaltung im Dashboard. Ein Servername im Code waere auf dem
   * naechsten Server falsch.
   */
  cardCustom: 'level.card.custom',
  rolesView: 'level.roles.view',
  rolesManage: 'level.roles.manage',
  rulesManage: 'level.rules.manage',
  decayManage: 'level.decay.manage',
  statsView: 'level.stats.view',
  settingsView: 'level.settings.view',
  settingsManage: 'level.settings.manage',
  import: 'level.import',
  /**
   * XP-Verlosungen ("XP-Glücksrad").
   *
   * `view` und `participate` sind für gewöhnliche Mitglieder gedacht; alles
   * Weitere gehört zur Verwaltung. `redraw` steht bewusst getrennt: eine
   * Neuziehung greift in ein bereits verkündetes Ergebnis ein und soll nicht
   * automatisch jeder Person offenstehen, die eine Verlosung anlegen darf.
   */
  raffleView: 'level.raffle.view',
  raffleParticipate: 'level.raffle.participate',
  raffleManage: 'level.raffle.manage',
  raffleCreate: 'level.raffle.create',
  raffleEdit: 'level.raffle.edit',
  raffleOpen: 'level.raffle.open',
  raffleClose: 'level.raffle.close',
  raffleDraw: 'level.raffle.draw',
  raffleRedraw: 'level.raffle.redraw',
  raffleCancel: 'level.raffle.cancel',
  raffleHistory: 'level.raffle.history',
} as const;

/** Farbe der Level-Embeds. */
export const DEFAULT_LEVEL_ACCENT_COLOR = '#83060A';

export const DEFAULT_LEVEL_UP_MESSAGE = '**Glückwunsch {mention}, du hesch Level {level} erreicht!**';

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/u, 'Bitte eine Hex-Farbe wie #83060A angeben.')
  .default(DEFAULT_LEVEL_ACCENT_COLOR);

/**
 * Liste von Leveln, bei denen ein Aufstieg angekündigt wird. Leer = alle.
 * Entspricht `config.announce_levels` der Altdatenbank.
 */
const announceLevelsSchema = z
  .string()
  .max(200)
  .default('')
  .refine(
    (value) => value.trim() === '' || value.split(',').every((part) => /^\s*\d{1,3}\s*$/u.test(part)),
    'Bitte Level durch Komma trennen, z.B. "5,10,31".',
  );

const muteModeSchema = z.enum(['sound', 'voice', 'beide']).default('beide');

export const levelSettingsSchema = z.object({
  // --- Discord -------------------------------------------------------------
  /** Kanal für Level-Up-Meldungen (früher `MAIN_CHAT_ID`). */
  announceChannelId: optionalSnowflakeSchema,
  /** Protokoll für XP-Änderungen (früher `LEVEL_LOG_CHANNEL_ID`). */
  levelLogChannelId: optionalSnowflakeSchema,
  /** Protokoll für Inaktivitäts-Abzüge (früher `DECAY_LOG_CHANNEL_ID`). */
  decayLogChannelId: optionalSnowflakeSchema,

  // --- Rollen --------------------------------------------------------------
  /** Wer diese Rolle trägt, sammelt keine XP (früher `NO_XP_ROLE_ID`). */
  noXpRoleId: optionalSnowflakeSchema,
  /** Rolle mit kürzerem Nachrichten-Cooldown (früher `PREMIUM_ROLE_ID`). */
  premiumRoleId: optionalSnowflakeSchema,

  // --- XP für Nachrichten --------------------------------------------------
  messageXpEnabled: z.boolean().default(true),
  xpPerMessage: z.number().int().min(0).max(1000).default(10),
  messageCooldownSeconds: z.number().int().min(0).max(86_400).default(60),
  premiumMessageCooldownSeconds: z.number().int().min(0).max(86_400).default(60),
  premiumXpMultiplier: z.number().min(0).max(100).default(1),
  /** Globaler Faktor auf jede XP-Vergabe (früher `config.xp_boost`). */
  xpBoost: z.number().min(0).max(100).default(1),
  /** Channels ohne XP (früher Tabelle `no_xp_channels`). */
  noXpChannelIds: z.array(snowflakeSchema).max(200).default([]),

  // --- XP für Voice --------------------------------------------------------
  voiceXpEnabled: z.boolean().default(true),
  xpPerVoiceMinute: z.number().int().min(0).max(1000).default(10),
  /** Wie oft Zeit im Voice als Aktivität zählt (Schutz vor Schreiblast). */
  voiceActivityTouchIntervalSeconds: z.number().int().min(10).max(3600).default(60),
  specialVoiceChannelIds: z.array(snowflakeSchema).max(200).default([]),
  specialVoiceMultiplier: z.number().min(0).max(100).default(1),
  stageVoiceChannelIds: z.array(snowflakeSchema).max(200).default([]),
  stageVoiceMultiplier: z.number().min(0).max(100).default(1),
  /** Kein XP, solange jemand stumm oder taub geschaltet ist. */
  voiceMuteBlocksXp: z.boolean().default(true),
  /** Nachlauf, bevor die Stummschaltung XP blockiert. */
  voiceMuteCooldownSeconds: z.number().int().min(0).max(86_400).default(0),
  /** Welche Art Stummschaltung zählt. */
  voiceMuteMode: muteModeSchema,
  /** XP auch, wenn jemand alleine im Kanal sitzt. */
  xpWhileAlone: z.boolean().default(true),

  // --- Level-Ups -----------------------------------------------------------
  announceLevelUps: z.boolean().default(true),
  /** Leer = jeder Aufstieg wird angekündigt. */
  announceLevels: announceLevelsSchema,
  levelUpMessage: z.string().max(500).default(DEFAULT_LEVEL_UP_MESSAGE),
  /** XP-Schwelle des Höchstlevels. */
  maxLevelTotalXp: z.number().int().min(1000).max(10_000_000).default(DEFAULT_MAX_LEVEL_TOTAL_XP),

  // --- Inaktivität ---------------------------------------------------------
  decayEnabled: z.boolean().default(true),
  decayGraceDays: z.number().int().min(0).max(365).default(7),
  decayDay1To4: z.number().int().min(0).max(100_000).default(50),
  decayDay5Plus: z.number().int().min(0).max(100_000).default(25),
  decaySweepIntervalSeconds: z.number().int().min(60).max(86_400).default(300),

  // --- Spiele --------------------------------------------------------------
  gamesEnabled: z.boolean().default(true),
  /** Anteil des Topfes, der ausgezahlt wird. */
  gamePayoutFactor: z.number().min(0).max(1).default(DEFAULT_PAYOUT_FACTOR),
  gameMinBet: z.number().int().min(1).max(1_000_000).default(1),
  gameMaxBet: z.number().int().min(1).max(10_000_000).default(5000),
  gameAcceptTimeoutSeconds: z.number().int().min(10).max(3600).default(30),
  gameBattleTimeoutSeconds: z.number().int().min(10).max(3600).default(30),
  gameSspTimeoutSeconds: z.number().int().min(10).max(3600).default(180),
  gameTttTimeoutSeconds: z.number().int().min(10).max(3600).default(90),
  gameConnectFourTimeoutSeconds: z.number().int().min(10).max(3600).default(120),

  // --- Levelkarte ----------------------------------------------------------
  accentColor: hexColorSchema,
  /**
   * Hochgeladener Hintergrund der Levelkarte (Dateiname im Upload-Verzeichnis).
   *
   * Er hat Vorrang vor der Adresse: wer eine Datei hochlädt, will sie sehen.
   * Verwaltet wird das Feld über die Seite "Levelkarte", nicht von Hand -
   * deshalb steht es nicht in `levelSettingsFields`.
   */
  cardBannerPath: z.string().max(120).default(''),
  /** Hintergrund der Levelkarte als Adresse (früher `BANNER_URL`). */
  cardBannerUrl: z.string().max(1000).default(''),
  /** Hochgeladener Hintergrund für das Höchstlevel (früher `lvl31_banner.png`). */
  cardPrestigeBannerPath: z.string().max(120).default(''),
  /** Hintergrund für das Höchstlevel als Adresse. */
  cardPrestigeBannerUrl: z.string().max(1000).default(''),
});

export type LevelSettings = z.infer<typeof levelSettingsSchema>;

export const levelSettingsFields: SettingsField[] = [
  {
    key: 'announceChannelId',
    type: 'discord-channel',
    label: 'Level-Up-Channel',
    description: 'Hier meldet der Bot erreichte Level. Ohne Auswahl gibt es keine Meldung.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'levelLogChannelId',
    type: 'discord-channel',
    label: 'XP-Protokoll',
    description: 'Vergebene und entzogene XP werden hier mitgeschrieben.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'decayLogChannelId',
    type: 'discord-channel',
    label: 'Inaktivitäts-Protokoll',
    description: 'Beginn, Ende und Höhe der Inaktivitäts-Abzüge.',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'noXpRoleId',
    type: 'discord-role',
    label: 'Rolle ohne XP',
    description: 'Wer diese Rolle trägt, sammelt keine XP mehr.',
    group: 'Rollen',
  },
  {
    key: 'premiumRoleId',
    type: 'discord-role',
    label: 'Premium-Rolle',
    description: 'Erhält den Premium-Multiplikator und den kürzeren Nachrichten-Cooldown.',
    group: 'Rollen',
  },

  {
    key: 'messageXpEnabled',
    type: 'boolean',
    label: 'XP für Nachrichten',
    description: 'Schaltet die XP-Vergabe im Chat vollständig ab.',
    group: 'XP für Nachrichten',
  },
  {
    key: 'xpPerMessage',
    type: 'number',
    label: 'XP pro Nachricht',
    group: 'XP für Nachrichten',
    min: 0,
    max: 1000,
    unit: 'XP',
  },
  {
    key: 'messageCooldownSeconds',
    type: 'duration',
    label: 'Cooldown',
    description: 'Innerhalb dieser Zeit gibt es nur einmal XP.',
    group: 'XP für Nachrichten',
    min: 0,
    max: 86_400,
    presets: [30, 60, 120, 300],
  },
  {
    key: 'premiumMessageCooldownSeconds',
    type: 'duration',
    label: 'Cooldown mit Premium-Rolle',
    group: 'XP für Nachrichten',
    min: 0,
    max: 86_400,
    presets: [15, 30, 60],
  },
  {
    key: 'premiumXpMultiplier',
    type: 'number',
    label: 'Premium-Multiplikator',
    description: 'Faktor auf XP von Mitgliedern mit Premium-Rolle.',
    group: 'XP für Nachrichten',
    min: 0,
    max: 100,
    step: 0.05,
  },
  {
    key: 'xpBoost',
    type: 'number',
    label: 'Globaler XP-Boost',
    description: 'Faktor auf jede XP-Vergabe aus Nachrichten und Voice.',
    group: 'XP für Nachrichten',
    min: 0,
    max: 100,
    step: 0.05,
  },
  {
    key: 'noXpChannelIds',
    type: 'discord-channel-list',
    label: 'Channels ohne XP',
    description: 'In diesen Text- und Sprachkanälen wird keine XP vergeben.',
    group: 'XP für Nachrichten',
    channelKinds: ['text', 'voice'],
  },

  {
    key: 'voiceXpEnabled',
    type: 'boolean',
    label: 'XP für Voice',
    group: 'XP für Voice',
  },
  {
    key: 'xpPerVoiceMinute',
    type: 'number',
    label: 'XP pro Minute',
    group: 'XP für Voice',
    min: 0,
    max: 1000,
    unit: 'XP',
  },
  {
    key: 'voiceActivityTouchIntervalSeconds',
    type: 'duration',
    label: 'Aktivität auffrischen alle',
    description: 'Wie oft Zeit im Voice als Aktivität gegen den Abzug zählt.',
    group: 'XP für Voice',
    min: 10,
    max: 3600,
    presets: [30, 60, 300],
  },
  {
    key: 'specialVoiceChannelIds',
    type: 'discord-channel-list',
    label: 'Kanäle mit Sonder-Multiplikator',
    group: 'XP für Voice',
    channelKinds: ['voice'],
  },
  {
    key: 'specialVoiceMultiplier',
    type: 'number',
    label: 'Sonder-Multiplikator',
    group: 'XP für Voice',
    min: 0,
    max: 100,
    step: 0.05,
  },
  {
    key: 'stageVoiceChannelIds',
    type: 'discord-channel-list',
    label: 'Bühnen-Kanäle',
    group: 'XP für Voice',
    channelKinds: ['voice'],
  },
  {
    key: 'stageVoiceMultiplier',
    type: 'number',
    label: 'Bühnen-Multiplikator',
    group: 'XP für Voice',
    min: 0,
    max: 100,
    step: 0.05,
  },
  {
    key: 'voiceMuteBlocksXp',
    type: 'boolean',
    label: 'Kein XP bei Stummschaltung',
    group: 'XP für Voice',
  },
  {
    key: 'voiceMuteCooldownSeconds',
    type: 'duration',
    label: 'Nachlauf bei Stummschaltung',
    description: 'So lange gibt es nach dem Stummschalten noch XP.',
    group: 'XP für Voice',
    min: 0,
    max: 86_400,
    presets: [0, 60, 300],
  },
  {
    key: 'voiceMuteMode',
    type: 'text',
    label: 'Welche Stummschaltung zählt',
    description: '"sound" = selbst stumm, "voice" = vom Server stumm, "beide" = beides.',
    group: 'XP für Voice',
    maxLength: 10,
    placeholder: 'beide',
  },
  {
    key: 'xpWhileAlone',
    type: 'boolean',
    label: 'XP auch alleine im Kanal',
    description: 'Abgeschaltet gibt es nur XP, wenn noch jemand anderes im Kanal ist.',
    group: 'XP für Voice',
  },

  {
    key: 'announceLevelUps',
    type: 'boolean',
    label: 'Level-Ups ankündigen',
    group: 'Level-Ups',
  },
  {
    key: 'announceLevels',
    type: 'text',
    label: 'Nur diese Level ankündigen',
    description: 'Level durch Komma getrennt, z.B. "5,10,31". Leer = jeder Aufstieg.',
    group: 'Level-Ups',
    maxLength: 200,
    placeholder: '5,10,31',
  },
  {
    key: 'levelUpMessage',
    type: 'textarea',
    label: 'Text der Meldung',
    description: 'Platzhalter: {mention}, {user}, {level}.',
    group: 'Level-Ups',
    maxLength: 500,
  },
  {
    key: 'maxLevelTotalXp',
    type: 'number',
    label: 'XP für das Höchstlevel',
    description: 'Ändert die Schwelle für Level 31. Verschiebt Levelstände - mit Bedacht anfassen.',
    group: 'Level-Ups',
    min: 1000,
    max: 10_000_000,
    unit: 'XP',
  },

  {
    key: 'decayEnabled',
    type: 'boolean',
    label: 'Inaktivitäts-Abzug',
    description: 'Zieht inaktiven Mitgliedern täglich XP ab.',
    group: 'Inaktivität',
  },
  {
    key: 'decayGraceDays',
    type: 'number',
    label: 'Schonfrist',
    description: 'So viele Tage ohne Aktivität bleiben folgenlos.',
    group: 'Inaktivität',
    min: 0,
    max: 365,
    unit: 'Tage',
  },
  {
    key: 'decayDay1To4',
    type: 'number',
    label: 'Abzug Tag 1 bis 4',
    group: 'Inaktivität',
    min: 0,
    max: 100_000,
    unit: 'XP',
  },
  {
    key: 'decayDay5Plus',
    type: 'number',
    label: 'Abzug ab Tag 5',
    group: 'Inaktivität',
    min: 0,
    max: 100_000,
    unit: 'XP',
  },
  {
    key: 'decaySweepIntervalSeconds',
    type: 'duration',
    label: 'Prüfintervall',
    group: 'Inaktivität',
    min: 60,
    max: 86_400,
    presets: [300, 900, 3600],
  },

  {
    key: 'gamesEnabled',
    type: 'boolean',
    label: 'XP-Spiele',
    group: 'Spiele',
  },
  {
    key: 'gamePayoutFactor',
    type: 'number',
    label: 'Auszahlungsfaktor',
    description: 'Anteil beider Einsätze, den der Gewinner erhält. 0.95 = 95 Prozent.',
    group: 'Spiele',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'gameMinBet',
    type: 'number',
    label: 'Kleinster Einsatz',
    group: 'Spiele',
    min: 1,
    max: 1_000_000,
    unit: 'XP',
  },
  {
    key: 'gameMaxBet',
    type: 'number',
    label: 'Grösster Einsatz',
    group: 'Spiele',
    min: 1,
    max: 10_000_000,
    unit: 'XP',
  },
  {
    key: 'gameAcceptTimeoutSeconds',
    type: 'duration',
    label: 'Zeit zum Annehmen',
    group: 'Spiele',
    min: 10,
    max: 3600,
    presets: [30, 60, 120],
  },
  {
    key: 'gameBattleTimeoutSeconds',
    type: 'duration',
    label: 'Zeitfenster XP-Battle',
    group: 'Spiele',
    min: 10,
    max: 3600,
    presets: [30, 60],
  },
  {
    key: 'gameSspTimeoutSeconds',
    type: 'duration',
    label: 'Zeitfenster Schere-Stei-Papier',
    group: 'Spiele',
    min: 10,
    max: 3600,
    presets: [120, 180, 300],
  },
  {
    key: 'gameTttTimeoutSeconds',
    type: 'duration',
    label: 'Zeitfenster TicTacToe',
    group: 'Spiele',
    min: 10,
    max: 3600,
    presets: [60, 90, 180],
  },
  {
    key: 'gameConnectFourTimeoutSeconds',
    type: 'duration',
    label: 'Zeitfenster 4 Gewinnt',
    group: 'Spiele',
    min: 10,
    max: 3600,
    presets: [90, 120, 240],
  },

  {
    key: 'accentColor',
    type: 'text',
    label: 'Akzentfarbe',
    description: 'Hex-Farbe der Level-Embeds und der Levelkarte.',
    group: 'Levelkarte',
    maxLength: 7,
    placeholder: DEFAULT_LEVEL_ACCENT_COLOR,
  },
  {
    key: 'cardBannerUrl',
    type: 'text',
    label: 'Hintergrund der Levelkarte (Adresse)',
    description: 'Alternative zum Hochladen unter "Levelkarte". Eine hochgeladene Datei hat Vorrang.',
    group: 'Levelkarte',
    maxLength: 1000,
  },
  {
    key: 'cardPrestigeBannerUrl',
    type: 'text',
    label: 'Hintergrund im Höchstlevel (Adresse)',
    description: 'Eigenes Bild für Level 31. Leer nutzt den normalen Hintergrund.',
    group: 'Levelkarte',
    maxLength: 1000,
  },
];

/**
 * Prüfungen für die Modul-Gesundheit.
 *
 * Sie zeigen die Fälle, in denen das Modul zwar eingeschaltet ist, aber
 * stillschweigend nichts tut - genau die Situation, die beim Vorgänger nur
 * über die Logs auffiel.
 */
async function levelHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const settingsHref = `/modules/${LEVEL_MODULE_ID}`;

  // --- XP-Quellen ----------------------------------------------------------
  const messageXp = settings.messageXpEnabled && settings.xpPerMessage > 0;
  const voiceXp = settings.voiceXpEnabled && settings.xpPerVoiceMinute > 0;

  if (settings.xpBoost === 0) {
    checks.push({
      label: 'XP-Quellen',
      status: 'warning',
      detail: 'Der globale XP-Boost steht auf 0. Es wird nirgends XP vergeben.',
      fixHref: settingsHref,
    });
  } else if (!messageXp && !voiceXp) {
    checks.push({
      label: 'XP-Quellen',
      status: 'warning',
      detail: 'Weder Nachrichten noch Voice vergeben XP. Das Level-System steht still.',
      fixHref: settingsHref,
    });
  } else {
    const active = [messageXp ? 'Nachrichten' : null, voiceXp ? 'Voice' : null].filter(Boolean);
    checks.push({
      label: 'XP-Quellen',
      status: 'ok',
      detail: `${active.join(' und ')} ${active.length > 1 ? 'vergeben' : 'vergibt'} XP.`,
    });
  }

  // --- Level-Up-Channel ----------------------------------------------------
  if (settings.announceLevelUps) {
    const channel = settings.announceChannelId
      ? context.channels.find((entry) => entry.id === settings.announceChannelId)
      : undefined;
    if (!settings.announceChannelId) {
      checks.push({
        label: 'Level-Up-Channel',
        status: 'warning',
        detail: 'Level-Ups sind eingeschaltet, aber es ist kein Channel dafür gewählt.',
        fixHref: settingsHref,
      });
    } else if (!channel || channel.deleted) {
      checks.push({
        label: 'Level-Up-Channel',
        status: 'error',
        detail: 'Der gewählte Channel existiert auf Discord nicht mehr.',
        fixHref: settingsHref,
      });
    } else {
      checks.push({ label: 'Level-Up-Channel', status: 'ok', detail: `#${channel.name}` });
    }
  }

  // --- Meilenstein-Rollen --------------------------------------------------
  const { prisma } = await import('@swisshub/database');
  const milestones = await prisma.levelMilestoneRole
    .findMany({ where: { enabled: true }, orderBy: { level: 'asc' } })
    .catch(() => []);

  if (milestones.length === 0) {
    checks.push({
      label: 'Meilenstein-Rollen',
      status: 'ok',
      detail: 'Keine Level-Rollen eingerichtet.',
    });
  } else {
    const missing: string[] = [];
    const tooHigh: string[] = [];
    for (const milestone of milestones) {
      const role = context.roles.find((entry) => entry.id === milestone.roleId);
      if (!role || role.deleted) {
        missing.push(`Level ${milestone.level}`);
      } else if (role.position >= context.botHighestPosition) {
        tooHigh.push(`@${role.name}`);
      }
    }
    if (missing.length > 0) {
      checks.push({
        label: 'Meilenstein-Rollen',
        status: 'error',
        detail: `Für ${missing.join(', ')} existiert die Rolle nicht mehr.`,
        fixHref: '/level/roles',
      });
    } else if (tooHigh.length > 0) {
      checks.push({
        label: 'Meilenstein-Rollen',
        status: 'error',
        detail: `Der Bot steht unter ${tooHigh.join(', ')} und kann diese Rollen nicht vergeben.`,
        fixHref: '/server/roles',
      });
    } else {
      checks.push({
        label: 'Meilenstein-Rollen',
        status: 'ok',
        detail: `${milestones.length} Level-Rollen, alle vergebbar.`,
      });
    }
  }

  // --- Inaktivitäts-Abzug --------------------------------------------------
  if (settings.decayEnabled && settings.decayDay1To4 === 0 && settings.decayDay5Plus === 0) {
    checks.push({
      label: 'Inaktivitäts-Abzug',
      status: 'warning',
      detail: 'Der Abzug ist eingeschaltet, zieht aber 0 XP ab.',
      fixHref: settingsHref,
    });
  }

  // --- Einsätze ------------------------------------------------------------
  if (settings.gamesEnabled && settings.gameMinBet > settings.gameMaxBet) {
    checks.push({
      label: 'Einsätze der XP-Spiele',
      status: 'error',
      detail: 'Der kleinste Einsatz liegt über dem grössten - es lässt sich kein Spiel starten.',
      fixHref: settingsHref,
    });
  }

  return checks;
}

registerModule({
  id: LEVEL_MODULE_ID,
  name: 'Level-System',
  description: 'XP für Nachrichten und Voice, Level, Meilenstein-Rollen, Inaktivitäts-Abzug und XP-Spiele.',
  tagline: 'XP, Level und Spiele',
  icon: 'TrendingUp',
  permissionPrefix: 'level',
  defaultEnabled: false,
  configVersion: 1,
  requiredDiscordPermissions: [
    'MANAGE_ROLES',
    'VIEW_CHANNEL',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'ATTACH_FILES',
  ],
  settingsSchema: levelSettingsSchema,
  settingsFields: levelSettingsFields,
  healthChecks: levelHealthChecks,
  permissions: [
    {
      key: LEVEL_PERMISSIONS.view,
      label: 'Level-System ansehen',
      description: 'Zugriff auf die Übersicht des Level-Systems.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.membersView,
      label: 'Mitglieder ansehen',
      description: 'XP-Stände, Level und Verlauf einzelner Mitglieder einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.membersManage,
      label: 'XP vergeben und entziehen',
      description: 'XP-Stände von Hand ändern. Ersetzt die alte Level-Manager-Rolle.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.leaderboardView,
      label: 'Rangliste ansehen',
      description: 'Die Rangliste des Servers einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.gamesView,
      label: 'Spiele ansehen',
      description: 'Laufende und beendete XP-Spiele einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.gamesPlayBasic,
      label: 'XP-Battle und Schere-Stei-Papier spielen',
      description: 'Ersetzt die frühere Level-5-Rolle.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.gamesPlayAdvanced,
      label: 'TicTacToe und 4 Gewinnt spielen',
      description: 'Ersetzt die frühere Level-10-Rolle.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.gamesManage,
      label: 'Spiele verwalten',
      description: 'Laufende Partien abbrechen und Einsätze zurückgeben.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.cardCustom,
      label: 'Eigene Levelkarte hochladen',
      description:
        'Ein eigenes Bild als persönliche Levelkarte hinterlegen. Gilt nur für die eigene Karte - die Vorlagen des Servers bleiben unberührt.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.rolesView,
      label: 'Meilenstein-Rollen ansehen',
      description: 'Zuordnung von Leveln zu Rollen einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.rolesManage,
      label: 'Meilenstein-Rollen verwalten',
      description: 'Level-Rollen festlegen und bestehende Vergaben abgleichen.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.rulesManage,
      label: 'XP-Regeln verwalten',
      description: 'XP pro Nachricht, Cooldowns, Boost und Channels ohne XP ändern.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.decayManage,
      label: 'Inaktivitäts-Abzug verwalten',
      description: 'Schonfrist und Abzüge ändern sowie den Abzug von Hand ausführen.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.statsView,
      label: 'Statistiken ansehen',
      description: 'Auswertungen über XP, Level und Spiele einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.settingsView,
      label: 'Einstellungen ansehen',
      description: 'Einstellungen des Level-Systems einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.settingsManage,
      label: 'Einstellungen ändern',
      description: 'Einstellungen des Level-Systems ändern.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.raffleView,
      label: 'XP-Glücksrad ansehen',
      description: 'Laufende und vergangene XP-Verlosungen sehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleParticipate,
      label: 'An Verlosungen teilnehmen',
      description: 'Eigene XP als Einsatz für eine Verlosung verwenden.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleManage,
      label: 'Verlosungen verwalten',
      description: 'Teilnehmerverwaltung, Gewinner bestätigen und Ankündigungen erneut veröffentlichen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleCreate,
      label: 'Verlosungen anlegen',
      description: 'Neue Verlosungen erstellen und veröffentlichen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleEdit,
      label: 'Verlosungen bearbeiten',
      description: 'Angaben einer Verlosung ändern.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleOpen,
      label: 'Teilnahme öffnen',
      description: 'Die Teilnahmephase einer Verlosung starten.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleClose,
      label: 'Teilnahme schliessen',
      description: 'Die Teilnahmephase vorzeitig beenden.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleDraw,
      label: 'Auslosung starten',
      description: 'Die Ziehung auslösen. Den Gewinner bestimmt der Server.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.raffleRedraw,
      label: 'Neu ziehen',
      description: 'Eine bereits erfolgte Ziehung mit Pflichtgrund wiederholen. Bewusst getrennt vergeben.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.raffleCancel,
      label: 'Verlosung abbrechen',
      description: 'Eine Verlosung abbrechen und alle Einsätze zurückzahlen.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
    {
      key: LEVEL_PERMISSIONS.raffleHistory,
      label: 'Verlosungs-Historie',
      description: 'Ziehungen, Neuziehungen und Rückzahlungen vergangener Verlosungen einsehen.',
      module: LEVEL_MODULE_ID,
    },
    {
      key: LEVEL_PERMISSIONS.import,
      label: 'Altdaten übernehmen',
      description: 'XP-Stände aus der alten levels.db übernehmen.',
      module: LEVEL_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/level',
      label: 'Level-System',
      description: 'XP, Level, Meilenstein-Rollen und XP-Spiele',
      permission: LEVEL_PERMISSIONS.view,
      icon: 'TrendingUp',
      group: 'modules',
      order: 54,
    },
    {
      /**
       * Die Mitgliederseite des Glücksrads.
       *
       * Bewusst im obersten Abschnitt statt unter "Module": sie richtet sich
       * an alle Mitglieder, nicht an die Verwaltung. Wer nur
       * `level.raffle.view` hat, sieht ausschliesslich diesen Eintrag.
       */
      href: '/xp-gluecksrad',
      label: 'XP-Glücksrad',
      description: 'Aktuelle XP-Verlosung, Teilnahme und vergangene Ziehungen',
      permission: LEVEL_PERMISSIONS.raffleView,
      icon: 'Ticket',
      group: 'overview',
      order: 21,
      // Nur solange es etwas zu gewinnen gibt. Ein Eintrag, der das ganze
      // Jahr «keine aktive Verlosung» sagt, ist eine Zeile, die niemand mehr
      // liest. Im Level-System bleibt das Gluecksrad dauerhaft erreichbar.
      visibleWhen: 'activeRaffle',
    },
  ],
});
