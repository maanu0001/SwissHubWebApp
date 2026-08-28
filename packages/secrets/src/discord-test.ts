import { createLogger } from '@swisshub/logger';

const logger = createLogger('secrets:discord-test');

/**
 * Prüfung eines Bot-Tokens gegen Discord.
 *
 * Bewusst der billigste Aufruf, den es gibt: `GET /users/@me` mit dem Token.
 * Er verändert nichts, zählt kaum aufs Kontingent und beantwortet genau die
 * Frage, die vor einer Übernahme zu klären ist - lässt Discord dieses Token
 * überhaupt herein?
 *
 * Der Fehlertext, der zurückkommt, ist **kein** Anbieter-Rohtext (§47). Eine
 * Discord-Antwort kann die gesendeten Kopfzeilen widerspiegeln, und dieser
 * Text wandert bis in die Oberfläche.
 */

const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 10_000;

export interface BotIdentity {
  id: string;
  username: string;
  discriminator: string | null;
}

export interface TokenPruefung {
  ok: boolean;
  identity?: BotIdentity;
  /** Kurz, verständlich, ohne Anbieterdetails. */
  fehler?: string;
}

async function mitZeitlimit(url: string, init: RequestInit): Promise<Response> {
  const abbruch = new AbortController();
  const timer = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: abbruch.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function validateBotToken(token: string): Promise<TokenPruefung> {
  if (token.trim() === '') {
    return { ok: false, fehler: 'Es wurde kein Token angegeben.' };
  }

  let antwort: Response;
  try {
    antwort = await mitZeitlimit(`${API}/users/@me`, {
      headers: { Authorization: `Bot ${token}` },
    });
  } catch (error) {
    // Der Fehler kann die Adresse enthalten, nicht das Token - trotzdem geht
    // er nur ins Protokoll und nicht in die Antwort.
    logger.warn('Discord war für die Tokenprüfung nicht erreichbar', { error });
    return { ok: false, fehler: 'Discord ist derzeit nicht erreichbar. Bitte später erneut prüfen.' };
  }

  if (antwort.status === 401) {
    return { ok: false, fehler: 'Token ungültig - Discord hat die Anmeldung abgelehnt.' };
  }
  if (antwort.status === 429) {
    return { ok: false, fehler: 'Discord drosselt gerade die Anfragen. Bitte in einer Minute erneut prüfen.' };
  }
  if (!antwort.ok) {
    logger.warn('Unerwartete Antwort bei der Tokenprüfung', { status: antwort.status });
    return { ok: false, fehler: `Discord antwortete mit Status ${antwort.status}.` };
  }

  const daten = (await antwort.json().catch(() => null)) as {
    id?: unknown;
    username?: unknown;
    discriminator?: unknown;
    bot?: unknown;
  } | null;

  if (!daten || typeof daten.id !== 'string' || typeof daten.username !== 'string') {
    return { ok: false, fehler: 'Discord hat eine unerwartete Antwort geliefert.' };
  }
  if (daten.bot !== true) {
    // Ein Benutzer-Token würde hier durchgehen und wäre nicht nur nutzlos,
    // sondern ein Verstoss gegen die Discord-Regeln.
    return { ok: false, fehler: 'Das ist kein Bot-Token, sondern ein Benutzer-Token.' };
  }

  return {
    ok: true,
    identity: {
      id: daten.id,
      username: daten.username,
      discriminator: typeof daten.discriminator === 'string' ? daten.discriminator : null,
    },
  };
}

/**
 * Prüfung der OAuth-Zugangsdaten.
 *
 * Client Credentials sind der einzige Weg, Client ID und Secret zusammen zu
 * prüfen, ohne dass ein Mensch etwas anklickt. Der dabei ausgestellte Token
 * wird nirgends aufbewahrt - er wird geholt und fallen gelassen.
 */
export async function validateOAuthCredentials(
  clientId: string,
  clientSecret: string,
): Promise<TokenPruefung> {
  if (clientId.trim() === '' || clientSecret.trim() === '') {
    return { ok: false, fehler: 'Client ID und Client Secret werden beide benötigt.' };
  }

  let antwort: Response;
  try {
    antwort = await mitZeitlimit(`${API}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'identify' }).toString(),
    });
  } catch (error) {
    logger.warn('Discord war für die OAuth-Prüfung nicht erreichbar', { error });
    return { ok: false, fehler: 'Discord ist derzeit nicht erreichbar. Bitte später erneut prüfen.' };
  }

  if (antwort.ok) {
    return { ok: true };
  }
  if (antwort.status === 401) {
    return { ok: false, fehler: 'Client ID oder Client Secret stimmen nicht.' };
  }
  if (antwort.status === 429) {
    return { ok: false, fehler: 'Discord drosselt gerade die Anfragen. Bitte in einer Minute erneut prüfen.' };
  }
  logger.warn('Unerwartete Antwort bei der OAuth-Prüfung', { status: antwort.status });
  return { ok: false, fehler: `Discord antwortete mit Status ${antwort.status}.` };
}
