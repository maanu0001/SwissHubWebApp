import { EnvironmentError, assertServerEnv, discordMocksEnabled } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { ensureBootstrapRoles } from '@swisshub/permissions';

const log = createLogger('web');

/**
 * Startprüfung der WebApp:
 *  1. Umgebungsvariablen validieren (Fail Fast mit klarer Meldung),
 *  2. Administratorrolle aus der Umgebung bootstrappen.
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

  await ensureBootstrapRoles().catch((error: unknown) => {
    log.warn('Bootstrap der Administratorrolle übersprungen', { error });
  });

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
