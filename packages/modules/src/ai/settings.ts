import { z } from 'zod';
import { bumpConfigRevision, readConfigValue, revisionCache, writeConfigValue } from '@swisshub/database';
import { AI_INTEGRATION_ID, AI_MODEL_SUGGESTIONS, hasSecret } from '@swisshub/secrets';

/**
 * Die nicht geheimen Einstellungen der AI-Integration.
 *
 * Sie stehen in `SystemConfig` - demselben Speicher, in dem auch Guild,
 * Moduleinstellungen und Systemverhalten liegen. Ein eigener Speicher nur für
 * «Modell» und «Zeitlimit» wäre ein zweiter Ort mit demselben Zweck.
 *
 * Der Schlüssel selbst steht nicht hier, sondern verschlüsselt in
 * `IntegrationSecret`. Diese Trennung ist Absicht: was harmlos ist, soll man
 * lesen, kopieren und in einem Fehlerbericht zeigen können.
 */

export const AI_CONFIG_KEY = 'integration.ai';

export const aiSettingsSchema = z.object({
  /** Aus: kein Modul fragt ein Modell an, unabhängig von seinen Einstellungen. */
  enabled: z.boolean().default(false),
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  model: z.string().trim().min(1).max(120).default('claude-opus-5'),
  /** Leer = die Standardadresse des Anbieters. */
  baseUrl: z.string().trim().max(300).default(''),
  timeoutMs: z.number().int().min(1000).max(120_000).default(20_000),
  maxTokens: z.number().int().min(16).max(8192).default(256),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

const VORGABE: AiSettings = aiSettingsSchema.parse({});

export async function readAiSettings(): Promise<AiSettings> {
  return revisionCache(
    'integration-ai-settings',
    () => readConfigValue(AI_CONFIG_KEY, aiSettingsSchema, VORGABE),
    { maxAgeMs: 30_000 },
  );
}

export async function writeAiSettings(
  eingabe: Partial<AiSettings>,
  actorDiscordId?: string | null,
): Promise<AiSettings> {
  const bisher = await readAiSettings();
  const neu = aiSettingsSchema.parse({ ...bisher, ...eingabe });
  await writeConfigValue(AI_CONFIG_KEY, aiSettingsSchema, neu, actorDiscordId ?? null);
  await bumpConfigRevision('integration:ai', actorDiscordId ?? null);
  return neu;
}

/** Modellvorschläge des eingestellten Anbieters. */
export function modelSuggestions(provider: AiSettings['provider']): string[] {
  return AI_MODEL_SUGGESTIONS[provider] ?? [];
}

/**
 * Ist die AI benutzbar?
 *
 * Drei Bedingungen, und alle drei müssen erfüllt sein: eingeschaltet, ein
 * Modell gewählt, ein Schlüssel hinterlegt. Ein Modul soll das nicht selbst
 * zusammensetzen müssen - sonst prüft jedes ein bisschen anders.
 */
export async function aiUsable(): Promise<boolean> {
  const settings = await readAiSettings();
  if (!settings.enabled || settings.model.trim() === '') {
    return false;
  }
  return hasSecret(AI_INTEGRATION_ID, 'apiKey', { provider: settings.provider });
}
