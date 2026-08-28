import type { Client } from 'discord.js';
import { discordConfig } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { ai } from '@swisshub/modules';
import {
  DISCORD_INTEGRATION_ID,
  refreshIntegrationRuntimeIfChanged,
  validateBotToken,
  writeStatus,
} from '@swisshub/secrets';

const log = createLogger('bot:integrationen');

/**
 * Die zentrale Konfiguration im laufenden Bot nachziehen.
 *
 * Ändert jemand im Dashboard den Bot-Token, soll der Bot ihn übernehmen -
 * ohne Neubau des Abbilds, ohne Serverzugriff, ohne Neustart von Hand (§32).
 * Erkannt wird die Änderung an der Konfigurations-Revision: eine Zeile aus der
 * Datenbank, alle fünfzehn Sekunden. Genau derselbe Weg, über den der Bot auch
 * eine gewechselte Guild bemerkt - kein zweiter Mechanismus und kein Redis.
 *
 * ## Der Wiederverbindungsweg
 *
 * `client.destroy()` gefolgt von `client.login(neuesToken)` auf **derselben**
 * Instanz. discord.js sieht beim Verbinden, dass sich der Token geändert hat,
 * verwirft die alte Websocket-Verwaltung und baut eine neue auf. Die
 * Ereignisbehandler hängen am `Client`, nicht an der Verbindung - sie bleiben
 * also genau einmal registriert (§34). Ein zweiter `Client` hätte jeden
 * Handler ein zweites Mal bekommen, und jedes Ereignis wäre doppelt
 * verarbeitet worden.
 *
 * ## Was nicht passiert
 *
 * Eine funktionierende Verbindung wird nie für ein ungeprüftes Token
 * aufgegeben. Der neue Token wird zuerst bei Discord geprüft; erst wenn er
 * gültig ist, wird getrennt. Scheitert danach trotzdem der Login, kehrt der
 * Bot auf den alten Token zurück - es ist besser, mit dem alten Token online
 * zu sein als mit dem neuen offline (§16).
 */

/** So oft wird nachgesehen. Eine Zeile, günstig genug für diesen Takt. */
export const INTEGRATION_POLL_MS = 15_000;

let laeuft = false;

interface Zustand {
  /** Der Token, mit dem die aktuelle Verbindung aufgebaut wurde. */
  aktiv: string | null;
}

export interface IntegrationWatch {
  stop(): void;
  /** Nur für Tests und den Start - prüft sofort statt beim nächsten Takt. */
  pruefeJetzt(): Promise<void>;
}

export function startIntegrationWatch(
  client: Client,
  options: { anfangsToken: string | null; verbinden?: boolean } = { anfangsToken: null },
): IntegrationWatch {
  const zustand: Zustand = { aktiv: options.anfangsToken };

  const pruefeJetzt = async (): Promise<void> => {
    if (laeuft) {
      return;
    }
    laeuft = true;
    try {
      const geaendert = await refreshIntegrationRuntimeIfChanged();
      if (!geaendert) {
        return;
      }

      // Ein gewechselter AI-Schlüssel oder ein anderes Modell soll sofort
      // greifen - der zwischengespeicherte Zugang hielte sonst den alten.
      ai.resetAiClients();

      if (options.verbinden === false) {
        return;
      }

      const neuerToken = discordConfig.botToken;
      if (!neuerToken || neuerToken === zustand.aktiv) {
        return;
      }

      log.info('Bot-Token wurde geändert - Verbindung wird erneuert');
      const geprueft = await validateBotToken(neuerToken);
      if (!geprueft.ok) {
        // Nicht trennen. Der bestehende Token funktioniert; der neue nicht.
        log.error('Der neue Bot-Token wurde von Discord abgelehnt - die bestehende Verbindung bleibt', {
          grund: geprueft.fehler,
        });
        await writeStatus(
          DISCORD_INTEGRATION_ID,
          'ERROR',
          geprueft.fehler ?? 'Der neue Token wurde abgelehnt.',
        );
        return;
      }

      await verbindeNeu(client, neuerToken, zustand);
    } catch (error) {
      log.error('Nachziehen der Integrationen fehlgeschlagen', { error });
    } finally {
      laeuft = false;
    }
  };

  const timer = setInterval(() => void pruefeJetzt(), INTEGRATION_POLL_MS);
  // Der Takt darf den Prozess nicht am Beenden hindern.
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    pruefeJetzt,
  };
}

async function verbindeNeu(client: Client, neuerToken: string, zustand: Zustand): Promise<void> {
  const alterToken = zustand.aktiv;

  await client.destroy().catch((error: unknown) => {
    log.warn('Die alte Verbindung liess sich nicht sauber schliessen', { error });
  });

  try {
    await client.login(neuerToken);
    zustand.aktiv = neuerToken;
    log.info('Bot mit dem neuen Token verbunden');
    await writeStatus(DISCORD_INTEGRATION_ID, 'CONNECTED', 'Mit dem hinterlegten Token verbunden.');
    return;
  } catch (error) {
    log.error('Anmeldung mit dem neuen Token fehlgeschlagen', { error });
  }

  if (!alterToken) {
    await writeStatus(
      DISCORD_INTEGRATION_ID,
      'ERROR',
      'Die Anmeldung mit dem neuen Token ist fehlgeschlagen.',
    );
    return;
  }

  // Rückweg: lieber mit dem alten Token online als mit dem neuen offline.
  try {
    await client.destroy().catch(() => undefined);
    await client.login(alterToken);
    zustand.aktiv = alterToken;
    log.warn('Zurück auf den vorherigen Bot-Token - der neue liess sich nicht verwenden');
    await writeStatus(
      DISCORD_INTEGRATION_ID,
      'DEGRADED',
      'Der neue Token liess sich nicht verwenden; es gilt weiterhin der vorherige.',
    );
  } catch (error) {
    log.error('Auch der vorherige Token funktioniert nicht mehr', { error });
    await writeStatus(DISCORD_INTEGRATION_ID, 'ERROR', 'Der Bot ist nicht mehr mit Discord verbunden.');
  }
}
