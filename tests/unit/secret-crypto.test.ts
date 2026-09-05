import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ENVELOPE_VERSION,
  decryptSecret,
  encryptSecret,
  envelopeInfo,
  hasMasterKey,
  keyId,
  maskSecret,
  readMasterKey,
  type SecretAddress,
} from '@swisshub/secrets';

/**
 * Die Verschlüsselung der Zugangsdaten.
 *
 * Diese Datei prüft genau das, was «verschlüsselt gespeichert» bedeuten soll:
 * dass der Klartext nirgends im Geheimtext steht, dass ein anderer
 * Hauptschlüssel ihn nicht lesbar macht, dass ein verändertes Byte auffliegt
 * und dass ein Geheimtext nicht von einer Zeile in eine andere wandern kann.
 *
 * Die letzte Zusage ist die unauffälligste und die wichtigste: ohne sie
 * könnte, wer die Datenbank verändern darf, den AI-Schlüssel in die Zeile des
 * Bot-Tokens kopieren - und der Bot meldete sich mit einem Wert an, den er
 * nie bekommen sollte.
 */

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

const ADRESSE: SecretAddress = {
  scope: 'GLOBAL',
  guildId: '',
  provider: 'discord',
  key: 'botToken',
};

const GEHEIM = 'kein-echtes-token-nur-ein-testwert-3X7A';

/**
 * Die Meldung, die ein Mensch zu sehen bekommt.
 *
 * `error.message` ist bewusst die interne Fassung - sie darf Kennungen und
 * Einzelheiten tragen, die nie in die Oberflaeche gehoeren. Geprueft wird
 * hier deshalb `userMessage`.
 */
function fuerMenschen(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { userMessage?: string }).userMessage ?? String(error);
  }
  throw new Error('Es haette ein Fehler geworfen werden muessen');
}

let vorher: string | undefined;

beforeEach(() => {
  vorher = process.env.MASTER_ENCRYPTION_KEY;
  process.env.MASTER_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  if (vorher === undefined) {
    delete process.env.MASTER_ENCRYPTION_KEY;
  } else {
    process.env.MASTER_ENCRYPTION_KEY = vorher;
  }
});

describe('Secret-Verschlüsselung', () => {
  it('verschlüsselt und entschlüsselt verlustfrei', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    expect(decryptSecret(umschlag, ADRESSE)).toBe(GEHEIM);
  });

  it('lässt den Klartext nirgends im Umschlag stehen', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    expect(umschlag).not.toContain(GEHEIM);
    // Auch keine längeren Teilstücke - ein Umschlag, der den Anfang des
    // Tokens preisgäbe, wäre so gut wie keiner.
    expect(umschlag).not.toContain(GEHEIM.slice(0, 16));
    expect(umschlag).not.toContain(GEHEIM.slice(-16));
  });

  it('erzeugt für denselben Wert nie zweimal denselben Umschlag', () => {
    // Der Zufallsvektor ist der Grund. Ohne ihn liesse sich an gleichen
    // Geheimtexten ablesen, dass zwei Einträge denselben Wert tragen.
    const a = encryptSecret(GEHEIM, ADRESSE);
    const b = encryptSecret(GEHEIM, ADRESSE);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, ADRESSE)).toBe(decryptSecret(b, ADRESSE));
  });

  it('trägt Fassung und Schlüsselkennung im Klartext', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    const info = envelopeInfo(umschlag);
    expect(info?.version).toBe(ENVELOPE_VERSION);
    expect(info?.keyId).toBe(keyId(readMasterKey()!));
    // Die Kennung ist ein Hash-Ausschnitt, nicht der Schlüssel.
    expect(umschlag).not.toContain(KEY_A);
  });

  it('verweigert die Entschlüsselung mit einem anderen Hauptschlüssel', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    process.env.MASTER_ENCRYPTION_KEY = KEY_B;
    expect(fuerMenschen(() => decryptSecret(umschlag, ADRESSE))).toMatch(/anderen MASTER_ENCRYPTION_KEY/u);
  });

  it('erkennt einen veränderten Geheimtext', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    const teile = umschlag.split('.');
    // Ein einzelnes Zeichen im Geheimtext kippen.
    const text = teile[4]!;
    teile[4] = (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
    expect(() => decryptSecret(teile.join('.'), ADRESSE)).toThrowError();
  });

  it('erkennt einen veränderten Auth-Tag', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    const teile = umschlag.split('.');
    const tag = teile[3]!;
    teile[3] = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(() => decryptSecret(teile.join('.'), ADRESSE)).toThrowError();
  });

  it('lässt einen Geheimtext nicht in eine fremde Zeile wandern', () => {
    // Der Kern des Authentifizierungsanhangs: der Umschlag gilt nur an
    // genau der Adresse, an der er entstanden ist.
    const umschlag = encryptSecret(GEHEIM, ADRESSE);

    expect(() => decryptSecret(umschlag, { ...ADRESSE, key: 'clientSecret' })).toThrowError();
    expect(() => decryptSecret(umschlag, { ...ADRESSE, provider: 'ai' })).toThrowError();
    expect(() => decryptSecret(umschlag, { ...ADRESSE, scope: 'GUILD', guildId: '1' })).toThrowError();
    expect(() => decryptSecret(umschlag, { ...ADRESSE, guildId: '999' })).toThrowError();
  });

  it('weist einen beschädigten Umschlag ab, statt Unsinn zu liefern', () => {
    expect(() => decryptSecret('kein-umschlag', ADRESSE)).toThrowError();
    expect(() => decryptSecret('v1.aaaa.bbb.ccc', ADRESSE)).toThrowError();
    expect(envelopeInfo('kaputt')).toBeNull();
  });

  it('weist eine unbekannte Umschlag-Fassung ab', () => {
    const umschlag = encryptSecret(GEHEIM, ADRESSE);
    const teile = umschlag.split('.');
    teile[0] = 'v99';
    expect(fuerMenschen(() => decryptSecret(teile.join('.'), ADRESSE))).toMatch(/neueren Fassung/u);
  });

  it('verlangt einen Hauptschlüssel mit genau 32 Bytes', () => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(16, 3).toString('base64');
    expect(fuerMenschen(() => readMasterKey())).toMatch(/32 Bytes/u);
    expect(hasMasterKey()).toBe(false);

    // Hex ist ebenso erlaubt wie base64 - beides gibt `openssl rand` aus.
    process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('hex');
    expect(readMasterKey()?.length).toBe(32);
  });

  it('meldet ohne Hauptschlüssel verständlich, statt still zu scheitern', () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    expect(hasMasterKey()).toBe(false);
    expect(fuerMenschen(() => encryptSecret(GEHEIM, ADRESSE))).toMatch(/MASTER_ENCRYPTION_KEY/u);
  });
});

describe('Maskierung', () => {
  it('zeigt höchstens die letzten vier Zeichen', () => {
    const maske = maskSecret(GEHEIM);
    expect(maske).toContain(GEHEIM.slice(-4));
    expect(maske).not.toContain(GEHEIM.slice(0, 8));
    expect(maske.length).toBeLessThan(GEHEIM.length);
  });

  it('verdeckt kurze Werte vollständig', () => {
    // Bei elf Zeichen wären vier sichtbare mehr als ein Drittel.
    const maske = maskSecret('kurz-1234');
    expect(maske).not.toContain('1234');
    expect(maske).toMatch(/^•+$/u);
  });
});
