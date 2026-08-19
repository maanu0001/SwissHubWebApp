import { z } from 'zod';
import { branding } from '@swisshub/config';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { readConfigValue, writeConfigValue } from '@swisshub/database';

/**
 * Kernkonfiguration der Anwendung (in `SystemConfig` gespeichert).
 *
 * Hochkritische Secrets (Bot Token, Client Secret) sind hier bewusst NICHT
 * enthalten - sie gehoeren ausschliesslich in Environment Variables.
 */
export const coreSettingsSchema = z.object({
  /** Zentrales Moderations-Log auf Discord. */
  moderationLogChannelId: optionalSnowflakeSchema,
  /** Zeitzone fuer die Darstellung. */
  timezone: z.string().min(3).max(64).default(branding.timezone),
  /** Discord IDs in Listen anzeigen. */
  showDiscordIds: z.boolean().default(true),
  /** Maximale Trefferzahl der Mitgliedersuche. */
  memberSearchLimit: z.number().int().min(5).max(100).default(25),
});

export type CoreSettings = z.infer<typeof coreSettingsSchema>;

export const CORE_SETTINGS_KEY = 'core.settings';

export const defaultCoreSettings: CoreSettings = coreSettingsSchema.parse({});

export async function getCoreSettings(): Promise<CoreSettings> {
  return readConfigValue(CORE_SETTINGS_KEY, coreSettingsSchema, defaultCoreSettings);
}

export async function setCoreSettings(values: unknown, updatedBy: string): Promise<CoreSettings> {
  return writeConfigValue(CORE_SETTINGS_KEY, coreSettingsSchema, values, updatedBy);
}
