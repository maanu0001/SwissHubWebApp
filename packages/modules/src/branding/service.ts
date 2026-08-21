import { z } from 'zod';
import { DEFAULT_SWISSHUB_LOGO } from '@swisshub/config';
import {
  AUDIT_ACTIONS,
  bumpConfigRevision,
  readConfigValue,
  revisionCache,
  safeRecordAudit,
  writeConfigValue,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { deleteUpload, storeLogoUpload } from './storage';

const log = createLogger('branding');

/**
 * Branding der WebApp.
 *
 * In der Datenbank steht nur die Referenz auf die Datei - nie das Bild selbst.
 * Ein Base64-Blob in der Konfiguration würde jede Abfrage aufblähen und wäre
 * in Logs und Exporten unangenehm.
 */
export const BRANDING_CONFIG_KEY = 'branding.logo';
const CACHE_KEY = 'branding:logo';

export const brandingConfigSchema = z.object({
  /** Dateiname im Upload-Verzeichnis. `null` = Standardlogo. */
  logoPath: z.string().max(200).nullable().default(null),
  /** Cache-Busting-Parameter, wechselt bei jedem Upload. */
  version: z.string().max(64).nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
  updatedBy: z.string().max(32).nullable().default(null),
});

export type BrandingConfig = z.infer<typeof brandingConfigSchema>;

const DEFAULT_BRANDING: BrandingConfig = brandingConfigSchema.parse({});

/** Aktuelle Branding-Konfiguration (revisionsbasiert zwischengespeichert). */
export async function getBrandingConfig(options: { force?: boolean } = {}): Promise<BrandingConfig> {
  return revisionCache(
    CACHE_KEY,
    async () => readConfigValue(BRANDING_CONFIG_KEY, brandingConfigSchema, DEFAULT_BRANDING),
    { maxAgeMs: 60_000, force: options.force },
  );
}

/**
 * URL des aktuellen Logos.
 *
 * Der Versionsparameter sorgt dafür, dass Browser nach einem Wechsel nicht das
 * alte Bild aus dem Cache zeigen. Ohne eigenes Logo wird das mitgelieferte
 * SwissHub-Logo aus `public/branding/` verwendet - das Standardlogo steht
 * bewusst nur hier, damit es keine Seite selbst wählen muss.
 */
export function brandingLogoUrl(config: BrandingConfig, fallback: string = DEFAULT_SWISSHUB_LOGO): string {
  if (!config.logoPath) {
    return fallback;
  }
  return `/api/branding/logo?v=${encodeURIComponent(config.version ?? '1')}`;
}

/** Das aktuell gültige Logo - hochgeladenes Logo, sonst das Standardlogo. */
export async function currentLogoUrl(): Promise<string> {
  return brandingLogoUrl(await getBrandingConfig());
}

export interface BrandingActor {
  discordId: string;
  username: string;
}

/** Speichert ein neues Logo und entfernt das bisherige. */
export async function updateLogo(
  data: Uint8Array,
  mimeType: string | null,
  actor: BrandingActor,
): Promise<BrandingConfig> {
  const previous = await getBrandingConfig({ force: true });
  const stored = await storeLogoUpload(data, mimeType);

  const config = await writeConfigValue(
    BRANDING_CONFIG_KEY,
    brandingConfigSchema,
    {
      logoPath: stored.fileName,
      version: stored.version,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.discordId,
    },
    actor.discordId,
  );

  // Erst nach erfolgreichem Schreiben aufräumen - sonst stünde bei einem
  // Fehler weder das alte noch das neue Logo zur Verfügung.
  if (previous.logoPath && previous.logoPath !== stored.fileName) {
    await deleteUpload(previous.logoPath);
  }

  await bumpConfigRevision('branding.logo', actor.discordId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.BRANDING_LOGO_UPDATED,
    module: 'settings',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: {
      format: stored.format,
      bytes: stored.bytes,
      width: stored.width,
      height: stored.height,
    },
  });

  log.info('Logo aktualisiert', { by: actor.discordId, bytes: stored.bytes });
  return config;
}

/** Setzt auf das mitgelieferte Standardlogo zurück. */
export async function resetLogo(actor: BrandingActor): Promise<BrandingConfig> {
  const previous = await getBrandingConfig({ force: true });

  const config = await writeConfigValue(
    BRANDING_CONFIG_KEY,
    brandingConfigSchema,
    { logoPath: null, version: null, updatedAt: new Date().toISOString(), updatedBy: actor.discordId },
    actor.discordId,
  );

  if (previous.logoPath) {
    await deleteUpload(previous.logoPath);
  }

  await bumpConfigRevision('branding.logo', actor.discordId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.BRANDING_LOGO_RESET,
    module: 'settings',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { previous: previous.logoPath },
  });

  log.info('Logo zurückgesetzt', { by: actor.discordId });
  return config;
}
