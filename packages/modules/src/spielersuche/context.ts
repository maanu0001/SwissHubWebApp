import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { SPIELERSUCHE_MODULE_ID, type SpielersucheSettings } from './config';
import { parseAccentColor } from './embed';

/**
 * Laufzeitkonfiguration der Spielersuche.
 *
 * Alles, was Slash Command und Dashboard für eine Aktion brauchen, wird an
 * einer Stelle geladen. Die Werte kommen aus den Moduleinstellungen - eine
 * Änderung im Dashboard wirkt beim nächsten Aufruf, ohne Neustart des Bots.
 */
export interface SpielersucheContext {
  gateway: DiscordGateway;
  settings: SpielersucheSettings;
  accentColor: number;
  searchChannelId: string | null;
  voiceCategoryId: string | null;
}

export async function loadSpielersucheContext(
  gateway: DiscordGateway = defaultDiscord,
): Promise<SpielersucheContext> {
  const settings = await getModuleSettings<SpielersucheSettings>(SPIELERSUCHE_MODULE_ID);
  return {
    gateway,
    settings,
    accentColor: parseAccentColor(settings.accentColor),
    searchChannelId: settings.searchChannelId ?? null,
    voiceCategoryId: settings.voiceCategoryId ?? null,
  };
}
