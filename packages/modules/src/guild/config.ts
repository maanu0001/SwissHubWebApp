import { bumpConfigRevision, prisma, revisionCache } from '@swisshub/database';
import { bootstrapGuildId, clearGuildIdCache, discord, setGuildIdResolver } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, snowflakeSchema } from '@swisshub/shared';
import type { GuildConfig } from '@swisshub/database';

const log = createLogger('guild:config');

const SINGLETON = 'singleton';
const CACHE_KEY = 'guild:config';

/**
 * Guild-Konfiguration.
 *
 * Nach dem Einrichtungsassistenten steht die verbundene Guild in der Datenbank -
 * `DISCORD_GUILD_ID` dient nur noch als Bootstrap für den allerersten Start.
 */
export interface GuildConfigView {
  guildId: string | null;
  name: string | null;
  iconHash: string | null;
  ownerId: string | null;
  memberCount: number | null;
  presenceCount: number | null;
  lastSyncedAt: Date | null;
  setupCompletedAt: Date | null;
  setupCompletedBy: string | null;
  /** True, wenn die Guild nur aus der Umgebungsvariable stammt. */
  fromBootstrapEnv: boolean;
}

const EMPTY: GuildConfigView = {
  guildId: null,
  name: null,
  iconHash: null,
  ownerId: null,
  memberCount: null,
  presenceCount: null,
  lastSyncedAt: null,
  setupCompletedAt: null,
  setupCompletedBy: null,
  fromBootstrapEnv: false,
};

function toView(row: GuildConfig | null): GuildConfigView {
  if (!row) {
    const fallback = bootstrapGuildId();
    return fallback ? { ...EMPTY, guildId: fallback, fromBootstrapEnv: true } : EMPTY;
  }
  return {
    guildId: row.guildId,
    name: row.name,
    iconHash: row.iconHash,
    ownerId: row.ownerId,
    memberCount: row.memberCount,
    presenceCount: row.presenceCount,
    lastSyncedAt: row.lastSyncedAt,
    setupCompletedAt: row.setupCompletedAt,
    setupCompletedBy: row.setupCompletedBy,
    fromBootstrapEnv: false,
  };
}

/** Aktuelle Guild-Konfiguration (revisionsbasiert zwischengespeichert). */
export async function getGuildConfig(options: { force?: boolean } = {}): Promise<GuildConfigView> {
  return revisionCache(
    CACHE_KEY,
    async () => toView(await prisma.guildConfig.findUnique({ where: { id: SINGLETON } })),
    { maxAgeMs: 30_000, force: options.force },
  );
}

export async function isSetupComplete(): Promise<boolean> {
  const config = await getGuildConfig();
  return config.setupCompletedAt !== null;
}

export interface ConnectGuildInput {
  guildId: string;
  name?: string | null;
  iconHash?: string | null;
  ownerId?: string | null;
  memberCount?: number | null;
  presenceCount?: number | null;
  updatedBy?: string | null;
}

/**
 * Verbindet die Anwendung mit einer Guild.
 *
 * Die Guild muss eine sein, in der der Bot tatsächlich Mitglied ist - sonst
 * liesse sich über einen manipulierten Request eine fremde Guild eintragen.
 */
export async function connectGuild(input: ConnectGuildInput): Promise<GuildConfigView> {
  const guildId = snowflakeSchema.parse(input.guildId);

  const available = await discord.guild.listBotGuilds().catch(() => null);
  if (available && !available.some((guild) => guild.id === guildId)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Der Bot ist auf diesem Discord-Server nicht Mitglied. Bitte den Bot zuerst einladen.',
      internalMessage: `Guild ${guildId} ist nicht in der Bot-Guild-Liste enthalten.`,
    });
  }
  const match = available?.find((guild) => guild.id === guildId);

  const data = {
    guildId,
    name: input.name ?? match?.name ?? null,
    iconHash: input.iconHash ?? match?.iconHash ?? null,
    ownerId: input.ownerId ?? null,
    memberCount: input.memberCount ?? match?.memberCount ?? null,
    presenceCount: input.presenceCount ?? null,
  };

  const row = await prisma.guildConfig.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, ...data },
    update: data,
  });

  clearGuildIdCache();
  await bumpConfigRevision('guild.connected', input.updatedBy);
  log.info('Guild verbunden', { guildId, name: data.name });
  return toView(row);
}

/** Aktualisiert die Metadaten der Guild (wird vom Sync-Service aufgerufen). */
export async function updateGuildMetadata(input: {
  name?: string | null;
  iconHash?: string | null;
  ownerId?: string | null;
  memberCount?: number | null;
  presenceCount?: number | null;
  lastSyncedAt?: Date;
}): Promise<void> {
  const existing = await prisma.guildConfig.findUnique({ where: { id: SINGLETON } });
  if (!existing) {
    return;
  }
  await prisma.guildConfig.update({ where: { id: SINGLETON }, data: input });
}

/** Schliesst den Einrichtungsassistenten ab. */
export async function completeSetup(discordId: string): Promise<GuildConfigView> {
  const config = await getGuildConfig({ force: true });
  if (!config.guildId) {
    throw new AppError('CONFIGURATION_MISSING', {
      userMessage: 'Es ist noch kein Discord-Server verbunden.',
    });
  }

  const row = await prisma.guildConfig.update({
    where: { id: SINGLETON },
    data: { setupCompletedAt: new Date(), setupCompletedBy: discordId },
  });

  await bumpConfigRevision('setup.completed', discordId);
  log.info('Einrichtung abgeschlossen', { by: discordId });
  return toView(row);
}

/**
 * Registriert den Guild-Resolver im Discord-Paket.
 *
 * Dadurch löst jeder Discord-Aufruf die Guild aus der Datenbank auf, ohne dass
 * `@swisshub/discord` die Datenbank kennen muss.
 */
export function registerGuildResolver(): void {
  setGuildIdResolver(async () => {
    const config = await getGuildConfig();
    return config.guildId;
  });
}

/**
 * Übernimmt eine per Umgebungsvariable vorgegebene Guild einmalig in die
 * Datenbank (Migration bestehender Installationen).
 */
export async function importGuildFromEnvironment(): Promise<boolean> {
  const fallback = bootstrapGuildId();
  if (!fallback) {
    return false;
  }
  const existing = await prisma.guildConfig.findUnique({ where: { id: SINGLETON } });
  if (existing) {
    return false;
  }

  await prisma.guildConfig.create({ data: { id: SINGLETON, guildId: fallback } });
  clearGuildIdCache();
  await bumpConfigRevision('guild.imported-from-env');
  log.info('Guild aus DISCORD_GUILD_ID übernommen', { guildId: fallback });
  return true;
}
