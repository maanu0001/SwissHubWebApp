import { createLogger } from '@swisshub/logger';
import { INTEGRATIONS, envKeysFor, getIntegration } from './catalog';
import { hasSecret, setSecret } from './store';

const logger = createLogger('secrets:env-import');

/**
 * Übernahme bestehender Umgebungsvariablen (§40-§43).
 *
 * Der Wert wird serverseitig gelesen, verschlüsselt und abgelegt. Er verlässt
 * den Server dabei nie: die Oberfläche erfährt ausschliesslich, *dass* ein
 * Wert vorhanden ist, und bekommt nach der Übernahme die Maske zurück (§41).
 *
 * Mehrfaches Ausführen ist harmlos (§42): was in der Datenbank steht, wird
 * nicht überschrieben - es sei denn, jemand verlangt es ausdrücklich. Der
 * einfache Knopf überschreibt nie, denn der Wert in der Datenbank ist die
 * neuere Entscheidung.
 *
 * Die `.env` wird nicht angefasst (§43). Eine Datei zu verändern, die dem
 * Betrieb gehört, wäre ein Übergriff; das Dashboard sagt nur, was dort noch
 * steht und entfernt werden kann.
 */

export interface EnvKandidat {
  integrationId: string;
  integrationLabel: string;
  key: string;
  fieldLabel: string;
  /** Name der Umgebungsvariablen - kein Geheimnis. */
  envKey: string;
  /** Steht bereits ein Wert in der Datenbank? */
  inDatabase: boolean;
  secret: boolean;
}

/**
 * Was sich übernehmen liesse.
 *
 * Enthält Namen, nie Werte. Diese Liste geht direkt an den Browser.
 */
export async function listEnvCandidates(
  source: NodeJS.ProcessEnv = process.env,
): Promise<EnvKandidat[]> {
  const treffer: EnvKandidat[] = [];

  for (const integration of INTEGRATIONS) {
    for (const feld of integration.fields) {
      const envKeys = envKeysFor(integration.id, feld.key);
      const gesetzt = envKeys.find((name) => {
        const wert = source[name];
        return typeof wert === 'string' && wert.trim() !== '';
      });
      if (!gesetzt) {
        continue;
      }
      treffer.push({
        integrationId: integration.id,
        integrationLabel: integration.label,
        key: feld.key,
        fieldLabel: feld.label,
        envKey: gesetzt,
        inDatabase: await inDatenbank(integration.id, feld.key),
        secret: feld.secret,
      });
    }
  }
  return treffer;
}

/**
 * Steht der Wert bereits in der Datenbank?
 *
 * Bewusst nicht `hasSecret`: das würde die Umgebung mitzählen und damit
 * immer `true` liefern - jede Übernahme sähe dann aus, als wäre sie schon
 * geschehen.
 */
async function inDatenbank(integrationId: string, key: string): Promise<boolean> {
  const { prisma } = await import('@swisshub/database');
  const definition = getIntegration(integrationId);
  const zeile = await prisma.integrationSecret
    .findFirst({
      where: {
        provider: integrationId,
        key,
        scope: definition?.scope === 'GUILD' ? 'GUILD' : 'GLOBAL',
      },
      select: { id: true },
    })
    .catch(() => null);
  return zeile !== null;
}

export interface ImportErgebnis {
  uebernommen: string[];
  uebersprungen: string[];
  fehlgeschlagen: Array<{ feld: string; grund: string }>;
}

/**
 * Übernimmt die genannten Felder aus der Umgebung.
 *
 * `ueberschreiben` ist die ausdrückliche Bestätigung aus §42. Ohne sie bleibt
 * ein vorhandener Datenbankwert stehen und das Feld erscheint unter
 * «übersprungen» - der Aufrufer sieht also, dass nichts geschehen ist.
 */
export async function importFromEnvironment(
  felder: Array<{ integrationId: string; key: string }>,
  options: { actorDiscordId?: string | null; ueberschreiben?: boolean } = {},
  source: NodeJS.ProcessEnv = process.env,
): Promise<ImportErgebnis> {
  const ergebnis: ImportErgebnis = { uebernommen: [], uebersprungen: [], fehlgeschlagen: [] };

  for (const feld of felder) {
    const bezeichnung = `${feld.integrationId}.${feld.key}`;
    const envKeys = envKeysFor(feld.integrationId, feld.key);
    const name = envKeys.find((key) => {
      const wert = source[key];
      return typeof wert === 'string' && wert.trim() !== '';
    });

    if (!name) {
      ergebnis.fehlgeschlagen.push({ feld: bezeichnung, grund: 'In der Umgebung nicht gesetzt.' });
      continue;
    }
    if (!options.ueberschreiben && (await inDatenbank(feld.integrationId, feld.key))) {
      ergebnis.uebersprungen.push(bezeichnung);
      continue;
    }

    const wert = source[name] as string;
    try {
      await setSecret(feld.integrationId, feld.key, wert, {
        actorDiscordId: options.actorDiscordId ?? null,
      });
      ergebnis.uebernommen.push(bezeichnung);
      // Ausdruecklich ohne den Wert - nur der Name der Variablen.
      logger.info('Wert aus der Umgebung übernommen', { feld: bezeichnung, envKey: name });
    } catch (error) {
      logger.warn('Übernahme fehlgeschlagen', { feld: bezeichnung, error });
      ergebnis.fehlgeschlagen.push({
        feld: bezeichnung,
        grund: 'Der Wert liess sich nicht speichern.',
      });
    }
  }

  return ergebnis;
}

/**
 * Umgebungsvariablen, die nach der Übernahme entfernt werden können (§43).
 *
 * Nur Namen. Die Datei wird nicht angefasst - hier steht bloss, was
 * überflüssig geworden ist.
 */
export async function removableEnvKeys(
  source: NodeJS.ProcessEnv = process.env,
): Promise<Array<{ envKey: string; feld: string }>> {
  const kandidaten = await listEnvCandidates(source);
  return kandidaten
    .filter((kandidat) => kandidat.inDatabase)
    .map((kandidat) => ({
      envKey: kandidat.envKey,
      feld: `${kandidat.integrationLabel} → ${kandidat.fieldLabel}`,
    }));
}

/** Wird von der Startprüfung benutzt - hat ein Feld überhaupt eine Quelle? */
export async function feldVorhanden(integrationId: string, key: string): Promise<boolean> {
  return hasSecret(integrationId, key);
}
