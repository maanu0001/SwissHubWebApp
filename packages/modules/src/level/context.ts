import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { LEVEL_MODULE_ID, type LevelSettings } from './config';
import type { DecayRules } from './decay';

/**
 * Laufzeitkonfiguration des Level-Systems.
 *
 * Slash Command, Discord-Events und Dashboard laden hierüber dieselben Werte.
 * Eine Änderung im Dashboard wirkt beim nächsten Aufruf, ohne Neustart - der
 * alte Bot brauchte dafür eine neue `.env` und einen Neustart.
 */
export interface LevelContext {
  gateway: DiscordGateway;
  settings: LevelSettings;
  accentColor: number;
  decayRules: DecayRules;
  /** Channels ohne XP als Menge - der Abgleich passiert pro Nachricht. */
  noXpChannelIds: ReadonlySet<string>;
  /** Level, bei denen ein Aufstieg gemeldet wird. `null` = alle. */
  announceLevels: ReadonlySet<number> | null;
}

/** `#83060A` → `0x83060A`. Ungültige Angaben fallen auf Discord-Grau zurück. */
export function parseAccentColor(value: string): number {
  const match = /^#?([0-9A-Fa-f]{6})$/u.exec(value.trim());
  return match ? Number.parseInt(match[1]!, 16) : 0x2b2d31;
}

/**
 * Liste der anzukündigenden Level.
 *
 * Der Vorgänger legte sie als Textspalte ab und behandelte "leer" als
 * "alle Level ankündigen". Das bleibt so.
 */
export function parseAnnounceLevels(value: string): ReadonlySet<number> | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const levels = trimmed
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((level) => Number.isInteger(level) && level > 0);
  return levels.length > 0 ? new Set(levels) : null;
}

export function decayRulesFrom(settings: LevelSettings): DecayRules {
  return {
    graceDays: settings.decayGraceDays,
    day1To4: settings.decayDay1To4,
    day5Plus: settings.decayDay5Plus,
  };
}

export async function loadLevelContext(gateway: DiscordGateway = defaultDiscord): Promise<LevelContext> {
  const settings = await getModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  return {
    gateway,
    settings,
    accentColor: parseAccentColor(settings.accentColor),
    decayRules: decayRulesFrom(settings),
    noXpChannelIds: new Set(settings.noXpChannelIds),
    announceLevels: parseAnnounceLevels(settings.announceLevels),
  };
}
