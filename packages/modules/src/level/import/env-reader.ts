import { AppError } from '@swisshub/shared';
import type { LevelSettings } from '../config';

/**
 * Übernahme einzelner Werte aus der alten `.env`.
 *
 * Bewusst als Positivliste: gelesen wird ausschliesslich, was unten steht.
 * Alles andere wird nicht ausgewertet, nicht angezeigt und nicht gespeichert.
 * Eine Sperrliste wäre hier der falsche Ansatz - sie müsste jeden künftigen
 * Namen kennen, und ein vergessener Eintrag würde ein Geheimnis durchlassen.
 *
 * Betroffen sind insbesondere `BOT_TOKEN`, `AUTH_SECRET`, `DATABASE_URL` und
 * `REDIS_URL`: Sie stehen nicht in der Liste, werden deshalb übersprungen und
 * tauchen weder in der Vorschau noch im Protokoll auf. Die Zugangsdaten des
 * Bots kommen aus der zentralen Konfiguration der WebApp.
 */

/** 1 MB - eine `.env` ist ein paar Kilobyte gross. */
export const MAX_ENV_BYTES = 1024 * 1024;

type Kind = 'snowflake' | 'snowflake-list' | 'integer' | 'float' | 'text' | 'milestones';

interface EnvMapping {
  /** Name in der alten `.env`. */
  key: string;
  /** Zielfeld in den Moduleinstellungen. `null` = Sonderbehandlung. */
  target: keyof LevelSettings | null;
  kind: Kind;
  label: string;
}

/**
 * Die einzigen Namen, die überhaupt gelesen werden.
 */
export const ENV_WHITELIST: readonly EnvMapping[] = [
  { key: 'MAIN_CHAT_ID', target: 'announceChannelId', kind: 'snowflake', label: 'Level-Up-Channel' },
  { key: 'LEVEL_LOG_CHANNEL_ID', target: 'levelLogChannelId', kind: 'snowflake', label: 'XP-Protokoll' },
  {
    key: 'DECAY_LOG_CHANNEL_ID',
    target: 'decayLogChannelId',
    kind: 'snowflake',
    label: 'Inaktivitäts-Protokoll',
  },
  { key: 'NO_XP_ROLE_ID', target: 'noXpRoleId', kind: 'snowflake', label: 'Rolle ohne XP' },
  { key: 'PREMIUM_ROLE_ID', target: 'premiumRoleId', kind: 'snowflake', label: 'Premium-Rolle' },

  { key: 'XP_PER_MESSAGE', target: 'xpPerMessage', kind: 'integer', label: 'XP pro Nachricht' },
  {
    key: 'MESSAGE_XP_COOLDOWN_SECONDS',
    target: 'messageCooldownSeconds',
    kind: 'integer',
    label: 'Cooldown für Nachrichten',
  },
  {
    key: 'PREMIUM_MESSAGE_XP_COOLDOWN_SECONDS',
    target: 'premiumMessageCooldownSeconds',
    kind: 'integer',
    label: 'Cooldown mit Premium-Rolle',
  },
  {
    key: 'PREMIUM_XP_MULTIPLIER',
    target: 'premiumXpMultiplier',
    kind: 'float',
    label: 'Premium-Multiplikator',
  },

  { key: 'XP_PER_VOICE_MINUTE', target: 'xpPerVoiceMinute', kind: 'integer', label: 'XP pro Voice-Minute' },
  {
    key: 'VOICE_ACTIVITY_TOUCH_INTERVAL_SECONDS',
    target: 'voiceActivityTouchIntervalSeconds',
    kind: 'integer',
    label: 'Aktivität im Voice auffrischen',
  },
  {
    key: 'SPECIAL_VOICE_CHANNEL_IDS',
    target: 'specialVoiceChannelIds',
    kind: 'snowflake-list',
    label: 'Kanäle mit Sonder-Multiplikator',
  },
  {
    key: 'SPECIAL_VOICE_MULTIPLIER',
    target: 'specialVoiceMultiplier',
    kind: 'float',
    label: 'Sonder-Multiplikator',
  },
  {
    key: 'STAGE_VOICE_CHANNEL_IDS',
    target: 'stageVoiceChannelIds',
    kind: 'snowflake-list',
    label: 'Bühnen-Kanäle',
  },
  {
    key: 'STAGE_VOICE_MULTIPLIER',
    target: 'stageVoiceMultiplier',
    kind: 'float',
    label: 'Bühnen-Multiplikator',
  },

  { key: 'DOT_GRACE_DAYS', target: 'decayGraceDays', kind: 'integer', label: 'Schonfrist' },
  { key: 'DOT_DECAY_DAY1_4', target: 'decayDay1To4', kind: 'integer', label: 'Abzug Tag 1 bis 4' },
  { key: 'DOT_DECAY_DAY5_24', target: 'decayDay5Plus', kind: 'integer', label: 'Abzug ab Tag 5' },
  {
    key: 'DOT_SWEEP_INTERVAL_SECONDS',
    target: 'decaySweepIntervalSeconds',
    kind: 'integer',
    label: 'Prüfintervall',
  },

  { key: 'MAX_LEVEL_TOTAL_XP', target: 'maxLevelTotalXp', kind: 'integer', label: 'XP für das Höchstlevel' },
  { key: 'BANNER_URL', target: 'cardBannerUrl', kind: 'text', label: 'Hintergrund der Levelkarte' },

  { key: 'MILESTONE_ROLES', target: null, kind: 'milestones', label: 'Meilenstein-Rollen' },
];

export interface EnvSettingCandidate {
  key: string;
  label: string;
  /** Zielfeld in den Einstellungen, `null` bei den Meilenstein-Rollen. */
  target: keyof LevelSettings | null;
  /** Der gelesene Wert, bereits umgewandelt. */
  value: string | number | string[] | null;
  /** Anzeigetext für die Vorschau. */
  display: string;
  valid: boolean;
  note?: string;
}

export interface EnvMilestone {
  level: number;
  roleId: string;
}

export interface LegacyEnvContents {
  settings: EnvSettingCandidate[];
  milestones: EnvMilestone[];
  /** Wie viele Zeilen es gab und wie viele davon überhaupt betrachtet wurden. */
  totalLines: number;
  consideredKeys: number;
  /** Namen, die nicht auf der Positivliste stehen - nur die Anzahl. */
  ignoredKeys: number;
}

const SNOWFLAKE = /^\d{17,20}$/u;

/**
 * Zerlegt eine `.env`-Datei in Name und Wert.
 *
 * Es wird nur das übliche `KEY=VALUE` erkannt; `export`-Präfixe und
 * Anführungszeichen werden entfernt. Es findet keine Auswertung statt -
 * insbesondere wird nichts ausgeführt und nichts ersetzt.
 */
export function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    let value = withoutExport.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function parseMilestones(raw: string): EnvMilestone[] {
  const result: EnvMilestone[] = [];
  for (const pair of raw.split(',')) {
    const [levelPart, rolePart] = pair.split(':', 2);
    const level = Number.parseInt((levelPart ?? '').trim(), 10);
    const roleId = (rolePart ?? '').trim();
    if (Number.isInteger(level) && level > 0 && SNOWFLAKE.test(roleId)) {
      result.push({ level, roleId });
    }
  }
  return result.sort((a, b) => a.level - b.level);
}

/** Liest die erlaubten Werte aus einer hochgeladenen `.env`. */
export function readLegacyEnv(data: Uint8Array): LegacyEnvContents {
  if (data.byteLength > MAX_ENV_BYTES) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross (maximal ${MAX_ENV_BYTES / 1024} KB).`,
    });
  }

  const content = Buffer.from(data).toString('utf8');
  const parsed = parseEnvFile(content);
  const totalLines = content.split(/\r?\n/u).length;

  const settings: EnvSettingCandidate[] = [];
  let milestones: EnvMilestone[] = [];
  let consideredKeys = 0;

  for (const mapping of ENV_WHITELIST) {
    const raw = parsed.get(mapping.key);
    if (raw === undefined || raw.trim() === '') {
      continue;
    }
    consideredKeys += 1;
    const value = raw.trim();

    switch (mapping.kind) {
      case 'snowflake': {
        const valid = SNOWFLAKE.test(value);
        settings.push({
          key: mapping.key,
          label: mapping.label,
          target: mapping.target,
          value: valid ? value : null,
          display: value,
          valid,
          note: valid ? undefined : 'Keine gültige Discord-ID.',
        });
        break;
      }
      case 'snowflake-list': {
        const ids = value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => SNOWFLAKE.test(entry));
        settings.push({
          key: mapping.key,
          label: mapping.label,
          target: mapping.target,
          value: ids,
          display: ids.length > 0 ? ids.join(', ') : '—',
          valid: ids.length > 0,
          note: ids.length > 0 ? undefined : 'Keine gültige Discord-ID enthalten.',
        });
        break;
      }
      case 'integer':
      case 'float': {
        const parsedNumber = mapping.kind === 'integer' ? Number.parseInt(value, 10) : Number(value);
        const valid = Number.isFinite(parsedNumber) && parsedNumber >= 0;
        settings.push({
          key: mapping.key,
          label: mapping.label,
          target: mapping.target,
          value: valid ? parsedNumber : null,
          display: value,
          valid,
          note: valid ? undefined : 'Keine gültige Zahl.',
        });
        break;
      }
      case 'text': {
        settings.push({
          key: mapping.key,
          label: mapping.label,
          target: mapping.target,
          value,
          display: value,
          valid: value.length <= 1000,
          note: value.length <= 1000 ? undefined : 'Der Wert ist zu lang.',
        });
        break;
      }
      case 'milestones': {
        milestones = parseMilestones(value);
        settings.push({
          key: mapping.key,
          label: mapping.label,
          target: null,
          value: milestones.map((entry) => `${entry.level}:${entry.roleId}`),
          display:
            milestones.length > 0
              ? milestones.map((entry) => `Level ${entry.level} → Rolle ${entry.roleId}`).join(', ')
              : '—',
          valid: milestones.length > 0,
          note: milestones.length > 0 ? undefined : 'Kein gültiges Paar "Level:Rollen-ID" gefunden.',
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    settings,
    milestones,
    totalLines,
    consideredKeys,
    // Nur die Anzahl - die Namen selbst werden nicht weitergereicht, damit
    // auch versehentlich nichts Vertrauliches in der Oberfläche landet.
    ignoredKeys: Math.max(0, parsed.size - consideredKeys),
  };
}
