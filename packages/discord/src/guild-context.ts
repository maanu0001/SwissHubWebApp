import { env } from '@swisshub/config';
import { AppError } from '@swisshub/shared';

/**
 * Aktive Guild.
 *
 * Die Guild-ID steht nach dem Setup in der Datenbank. Das Discord-Paket darf
 * die Datenbank nicht kennen (Abhängigkeitsrichtung), deshalb wird ein Resolver
 * injiziert: `@swisshub/modules` registriert beim Import eine Funktion, die die
 * ID aus `GuildConfig` liest. Ohne Resolver greift die - inzwischen optionale -
 * Umgebungsvariable als Bootstrap.
 */
export type GuildIdResolver = () => Promise<string | null>;

let resolver: GuildIdResolver | null = null;
let cached: { value: string; resolvedAt: number } | null = null;

/** Wie lange eine aufgelöste Guild-ID wiederverwendet wird. */
const CACHE_TTL_MS = 10_000;

export function setGuildIdResolver(next: GuildIdResolver | null): void {
  resolver = next;
  cached = null;
}

/** Verwirft die zwischengespeicherte Guild-ID (z.B. nach dem Setup). */
export function clearGuildIdCache(): void {
  cached = null;
}

/** Guild-ID aus der Umgebung - Bootstrap vor dem ersten Setup. */
export function bootstrapGuildId(): string | null {
  return env.DISCORD_GUILD_ID ?? null;
}

/**
 * Liefert die aktive Guild-ID.
 * Reihenfolge: Datenbank (Resolver) -> Umgebungsvariable -> Fehler.
 */
export async function resolveGuildId(): Promise<string> {
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const fromDatabase = resolver ? await resolver().catch(() => null) : null;
  const value = fromDatabase ?? bootstrapGuildId();

  if (!value) {
    throw new AppError('CONFIGURATION_MISSING', {
      userMessage:
        'Es ist noch kein Discord-Server verbunden. Bitte den Einrichtungsassistenten abschliessen.',
      internalMessage: 'Weder GuildConfig noch DISCORD_GUILD_ID liefern eine Guild-ID.',
    });
  }

  cached = { value, resolvedAt: Date.now() };
  return value;
}

/** Wie `resolveGuildId`, gibt aber `null` statt eines Fehlers zurück. */
export async function tryResolveGuildId(): Promise<string | null> {
  try {
    return await resolveGuildId();
  } catch {
    return null;
  }
}
