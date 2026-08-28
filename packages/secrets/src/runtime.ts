import { readConfigRevision } from '@swisshub/database';
import { setRuntimeConfigValues } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { INTEGRATIONS, botProvider, BOT_TOKEN_FIELD } from './catalog';
import { dropSecretCache, getSecret } from './store';
import { listBots } from './bots';

const logger = createLogger('secrets:runtime');

/**
 * Die Brücke zwischen Datenbank und den synchronen Zugriffen im Code.
 *
 * `discordConfig.botToken` ist ein Getter ohne `await` - und das soll so
 * bleiben, sonst müsste jede Aufrufstelle umgebaut werden. Also wird die
 * Ablage in `@swisshub/config` einmal beim Start und danach bei jeder
 * Änderung gefüllt. Erkannt wird eine Änderung an der
 * Konfigurations-Revision: derselbe Zähler, an dem auch Rollen und
 * Moduleinstellungen hängen.
 *
 * Bewusst kein Redis und kein zweiter Kanal (§30/§31): entschlüsselte Werte
 * bleiben im Speicher des Prozesses, der sie braucht. Was in Redis läge,
 * läge auf einer weiteren Maschine.
 */

let letzteRevision: bigint | null = null;
let laeuft: Promise<void> | null = null;

/** Wird nach jeder Übernahme aufgerufen - z.B. um den Bot neu zu verbinden. */
type Beobachter = (geaendert: Set<string>) => void | Promise<void>;
const beobachter = new Set<Beobachter>();

export function onIntegrationsChanged(beobachterFn: Beobachter): () => void {
  beobachter.add(beobachterFn);
  return () => beobachter.delete(beobachterFn);
}

function schluessel(integrationId: string, key: string): string {
  return `${integrationId}.${key}`;
}

/**
 * Alle geheimen Felder in die Ablage übernehmen.
 *
 * Nicht geheime Werte (Modell, Base URL, Zeitlimit) stehen weiterhin in
 * `SystemConfig` und werden dort gelesen - sie brauchen keine Ablage, weil
 * ihre Leser ohnehin `await` können.
 */
async function uebernehmen(): Promise<Set<string>> {
  const werte: Record<string, string | null> = {};

  for (const integration of INTEGRATIONS) {
    for (const feld of integration.fields) {
      if (!feld.secret && !feld.envKey) {
        continue;
      }
      werte[schluessel(integration.id, feld.key)] = await getSecret(integration.id, feld.key).catch(
        () => null,
      );
    }
  }

  // Bot-Tokens: ein Anbieter je Bot, damit sich einer austauschen laesst,
  // ohne die uebrigen anzufassen.
  const bots = await listBots().catch(() => []);
  for (const bot of bots) {
    werte[schluessel(botProvider(bot.id), BOT_TOKEN_FIELD)] = await getSecret(
      botProvider(bot.id),
      BOT_TOKEN_FIELD,
    ).catch(() => null);
  }

  setRuntimeConfigValues(werte);
  return new Set(Object.keys(werte).filter((key) => werte[key] !== null));
}

/**
 * Übernimmt die zentrale Konfiguration in den laufenden Prozess.
 *
 * Mehrfachaufrufe sind zusammengefasst: zwei gleichzeitige Anfragen lesen
 * nicht zweimal, sondern warten auf denselben Durchlauf.
 */
export async function refreshIntegrationRuntime(options: { force?: boolean } = {}): Promise<void> {
  if (laeuft) {
    return laeuft;
  }
  laeuft = (async () => {
    try {
      if (options.force) {
        dropSecretCache();
      }
      const geaendert = await uebernehmen();
      letzteRevision = await readConfigRevision({ force: true }).catch(() => letzteRevision);
      for (const fn of beobachter) {
        await Promise.resolve(fn(geaendert)).catch((error: unknown) => {
          logger.warn('Beobachter der Integrationen ist gescheitert', { error });
        });
      }
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}

/**
 * Hat sich die Konfiguration seit der letzten Übernahme geändert?
 *
 * Eine Zeile aus der Datenbank; wird vom Bot regelmässig und von der WebApp
 * bei Bedarf gefragt. Fällt die Abfrage aus, bleibt der bisherige Stand
 * bestehen - eine verlorene Verbindung ist kein Grund, ein funktionierendes
 * Token wegzuwerfen.
 */
export async function refreshIntegrationRuntimeIfChanged(): Promise<boolean> {
  const revision = await readConfigRevision({ force: true }).catch(() => null);
  if (revision === null || revision === letzteRevision) {
    return false;
  }
  dropSecretCache();
  await refreshIntegrationRuntime();
  return true;
}

/** Nur für Tests. */
export function resetIntegrationRuntime(): void {
  letzteRevision = null;
  beobachter.clear();
}
