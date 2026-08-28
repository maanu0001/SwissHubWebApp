import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '@swisshub/shared';

/**
 * Verschlüsselung der Integrations-Geheimnisse.
 *
 * Ein Bot-Token in einer Datenbankspalte im Klartext ist ein Token, das jede
 * Sicherungskopie, jeder Datenbank-Dump und jeder versehentliche
 * `SELECT *` mitnimmt. Deshalb verlässt kein Geheimnis diesen Prozess
 * unverschlüsselt, und in der Datenbank steht ausschliesslich der Umschlag
 * unten.
 *
 * **AES-256-GCM.** Nicht CBC: GCM authentifiziert den Geheimtext, und ohne
 * Authentifizierung liesse sich ein Datensatz unbemerkt verändern. Der
 * Authentifizierungsanhang deckt zusätzlich die *Adresse* des Geheimnisses ab
 * (Bereich, Guild, Anbieter, Feld). Damit lässt sich ein Geheimtext nicht von
 * einer Zeile in eine andere kopieren: wer den AI-Schlüssel in die Zeile des
 * Bot-Tokens schriebe, bekäme beim Entschlüsseln einen Fehler statt eines
 * gültigen Werts.
 *
 * **Format.** `v1.<schlüsselKennung>.<iv>.<tag>.<geheimtext>`, Teile in
 * base64url. Die führende Fassungsnummer ist der Platzhalter für einen
 * späteren Wechsel des Hauptschlüssels: ein alter Umschlag bleibt lesbar,
 * während neue Werte bereits mit der neuen Fassung geschrieben werden.
 *
 * **Der Hauptschlüssel** steht in `MASTER_ENCRYPTION_KEY` und bleibt dort. Er
 * wird nie in der Datenbank abgelegt, nie im Dashboard angezeigt und nie
 * protokolliert - ohne ihn sind die Geheimnisse absichtlich nicht lesbar.
 */

export const ENVELOPE_VERSION = 'v1';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Adresse eines Geheimnisses - sie geht in die Authentifizierung ein. */
export interface SecretAddress {
  scope: 'GLOBAL' | 'GUILD';
  /** Leere Zeichenkette fuer `GLOBAL` - wie in der Datenbank. */
  guildId: string;
  provider: string;
  key: string;
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function fromB64url(value: string, feld: string): Buffer {
  const buffer = Buffer.from(value, 'base64url');
  if (buffer.length === 0) {
    throw new AppError('SECRET_UNREADABLE', {
      internalMessage: `Umschlag: ${feld} ist leer oder keine gültige base64url-Zeichenkette.`,
      userMessage: 'Das gespeicherte Geheimnis ist beschädigt.',
    });
  }
  return buffer;
}

/**
 * Der Hauptschlüssel aus der Umgebung.
 *
 * Erlaubt sind 32 rohe Bytes in base64 oder hex - beides ist das, was
 * `openssl rand -base64 32` bzw. `-hex 32` ausgibt. Eine Passphrase wäre
 * bequemer und deutlich schwächer; wer eine setzen will, soll sie vorher
 * selbst zu 32 Bytes machen.
 */
export function readMasterKey(source: NodeJS.ProcessEnv = process.env): Buffer | null {
  const roh = source.MASTER_ENCRYPTION_KEY?.trim();
  if (!roh) {
    return null;
  }

  const kandidaten: Buffer[] = [];
  if (/^[0-9a-f]{64}$/iu.test(roh)) {
    kandidaten.push(Buffer.from(roh, 'hex'));
  }
  kandidaten.push(Buffer.from(roh, 'base64'));

  const passend = kandidaten.find((buffer) => buffer.length === KEY_LENGTH);
  if (!passend) {
    throw new AppError('CONFIGURATION_MISSING', {
      internalMessage: `MASTER_ENCRYPTION_KEY ergibt ${kandidaten[0]?.length ?? 0} statt ${KEY_LENGTH} Bytes.`,
      userMessage:
        'MASTER_ENCRYPTION_KEY muss 32 Bytes ergeben - erzeugen mit `openssl rand -base64 32`.',
    });
  }
  return passend;
}

export function hasMasterKey(source: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return readMasterKey(source) !== null;
  } catch {
    return false;
  }
}

function requireMasterKey(): Buffer {
  const key = readMasterKey();
  if (!key) {
    throw new AppError('CONFIGURATION_MISSING', {
      internalMessage: 'MASTER_ENCRYPTION_KEY ist nicht gesetzt.',
      userMessage:
        'Es ist kein MASTER_ENCRYPTION_KEY gesetzt. Ohne ihn lassen sich keine Zugangsdaten speichern.',
    });
  }
  return key;
}

/**
 * Kennung des Hauptschlüssels.
 *
 * Die ersten acht Zeichen eines SHA-256 über den Schlüssel - genug, um beim
 * Entschlüsseln zu erkennen, dass ein anderer Schlüssel gemeint war, und viel
 * zu wenig, um vom Schlüssel selbst etwas preiszugeben.
 */
export function keyId(key: Buffer = requireMasterKey()): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/**
 * Der Authentifizierungsanhang: die Adresse des Geheimnisses.
 *
 * Er wird nicht verschluesselt, aber mitauthentifiziert. Passt er beim
 * Entschluesseln nicht, scheitert die Pruefung - und genau deshalb laesst sich
 * ein Geheimtext nicht von einer Zeile in eine andere kopieren.
 *
 * Getrennt wird mit einem Nullbyte, nicht mit einem Leerzeichen: ein Anbieter
 * `a` mit Feld `b c` und ein Anbieter `a b` mit Feld `c` ergaeben sonst
 * denselben Anhang, und zwischen diesen beiden Zeilen waere ein Tausch
 * moeglich. In einer Kennung kommt ein Nullbyte nicht vor.
 */
function aad(address: SecretAddress): Buffer {
  return Buffer.from(
    [address.scope, address.guildId, address.provider, address.key].join('\u0000'),
    'utf8',
  );
}

export function encryptSecret(klartext: string, address: SecretAddress): string {
  const key = requireMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(aad(address));
  const geheimtext = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()]);
  return [ENVELOPE_VERSION, keyId(key), b64url(iv), b64url(cipher.getAuthTag()), b64url(geheimtext)].join(
    '.',
  );
}

export interface EnvelopeInfo {
  version: string;
  keyId: string;
}

/** Liest die Kopfdaten, ohne zu entschlüsseln - für Diagnose und Anzeige. */
export function envelopeInfo(umschlag: string): EnvelopeInfo | null {
  const teile = umschlag.split('.');
  if (teile.length !== 5 || !teile[0] || !teile[1]) {
    return null;
  }
  return { version: teile[0], keyId: teile[1] };
}

export function decryptSecret(umschlag: string, address: SecretAddress): string {
  const key = requireMasterKey();
  const teile = umschlag.split('.');
  if (teile.length !== 5) {
    throw new AppError('SECRET_UNREADABLE', {
      internalMessage: `Umschlag hat ${teile.length} statt 5 Teile.`,
      userMessage: 'Das gespeicherte Geheimnis ist beschädigt.',
    });
  }
  const [version, kennung, ivRoh, tagRoh, textRoh] = teile as [string, string, string, string, string];

  if (version !== ENVELOPE_VERSION) {
    throw new AppError('SECRET_UNREADABLE', {
      internalMessage: `Unbekannte Umschlag-Fassung «${version}».`,
      userMessage: 'Dieses Geheimnis wurde mit einer neueren Fassung geschrieben.',
    });
  }

  // Erst die Kennung: ein falscher Hauptschlüssel soll eine verständliche
  // Meldung geben und nicht als «beschädigte Daten» erscheinen. Der Vergleich
  // läuft zeitkonstant - die Kennung ist zwar nicht geheim, aber ein
  // ungleichmässiger Vergleich hier wäre eine Gewohnheit, die anderswo teuer
  // wird.
  const erwartet = Buffer.from(keyId(key), 'utf8');
  const gefunden = Buffer.from(kennung, 'utf8');
  if (erwartet.length !== gefunden.length || !timingSafeEqual(erwartet, gefunden)) {
    throw new AppError('SECRET_UNREADABLE', {
      internalMessage: `Umschlag wurde mit Schlüssel ${kennung} geschrieben, gesetzt ist ${keyId(key)}.`,
      userMessage:
        'Die gespeicherten Zugangsdaten wurden mit einem anderen MASTER_ENCRYPTION_KEY verschlüsselt und lassen sich nicht lesen.',
    });
  }

  const iv = fromB64url(ivRoh, 'IV');
  const tag = fromB64url(tagRoh, 'Auth-Tag');
  const geheimtext = fromB64url(textRoh, 'Geheimtext');

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(aad(address));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(geheimtext), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new AppError('SECRET_UNREADABLE', {
      internalMessage: `Entschlüsselung fehlgeschlagen für ${address.provider}.${address.key}.`,
      userMessage:
        'Das gespeicherte Geheimnis liess sich nicht entschlüsseln. Bitte den Wert neu hinterlegen.',
      cause: error,
    });
  }
}

/**
 * Was im Dashboard von einem Geheimnis übrig bleibt.
 *
 * Die letzten vier Zeichen sind genug, um zwei Schlüssel auseinanderzuhalten,
 * und zu wenig, um mit ihnen etwas anzufangen. Kurze Werte werden vollständig
 * verdeckt - bei acht Zeichen wären vier sichtbare die Hälfte.
 */
export function maskSecret(klartext: string): string {
  const punkte = '••••••••';
  if (klartext.length < 12) {
    return punkte;
  }
  return `${punkte}${klartext.slice(-4)}`;
}
