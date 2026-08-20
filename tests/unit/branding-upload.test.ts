import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as Modules from '@swisshub/modules';

/**
 * Logo-Upload.
 *
 * Der Upload ist die einzige Stelle, an der fremde Dateien auf den Server
 * gelangen. Getestet wird deshalb vor allem, was NICHT durchkommen darf:
 * falsche Typen, zu grosse Dateien und Pfadmanipulation.
 */
let uploadDir: string;
let storage: (typeof Modules)['branding'];

beforeAll(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), 'swisshub-upload-'));
  process.env.SWISSHUB_UPLOAD_DIR = uploadDir;
  // Erst nach dem Setzen importieren - das Modul liest den Pfad beim Laden.
  storage = (await import('@swisshub/modules')).branding;
});

afterAll(() => {
  delete process.env.SWISSHUB_UPLOAD_DIR;
});

/** Kleinstes gültiges PNG (16x16, damit die Mindestgrösse erfüllt ist). */
function pngBytes(width = 32, height = 32): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrLength = [0x00, 0x00, 0x00, 0x0d];
  const ihdr = [0x49, 0x48, 0x44, 0x52];
  const size = [
    (width >> 24) & 0xff,
    (width >> 16) & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    (height >> 24) & 0xff,
    (height >> 16) & 0xff,
    (height >> 8) & 0xff,
    height & 0xff,
  ];
  return new Uint8Array([...header, ...ihdrLength, ...ihdr, ...size, ...new Array(16).fill(0)]);
}

function jpegBytes(): Uint8Array {
  // SOI + APP0 + SOF0 mit 64x64.
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x40,
    0x00,
    0x40,
    ...new Array(16).fill(0),
  ]);
}

describe('Formaterkennung', () => {
  it('erkennt PNG, JPEG und WEBP an der Signatur', () => {
    expect(storage.detectImageFormat(pngBytes())).toBe('png');
    expect(storage.detectImageFormat(jpegBytes())).toBe('jpeg');

    const webp = new Uint8Array(20);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(storage.detectImageFormat(webp)).toBe('webp');
  });

  it('erkennt SVG und HTML nicht als Bild', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>hi</body></html>');
    expect(storage.detectImageFormat(svg)).toBeNull();
    expect(storage.detectImageFormat(html)).toBeNull();
  });

  it('liest die Abmessungen aus dem PNG-Header', () => {
    expect(storage.readImageSize(pngBytes(120, 80), 'png')).toEqual({ width: 120, height: 80 });
  });
});

describe('Upload speichern', () => {
  it('nimmt ein gültiges PNG an und vergibt einen eigenen Dateinamen', async () => {
    const stored = await storage.storeLogoUpload(pngBytes(), 'image/png');

    expect(stored.format).toBe('png');
    // Der Name stammt vom Server, nicht vom Browser.
    expect(stored.fileName).toMatch(/^logo-[0-9a-f]{32}\.png$/u);
    expect(stored.version).toHaveLength(12);

    const files = await readdir(uploadDir);
    expect(files).toContain(stored.fileName);
  });

  it('lehnt einen falschen MIME-Type ab, auch wenn der Inhalt ein Bild ist', async () => {
    await expect(storage.storeLogoUpload(pngBytes(), 'image/webp')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('lehnt eine als PNG deklarierte HTML-Datei ab', async () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
    await expect(storage.storeLogoUpload(html, 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('lehnt zu grosse Dateien ab', async () => {
    const big = new Uint8Array(storage.MAX_UPLOAD_BYTES + 1);
    big.set(pngBytes(), 0);
    await expect(storage.storeLogoUpload(big, 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('lehnt leere Dateien ab', async () => {
    await expect(storage.storeLogoUpload(new Uint8Array(0), 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('lehnt zu kleine und zu grosse Bilder ab', async () => {
    await expect(storage.storeLogoUpload(pngBytes(1, 1), 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(storage.storeLogoUpload(pngBytes(8000, 8000), 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('Lesen und Löschen', () => {
  it('liest eine gespeicherte Datei zurück', async () => {
    const stored = await storage.storeLogoUpload(pngBytes(), 'image/png');
    const file = await storage.readUpload(stored.fileName);

    expect(file).not.toBeNull();
    expect(file?.format).toBe('png');
  });

  it('verweigert Path Traversal', async () => {
    // Datei ausserhalb des Upload-Verzeichnisses anlegen.
    const outside = join(uploadDir, '..', 'geheim.txt');
    await writeFile(outside, 'streng geheim');

    for (const name of [
      '../geheim.txt',
      '../../etc/passwd',
      'logo-../../etc/passwd',
      '/etc/passwd',
      'logo-abc.png',
      'logo-00000000000000000000000000000000.svg',
    ]) {
      // Entweder wirft die Namensprüfung, oder es kommt `null` zurück -
      // ausgeliefert wird in keinem Fall etwas.
      const result = await storage.readUpload(name).catch(() => null);
      expect(result).toBeNull();
    }

    // Die Datei ausserhalb ist unverändert und wurde nie ausgeliefert.
    expect(await readFile(outside, 'utf8')).toBe('streng geheim');
  });

  it('löscht nur eigene Dateien und ignoriert fremde Namen', async () => {
    const stored = await storage.storeLogoUpload(pngBytes(), 'image/png');
    await storage.deleteUpload(stored.fileName);
    expect(await storage.readUpload(stored.fileName)).toBeNull();

    // Ein manipulierter Name darf nichts anrichten.
    await storage.deleteUpload('../geheim.txt');
    expect(await readFile(join(uploadDir, '..', 'geheim.txt'), 'utf8')).toBe('streng geheim');
  });
});
