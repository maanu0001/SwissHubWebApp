import { createLogger } from '@swisshub/logger';
import { INTEGRATIONS } from './catalog';
import { hasMasterKey } from './crypto';
import { hasSecret } from './store';
import { refreshIntegrationRuntime } from './runtime';

const logger = createLogger('secrets:startup');

/**
 * Prüfung beim Start (§44).
 *
 * Die Regel dahinter: **Pflicht bricht ab, Kür wird gemeldet.** Ohne
 * Bot-Token gibt es nichts zu tun, und ein Bot, der wortlos ohne Verbindung
 * weiterläuft, ist schlimmer als einer, der sich beschwert. Eine fehlende
 * AI-Konfiguration dagegen ist ein völlig gültiger Zustand - deswegen darf
 * die WebApp nicht stehenbleiben.
 */

export interface IntegrationsBericht {
  masterKey: boolean;
  eintraege: Array<{
    integrationId: string;
    label: string;
    essential: boolean;
    fehlend: string[];
    vollstaendig: boolean;
  }>;
  /** Fehlt etwas, ohne das nichts läuft? */
  blockiert: boolean;
}

export async function checkIntegrations(): Promise<IntegrationsBericht> {
  const eintraege: IntegrationsBericht['eintraege'] = [];

  for (const integration of INTEGRATIONS) {
    const pflichtfelder = integration.fields.filter((feld) => feld.required);
    const fehlend: string[] = [];
    for (const feld of pflichtfelder) {
      if (!(await hasSecret(integration.id, feld.key).catch(() => false))) {
        fehlend.push(feld.label);
      }
    }
    eintraege.push({
      integrationId: integration.id,
      label: integration.label,
      essential: integration.essential,
      fehlend,
      vollstaendig: fehlend.length === 0,
    });
  }

  return {
    masterKey: hasMasterKey(),
    eintraege,
    blockiert: eintraege.some((eintrag) => eintrag.essential && !eintrag.vollstaendig),
  };
}

/**
 * Zentrale Konfiguration laden und den Zustand melden.
 *
 * `strikt` ist für den Bot: fehlt dort das Token, hat der Prozess keinen
 * Zweck. Die WebApp ruft ohne `strikt` auf - sie soll gerade dann erreichbar
 * sein, wenn etwas fehlt, denn dort trägt man es nach.
 */
export async function assertIntegrationsReady(
  options: { strikt?: boolean } = {},
): Promise<IntegrationsBericht> {
  await refreshIntegrationRuntime({ force: true }).catch((error: unknown) => {
    logger.error('Zentrale Zugangsdaten konnten nicht geladen werden', { error });
  });

  const bericht = await checkIntegrations();

  if (!bericht.masterKey) {
    logger.warn(
      'MASTER_ENCRYPTION_KEY ist nicht gesetzt - Zugangsdaten lassen sich weder speichern noch lesen. Es gilt ausschliesslich, was in der Umgebung steht.',
    );
  }

  for (const eintrag of bericht.eintraege) {
    if (eintrag.vollstaendig) {
      continue;
    }
    const meldung = `Integration «${eintrag.label}» unvollständig: ${eintrag.fehlend.join(', ')}`;
    if (eintrag.essential) {
      logger.error(meldung);
    } else {
      logger.info(`${meldung} (optional)`);
    }
  }

  if (options.strikt && bericht.blockiert) {
    const fehlend = bericht.eintraege
      .filter((eintrag) => eintrag.essential && !eintrag.vollstaendig)
      .map((eintrag) => `${eintrag.label}: ${eintrag.fehlend.join(', ')}`)
      .join(' | ');
    throw new Error(
      `Pflichtangaben fehlen (${fehlend}). Sie werden unter System → Integrationen gepflegt oder übergangsweise in .env gesetzt.`,
    );
  }

  return bericht;
}
