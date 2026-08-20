import {
  EnvironmentError,
  assertServerEnv,
  discordMocksEnabled,
  listDeprecatedEnvKeys,
} from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { ensureBootstrapRoles } from '@swisshub/permissions';
import { importGuildFromEnvironment } from '@swisshub/modules';

const log = createLogger('web');

/**
 * Startprüfung der WebApp:
 *  1. Umgebungsvariablen validieren (Fail Fast mit klarer Meldung),
 *  2. abgelöste Variablen einmalig in die Datenbank übernehmen,
 *  3. Administratorrolle aus der Umgebung bootstrappen.
 */
async function bootstrap(): Promise<void> {
  try {
    assertServerEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      log.error(error.message);
    }
    throw error;
  }

  if (discordMocksEnabled()) {
    log.warn('DEV_MOCK_DISCORD ist aktiv - es werden Mock-Daten statt echter Discord-Daten verwendet.');
  }

  // Bestehende Installationen: Guild aus DISCORD_GUILD_ID übernehmen. Danach
  // ist die Datenbank massgeblich und die Variable kann entfallen.
  await importGuildFromEnvironment().catch((error: unknown) => {
    log.warn('Guild konnte nicht aus der Umgebung übernommen werden', { error });
    return false;
  });

  await ensureBootstrapRoles().catch((error: unknown) => {
    log.warn('Bootstrap der Administratorrolle übersprungen', { error });
  });

  const deprecated = listDeprecatedEnvKeys();
  if (deprecated.length > 0) {
    log.warn(
      'Abgelöste Umgebungsvariablen gesetzt - sie werden nur noch als Bootstrap verwendet und können nach der Einrichtung entfernt werden.',
      { keys: deprecated.map((entry) => entry.key) },
    );
  }

  registerShutdownHooks();
  log.info('SwissHub WebApp gestartet');
}

/**
 * Graceful Shutdown: Datenbankverbindungen sauber schliessen, damit beim
 * Deployment keine hängenden Verbindungen zurückbleiben.
 */
function registerShutdownHooks(): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info('Shutdown gestartet', { signal });
    void import('@swisshub/database')
      .then(({ disconnectDatabase }) => disconnectDatabase())
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

await bootstrap();
