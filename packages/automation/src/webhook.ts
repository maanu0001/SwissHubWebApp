import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createLogger } from '@swisshub/logger';

const logger = createLogger('automation:webhook');

/**
 * Ausgehende Webhooks - und warum das der gefährlichste Teil der Engine ist.
 *
 * Eine Automation darf eine Adresse aufrufen, die jemand mit Schreibrecht
 * eingetragen hat. Ohne Schranken wäre das eine Anfrage aus dem Inneren des
 * Servers heraus: `http://169.254.169.254/` liefert bei manchen Anbietern
 * Zugangsdaten der Maschine, `http://localhost:5432` ist die Datenbank, und
 * ein Redirect führt von einer harmlosen Adresse genau dorthin (§30).
 *
 * Deshalb, der Reihe nach:
 *
 * 1. **Nur HTTPS.** `file:`, `gopher:` und `http:` fallen weg.
 * 2. **Keine Zugangsdaten in der Adresse.** `https://user:pass@…` wäre ein
 *    Weg, ein Geheimnis in eine Automation zu schreiben.
 * 3. **Namen werden aufgelöst und die Adresse geprüft.** Ein Name wie
 *    `intern.example.com` kann auf `10.0.0.5` zeigen; nur die aufgelöste
 *    Adresse verrät das.
 * 4. **Keine Weiterleitungen.** Sonst wäre Schritt 3 wertlos: die erste
 *    Adresse wäre öffentlich, die zweite nicht.
 * 5. **Frist und Grössengrenze.** Eine Gegenstelle, die nie antwortet, darf
 *    keinen Job blockieren; eine, die ein Gigabyte schickt, keinen Speicher
 *    füllen.
 *
 * Was hier **nicht** möglich ist: eine freie Methode, freie Kopfzeilen mit
 * `Authorization`, oder ein Geheimnis aus der Integrationsverwaltung als Wert
 * (§20). Wer eine Gegenstelle mit Anmeldung ansprechen will, baut dafür eine
 * Integration - dort gehören Geheimnisse hin.
 */

/** Wie lange auf eine Antwort gewartet wird. */
export const WEBHOOK_FRIST_MS = 10_000;

/** Wie viel von der Antwort gelesen wird. Mehr braucht niemand für ein Protokoll. */
export const WEBHOOK_MAX_ANTWORT = 2_000;

export interface Zielbefund {
  erlaubt: boolean;
  grund?: string;
  host?: string;
}

/**
 * Ist diese IP-Adresse eine, die von aussen nie erreichbar wäre?
 *
 * Eine Freigabeliste ist hier nicht möglich - das öffentliche Internet lässt
 * sich nicht aufzählen. Also eine Sperrliste, und die deckt jeden Bereich ab,
 * den die IANA als besonders führt: Schleife, privat, verbindungslokal
 * (inklusive der Metadatenadresse der Cloud-Anbieter), Übertragungsnetz,
 * Mehrfachziel und reserviert.
 */
export function istInterneAdresse(adresse: string): boolean {
  const art = isIP(adresse);

  if (art === 4) {
    const teile = adresse.split('.').map(Number);
    const [a, b] = teile as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // privat
    if (a === 127) return true; // Schleife
    if (a === 100 && b >= 64 && b <= 127) return true; // Anbieter-NAT
    if (a === 169 && b === 254) return true; // verbindungslokal, Cloud-Metadaten
    if (a === 172 && b >= 16 && b <= 31) return true; // privat
    if (a === 192 && b === 0) return true; // Protokollzuweisungen
    if (a === 192 && b === 168) return true; // privat
    if (a === 198 && (b === 18 || b === 19)) return true; // Messnetz
    if (a >= 224) return true; // Mehrfachziel und reserviert
    return false;
  }

  if (art === 6) {
    const klein = adresse.toLowerCase();
    if (klein === '::' || klein === '::1') return true;
    if (klein.startsWith('fe80')) return true; // verbindungslokal
    if (/^f[cd]/u.test(klein)) return true; // eindeutig lokal
    if (klein.startsWith('ff')) return true; // Mehrfachziel
    // In IPv6 eingebettete IPv4-Adresse: dieselbe Prüfung wie oben.
    const eingebettet = klein.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
    if (eingebettet?.[1]) {
      return istInterneAdresse(eingebettet[1]);
    }
    return false;
  }

  // Was keine IP-Adresse ist, ist keine, die freigegeben wird.
  return true;
}

/**
 * Darf diese Adresse angesprochen werden?
 *
 * Wird zweimal aufgerufen: beim Speichern einer Automation (damit der Fehler
 * dort auffällt, wo jemand ihn beheben kann) und unmittelbar vor dem Senden
 * (weil ein Name inzwischen auf eine andere Adresse zeigen kann).
 */
export async function pruefeZieladresse(rohAdresse: string): Promise<Zielbefund> {
  let adresse: URL;
  try {
    adresse = new URL(rohAdresse);
  } catch {
    return { erlaubt: false, grund: 'Die Adresse ist keine gültige URL.' };
  }

  if (adresse.protocol !== 'https:') {
    return { erlaubt: false, grund: 'Nur HTTPS-Adressen sind erlaubt.' };
  }
  if (adresse.username !== '' || adresse.password !== '') {
    return { erlaubt: false, grund: 'Zugangsdaten in der Adresse sind nicht erlaubt.' };
  }
  if (adresse.port !== '' && adresse.port !== '443') {
    return { erlaubt: false, grund: 'Nur der Standardport 443 ist erlaubt.' };
  }

  const host = adresse.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host) !== 0) {
    // Eine unmittelbar angegebene IP-Adresse: direkt prüfen, ohne Auflösung.
    return istInterneAdresse(host)
      ? { erlaubt: false, grund: 'Diese Adresse liegt im internen Netz.', host }
      : { erlaubt: true, host };
  }

  let adressen: Array<{ address: string }>;
  try {
    adressen = await lookup(host, { all: true });
  } catch {
    return { erlaubt: false, grund: 'Der Name liess sich nicht auflösen.', host };
  }
  if (adressen.length === 0) {
    return { erlaubt: false, grund: 'Der Name liess sich nicht auflösen.', host };
  }

  // **Jede** aufgelöste Adresse muss aussen liegen. Genügte eine, bliebe ein
  // Name mit zwei Einträgen - einem öffentlichen und einem internen - ein Weg
  // nach innen.
  for (const eintrag of adressen) {
    if (istInterneAdresse(eintrag.address)) {
      return { erlaubt: false, grund: 'Der Name zeigt ins interne Netz.', host };
    }
  }

  return { erlaubt: true, host };
}

export interface WebhookErgebnis {
  ok: boolean;
  status?: number;
  /** Ein kurzer Ausschnitt der Antwort - für den Verlauf. */
  antwort?: string;
  grund?: string;
}

/**
 * Einen Webhook senden.
 *
 * Feste Methode, festes Format, feste Kopfzeilen. Was die Automation
 * bestimmt, ist die Adresse und der Rumpf - mehr Freiheit wäre mehr
 * Angriffsfläche ohne erkennbaren Gewinn.
 */
export async function sendeWebhook(
  rohAdresse: string,
  rumpf: unknown,
  optionen: { fristMs?: number } = {},
): Promise<WebhookErgebnis> {
  const befund = await pruefeZieladresse(rohAdresse);
  if (!befund.erlaubt) {
    return { ok: false, ...(befund.grund ? { grund: befund.grund } : {}) };
  }

  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), optionen.fristMs ?? WEBHOOK_FRIST_MS);

  try {
    const antwort = await fetch(rohAdresse, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'SwissHub-Automation/1.0',
      },
      body: JSON.stringify(rumpf),
      // Ohne dies wäre die Adressprüfung wertlos: eine erlaubte Adresse
      // könnte auf eine verbotene weiterleiten.
      redirect: 'manual',
      signal: abbruch.signal,
    });

    if (antwort.status >= 300 && antwort.status < 400) {
      return { ok: false, status: antwort.status, grund: 'Die Gegenstelle leitet weiter.' };
    }

    const text = (await antwort.text()).slice(0, WEBHOOK_MAX_ANTWORT);
    if (!antwort.ok) {
      return {
        ok: false,
        status: antwort.status,
        antwort: text,
        grund: `Die Gegenstelle antwortete mit ${antwort.status}.`,
      };
    }
    return { ok: true, status: antwort.status, antwort: text };
  } catch (error) {
    const abgebrochen = (error as { name?: string })?.name === 'AbortError';
    // Die Adresse steht bewusst nicht im Protokoll: sie kann einen Token im
    // Pfad tragen, wie es bei Discord- und Slack-Webhooks üblich ist (§20).
    logger.warn('Webhook nicht zustellbar', { host: befund.host, abgebrochen });
    return {
      ok: false,
      grund: abgebrochen
        ? 'Die Gegenstelle antwortete nicht rechtzeitig.'
        : 'Die Gegenstelle war nicht erreichbar.',
    };
  } finally {
    clearTimeout(wecker);
  }
}
