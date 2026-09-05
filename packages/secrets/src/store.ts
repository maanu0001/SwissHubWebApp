import { bumpConfigRevision, clearRevisionCaches, prisma, revisionCache } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict } from '@swisshub/shared';
import { decryptSecret, encryptSecret, hasMasterKey, maskSecret, type SecretAddress } from './crypto';
import {
  INTEGRATIONS,
  envKeysFor,
  getField,
  getIntegration,
  type IntegrationDefinition,
  type IntegrationScope,
} from './catalog';
import { registerSecretValue, forgetSecretValue } from './redaction';

const logger = createLogger('secrets');

/**
 * Zugriff auf die zentralen Zugangsdaten.
 *
 * Zwei Regeln tragen diese Datei:
 *
 * 1. **Klartext entsteht nur hier und wird nur zurückgegeben, wenn der
 *    Aufrufer ihn zum Verbinden braucht.** Alles, was eine Oberfläche oder
 *    eine API-Antwort erreicht, kommt aus `describe()` und enthält
 *    grundsätzlich keinen Wert - nur, dass etwas gesetzt ist, woher es kommt
 *    und wie es endet.
 * 2. **Die Datenbank gewinnt, die Umgebung ist der Rückfall.** In der
 *    Übergangszeit darf ein Wert noch aus `.env` stammen; sobald er im
 *    Dashboard hinterlegt wurde, wird die Umgebung nicht mehr befragt. So
 *    lässt sich umstellen, ohne eine laufende Verbindung zu verlieren.
 */

/** Woher ein Wert tatsächlich stammt. */
export type SecretOrigin = 'database' | 'environment' | 'default' | 'missing';

export interface SecretDescription {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  configured: boolean;
  origin: SecretOrigin;
  /** Nur bei Geheimnissen: `••••••••3X7A`. Sonst der Wert selbst. */
  display: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  /** Steht der Wert zusätzlich noch in der Umgebung? Grundlage für §43. */
  alsoInEnvironment: boolean;
}

function adresse(
  integrationId: string,
  key: string,
  scopeAndGuild: { scope: IntegrationScope; guildId: string },
): SecretAddress {
  return {
    scope: scopeAndGuild.scope,
    guildId: scopeAndGuild.guildId,
    provider: integrationId,
    key,
  };
}

function bereich(
  definition: IntegrationDefinition | undefined,
  guildId?: string | null,
): {
  scope: IntegrationScope;
  guildId: string;
} {
  if (definition?.scope === 'GUILD') {
    return { scope: 'GUILD', guildId: guildId ?? '' };
  }
  return { scope: 'GLOBAL', guildId: '' };
}

/** Nicht geheime Werte stehen als JSON in derselben Zeile - Feld `hint`. */
const CACHE_KEY = 'integration-secrets';

interface Zeile {
  provider: string;
  key: string;
  ciphertext: string;
  hint: string | null;
  scope: IntegrationScope;
  guildId: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Alle Zeilen auf einmal.
 *
 * Es sind wenige Dutzend, und der Cache hängt an der Konfigurations-Revision:
 * schreibt irgendein Prozess ein Geheimnis, erhöht sich die Revision und jeder
 * andere Prozess verwirft seine Kopie beim nächsten Blick. Genau derselbe
 * Mechanismus wie bei Rollen und Moduleinstellungen - kein zweiter dafür.
 */
async function ladeZeilen(force = false): Promise<Zeile[]> {
  return revisionCache<Zeile[]>(
    CACHE_KEY,
    async () =>
      prisma.integrationSecret.findMany({
        select: {
          provider: true,
          key: true,
          ciphertext: true,
          hint: true,
          scope: true,
          guildId: true,
          updatedAt: true,
          updatedBy: true,
        },
      }),
    { maxAgeMs: 30_000, force },
  );
}

function finde(zeilen: Zeile[], provider: string, key: string, guildId: string): Zeile | undefined {
  return zeilen.find(
    (zeile) => zeile.provider === provider && zeile.key === key && zeile.guildId === guildId,
  );
}

function ausUmgebung(integrationId: string, key: string, provider?: string): string | null {
  for (const envKey of envKeysFor(integrationId, key, provider)) {
    const wert = process.env[envKey];
    if (typeof wert === 'string' && wert.trim() !== '') {
      return wert;
    }
  }
  return null;
}

/**
 * Der entschlüsselte Wert - oder `null`.
 *
 * Ausschliesslich serverseitig aufrufen. Der Rückgabewert darf eine Server
 * Action, eine API-Antwort oder eine React-Eigenschaft niemals verlassen.
 */
export async function getSecret(
  integrationId: string,
  key: string,
  options: { guildId?: string | null; force?: boolean; provider?: string } = {},
): Promise<string | null> {
  const definition = getIntegration(integrationId);
  const ziel = bereich(definition, options.guildId);
  const zeilen = await ladeZeilen(options.force).catch((error: unknown) => {
    // Ohne Datenbank ist der Rückfall auf die Umgebung besser als gar nichts:
    // ein Bot, der wegen eines kurzen Datenbankausfalls sein Token verliert,
    // wäre schlechter als einer, der den alten Weg nimmt.
    logger.warn('Zugangsdaten konnten nicht gelesen werden - Rückfall auf die Umgebung', { error });
    return [] as Zeile[];
  });

  const zeile = finde(zeilen, integrationId, key, ziel.guildId);
  if (zeile) {
    const klartext = decryptSecret(zeile.ciphertext, adresse(integrationId, key, ziel));
    registerSecretValue(klartext);
    return klartext;
  }

  const ausEnv = ausUmgebung(integrationId, key, options.provider);
  if (ausEnv !== null) {
    registerSecretValue(ausEnv);
    return ausEnv;
  }
  return null;
}

export async function hasSecret(
  integrationId: string,
  key: string,
  options: { guildId?: string | null; provider?: string } = {},
): Promise<boolean> {
  const definition = getIntegration(integrationId);
  const ziel = bereich(definition, options.guildId);
  const zeilen = await ladeZeilen().catch(() => [] as Zeile[]);
  if (finde(zeilen, integrationId, key, ziel.guildId)) {
    return true;
  }
  return ausUmgebung(integrationId, key, options.provider) !== null;
}

export interface SetSecretOptions {
  guildId?: string | null;
  actorDiscordId?: string | null;
}

/**
 * Einen Wert hinterlegen.
 *
 * Der Klartext wird sofort verschlüsselt; in keiner Zwischenvariablen, keinem
 * Protokoll und keinem Rückgabewert steht er danach noch. Zurück kommt nur die
 * Maske.
 */
export async function setSecret(
  integrationId: string,
  key: string,
  klartext: string,
  options: SetSecretOptions = {},
): Promise<{ display: string }> {
  if (!hasMasterKey()) {
    throw conflict(
      'Es ist kein MASTER_ENCRYPTION_KEY gesetzt. Ohne ihn lassen sich keine Zugangsdaten speichern.',
    );
  }
  const definition = getIntegration(integrationId);
  const feld = getField(integrationId, key);
  const ziel = bereich(definition, options.guildId);
  const geheim = feld?.secret ?? true;

  const ciphertext = encryptSecret(klartext, adresse(integrationId, key, ziel));
  const hint = geheim ? maskSecret(klartext) : klartext.slice(0, 200);

  await prisma.integrationSecret.upsert({
    where: {
      scope_guildId_provider_key: {
        scope: ziel.scope,
        guildId: ziel.guildId,
        provider: integrationId,
        key,
      },
    },
    create: {
      scope: ziel.scope,
      guildId: ziel.guildId,
      provider: integrationId,
      key,
      ciphertext,
      hint,
      updatedBy: options.actorDiscordId ?? null,
    },
    update: {
      ciphertext,
      hint,
      version: { increment: 1 },
      updatedBy: options.actorDiscordId ?? null,
    },
  });

  registerSecretValue(klartext);
  await invalidate(`integration:${integrationId}.${key}`, options.actorDiscordId);
  return { display: hint };
}

export async function deleteSecret(
  integrationId: string,
  key: string,
  options: SetSecretOptions = {},
): Promise<boolean> {
  const definition = getIntegration(integrationId);
  const ziel = bereich(definition, options.guildId);

  // Vor dem Löschen den alten Wert aus der Schwärzungsliste nehmen: er ist
  // danach nicht mehr in Gebrauch, und eine ewig wachsende Liste alter
  // Geheimnisse im Speicher ist selbst ein Risiko.
  const zeilen = await ladeZeilen().catch(() => [] as Zeile[]);
  const zeile = finde(zeilen, integrationId, key, ziel.guildId);
  if (zeile) {
    try {
      forgetSecretValue(decryptSecret(zeile.ciphertext, adresse(integrationId, key, ziel)));
    } catch {
      // Nicht lesbar - dann steht er auch in keiner Liste.
    }
  }

  const ergebnis = await prisma.integrationSecret.deleteMany({
    where: { scope: ziel.scope, guildId: ziel.guildId, provider: integrationId, key },
  });
  if (ergebnis.count > 0) {
    await invalidate(`integration:${integrationId}.${key} entfernt`, options.actorDiscordId);
  }
  return ergebnis.count > 0;
}

/** Alle Werte eines Anbieters entfernen - z.B. beim Löschen eines Bots. */
export async function deleteProvider(provider: string, options: SetSecretOptions = {}): Promise<number> {
  const ergebnis = await prisma.integrationSecret.deleteMany({ where: { provider } });
  if (ergebnis.count > 0) {
    await invalidate(`integration:${provider} entfernt`, options.actorDiscordId);
  }
  return ergebnis.count;
}

/**
 * Caches verwerfen und die übrigen Prozesse davon in Kenntnis setzen.
 *
 * Der eigene Prozess wirft sofort weg; Bot und weitere WebApp-Instanzen sehen
 * die erhöhte Revision beim nächsten Blick und tun dasselbe. Das ist die
 * bestehende Verständigung zwischen den Prozessen - es braucht dafür weder
 * Redis noch einen zweiten Kanal.
 */
async function invalidate(grund: string, actorDiscordId?: string | null): Promise<void> {
  clearRevisionCaches(CACHE_KEY);
  await bumpConfigRevision(grund, actorDiscordId ?? null);
  clearRevisionCaches(CACHE_KEY);
}

/** Sofortiges Verwerfen ohne Schreibvorgang - nach einer erkannten Revision. */
export function dropSecretCache(): void {
  clearRevisionCaches(CACHE_KEY);
}

/**
 * Was die Oberfläche über ein Feld erfahren darf.
 *
 * Enthält niemals einen geheimen Wert. Für nicht geheime Felder steht der
 * Wert selbst in `display` - eine Client ID zu verstecken hülfe niemandem.
 */
export async function describe(
  integrationId: string,
  options: { guildId?: string | null; provider?: string } = {},
): Promise<SecretDescription[]> {
  const definition = getIntegration(integrationId);
  if (!definition) {
    return [];
  }
  const ziel = bereich(definition, options.guildId);
  const zeilen = await ladeZeilen().catch(() => [] as Zeile[]);

  return definition.fields
    .filter((feld) => feld.secret || feld.envKey)
    .map((feld) => {
      const zeile = finde(zeilen, integrationId, feld.key, ziel.guildId);
      const envWert = ausUmgebung(integrationId, feld.key, options.provider);
      const origin: SecretOrigin = zeile ? 'database' : envWert !== null ? 'environment' : 'missing';

      return {
        key: feld.key,
        label: feld.label,
        secret: feld.secret,
        required: feld.required ?? false,
        configured: origin !== 'missing',
        origin,
        display: zeile ? zeile.hint : envWert !== null ? (feld.secret ? maskSecret(envWert) : envWert) : null,
        updatedAt: zeile?.updatedAt ?? null,
        updatedBy: zeile?.updatedBy ?? null,
        alsoInEnvironment: envWert !== null,
      };
    });
}

/** Steht ein Wert noch (oder nur) in der Umgebung? Grundlage für die Übernahme. */
export async function environmentCandidates(): Promise<
  Array<{ integrationId: string; key: string; label: string; inDatabase: boolean }>
> {
  const zeilen = await ladeZeilen().catch(() => [] as Zeile[]);
  const treffer: Array<{ integrationId: string; key: string; label: string; inDatabase: boolean }> = [];

  for (const definition of INTEGRATIONS) {
    for (const feld of definition.fields) {
      if (ausUmgebung(definition.id, feld.key) === null) {
        continue;
      }
      const ziel = bereich(definition, null);
      treffer.push({
        integrationId: definition.id,
        key: feld.key,
        label: `${definition.label} → ${feld.label}`,
        inDatabase: Boolean(finde(zeilen, definition.id, feld.key, ziel.guildId)),
      });
    }
  }
  return treffer;
}
