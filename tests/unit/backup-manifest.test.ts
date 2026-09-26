import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alsDatum,
  alsZahl,
  belegteBytes,
  beurteile,
  leseManifest,
  leseZustand,
  type BackupManifest,
} from '@swisshub/modules/backup/manifest';

/**
 * Das Manifest - und die Naht zwischen zwei Sprachen.
 *
 * ## Warum dieser Test existiert
 *
 * Das Manifest schreibt ein Python-Skript (`deploy/backup/lib/manifest.py`),
 * gelesen wird es von TypeScript (`packages/modules/src/backup/manifest.ts`).
 * Zwei Sprachen, eine Datei, kein gemeinsamer Typ. Ohne diesen Test waere jede
 * Umbenennung dort ein stiller Fehler hier: die Sicherung liefe weiter, das
 * Dashboard zeigte «noch nicht eingerichtet», und niemand wuesste, warum.
 *
 * Deshalb laeuft hier das **echte** Skript, und das Ergebnis geht durch das
 * **echte** Schema. Eine nachgebaute Beispieldatei wuerde vor allem sich selbst
 * bestaetigen.
 */

const WURZEL = process.cwd();
const MANIFEST_PY = join(WURZEL, 'deploy/backup/lib/manifest.py');

function py(...argumente: string[]): string {
  return execFileSync('python3', [MANIFEST_PY, ...argumente], { encoding: 'utf8' });
}

/** `pruefe` gibt bei einer Beanstandung Code 1 - das ist kein Testfehler. */
function pruefe(verzeichnis: string): { ok: boolean; ausgabe: string } {
  try {
    return { ok: true, ausgabe: py('pruefe', verzeichnis) };
  } catch (fehler) {
    const mitAusgabe = fehler as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      ausgabe: `${String(mitAusgabe.stdout ?? '')}${String(mitAusgabe.stderr ?? '')}`,
    };
  }
}

/**
 * Ein Datenbankexport, wie `pg_dump` ihn schreibt.
 *
 * Nachgebaut und nicht echt - hier wird der **Pruefer** geprueft, und dafuer
 * braucht es Faelle, die ein echtes `pg_dump` gar nicht erzeugt: einen Export
 * ohne Abschlussmarke, einen ohne Tabelle. Dass der Pruefer auch einen echten
 * Dump richtig liest, prueft `tests/integration/backup-recovery.test.ts` gegen
 * eine laufende Datenbank.
 */
function dumpText({
  tabellen = 2,
  zeilen = 3,
  abschluss = true,
}: { tabellen?: number; zeilen?: number; abschluss?: boolean } = {}): string {
  const teile = ['--', '-- PostgreSQL database dump', '--', '', '-- Dumped from database version 16.13', ''];
  for (let nummer = 1; nummer <= tabellen; nummer += 1) {
    teile.push(`CREATE TABLE public.tabelle${nummer} (id integer NOT NULL);`, '');
    teile.push(`COPY public.tabelle${nummer} (id) FROM stdin;`);
    for (let zeile = 1; zeile <= zeilen; zeile += 1) {
      teile.push(String(zeile));
    }
    teile.push('\\.', '');
  }
  if (abschluss) {
    teile.push('--', '-- PostgreSQL database dump complete', '--', '');
  }
  return teile.join('\n');
}

describe('Python schreibt, TypeScript liest', () => {
  let verzeichnis = '';

  beforeEach(() => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'swisshub-manifest-'));
    writeFileSync(join(verzeichnis, 'datenbank.sql.gz'), gzipSync(Buffer.from(dumpText())));
    writeFileSync(join(verzeichnis, 'umgebung.txt'), 'MASTER_ENCRYPTION_KEY\nAUTH_SECRET\n');
    writeFileSync(
      join(verzeichnis, '.angaben'),
      [
        'id=2026-09-26T030000Z',
        'erstelltAm=2026-09-26T03:00:12Z',
        'typ=vollstaendig',
        'status=abgeschlossen',
        'host=testhost',
        'komponenten=datenbank,umgebung',
        'postgresVersion=16.13',
        'gitCommit=9aa85142993dee7bd6decfdd43ae3e7daccd1668',
        'datenbank=direkt',
        'schluesselFingerabdruck=abc123def456',
        'geheimnisse=nicht gesichert',
      ].join('\n'),
    );
    py('schreibe', verzeichnis, join(verzeichnis, '.angaben'));
  });

  afterEach(() => {
    rmSync(verzeichnis, { recursive: true, force: true });
  });

  it('erzeugt ein Manifest, das das Schema annimmt', () => {
    /*
     * Die Naht. Schlaegt dieser Test fehl, haben sich die beiden Seiten
     * auseinanderbewegt - und zwar bevor es jemand im Betrieb merkt.
     */
    const roh = JSON.parse(readFileSync(join(verzeichnis, 'manifest.json'), 'utf8')) as unknown;
    const manifest = leseManifest(roh);
    expect(manifest).not.toBeNull();
    expect(manifest?.id).toBe('2026-09-26T030000Z');
    expect(manifest?.komponenten).toEqual(['datenbank', 'umgebung']);
    expect(manifest?.integritaet.status).toBe('ungeprueft');
    expect(manifest?.restoreTest.status).toBe('ungeprueft');
  });

  it('nennt jede Nutzdatei mit Groesse und Pruefsumme', () => {
    const manifest = leseManifest(
      JSON.parse(readFileSync(join(verzeichnis, 'manifest.json'), 'utf8')) as unknown,
    );
    const namen = manifest?.dateien.map((datei) => datei.name) ?? [];
    expect(namen).toEqual(['datenbank.sql.gz', 'umgebung.txt']);
    for (const datei of manifest?.dateien ?? []) {
      expect(datei.bytes).toBeGreaterThan(0);
      expect(datei.sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(manifest?.bytesGesamt).toBe(
      (manifest?.dateien ?? []).reduce((summe, datei) => summe + datei.bytes, 0),
    );
  });

  it('nimmt die Arbeitsdatei nicht ins Manifest', () => {
    /*
     * Der Fehler des ersten Probelaufs: `.angaben` landete in der Dateiliste
     * und wurde danach geloescht - die naechste Pruefung meldete «fehlt». Jede
     * Datei mit einem Punkt am Anfang ist eine Arbeitsdatei.
     */
    const manifest = leseManifest(
      JSON.parse(readFileSync(join(verzeichnis, 'manifest.json'), 'utf8')) as unknown,
    );
    expect(manifest?.dateien.map((datei) => datei.name)).not.toContain('.angaben');
  });

  it('schreibt eine Seitendatei, die coreutils prueft', () => {
    /*
     * `sha256sum -c` ohne Python, ohne jq, ohne dieses Repository. Im Ernstfall
     * steht jemand auf einem frischen Server mit einem Stick in der Hand - und
     * coreutils ist da.
     */
    expect(() =>
      execFileSync('sha256sum', ['-c', 'pruefsummen.sha256'], { cwd: verzeichnis, stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('besteht die eigene Pruefung', () => {
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok, ergebnis.ausgabe).toBe(true);
    expect(ergebnis.ausgabe).toContain('OK datenbank.sql.gz: 2 Tabellen');
  });

  it('vermerkt die beiden Zustaende getrennt', () => {
    py('vermerke', verzeichnis, 'integritaet', 'bestanden', 'geprueft');
    const nachErster = leseManifest(
      JSON.parse(readFileSync(join(verzeichnis, 'manifest.json'), 'utf8')) as unknown,
    );
    expect(nachErster?.integritaet.status).toBe('bestanden');
    // Der entscheidende Teil: der Restore-Test bleibt ungeprueft. Eine
    // richtige Pruefsumme sagt nichts darueber, ob PostgreSQL den Export
    // annimmt.
    expect(nachErster?.restoreTest.status).toBe('ungeprueft');

    py('vermerke', verzeichnis, 'restoreTest', 'bestanden', '2 Tabellen, 6 Zeilen');
    const nachZweiter = leseManifest(
      JSON.parse(readFileSync(join(verzeichnis, 'manifest.json'), 'utf8')) as unknown,
    );
    expect(nachZweiter?.restoreTest.status).toBe('bestanden');
    expect(nachZweiter?.restoreTest.meldung).toBe('2 Tabellen, 6 Zeilen');
  });

  it('lehnt einen unbekannten Zustand ab', () => {
    // Ein Tippfehler im Skript soll nicht als «bestanden» im Manifest landen.
    expect(() => py('vermerke', verzeichnis, 'integritaet', 'vielleicht')).toThrow();
    expect(() => py('vermerke', verzeichnis, 'gibtsnicht', 'bestanden')).toThrow();
  });
});

describe('Die Pruefung findet, was kaputt ist', () => {
  let verzeichnis = '';

  beforeEach(() => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'swisshub-kaputt-'));
  });

  afterEach(() => {
    rmSync(verzeichnis, { recursive: true, force: true });
  });

  function lege(dump: Buffer): void {
    writeFileSync(join(verzeichnis, 'datenbank.sql.gz'), dump);
    writeFileSync(
      join(verzeichnis, '.angaben'),
      'id=2026-09-26T030000Z\nerstelltAm=2026-09-26T03:00:12Z\nkomponenten=datenbank\n',
    );
    py('schreibe', verzeichnis, join(verzeichnis, '.angaben'));
  }

  it('merkt, wenn eine Datei fehlt', () => {
    lege(gzipSync(Buffer.from(dumpText())));
    rmSync(join(verzeichnis, 'datenbank.sql.gz'));
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.ausgabe).toContain('fehlt');
  });

  it('merkt, wenn sich ein Byte geaendert hat', () => {
    lege(gzipSync(Buffer.from(dumpText())));
    // Gleiche Laenge, anderer Inhalt: nur die Pruefsumme findet das.
    const inhalt = readFileSync(join(verzeichnis, 'datenbank.sql.gz'));
    const stelle = Math.floor(inhalt.length / 2);
    inhalt[stelle] = (inhalt[stelle] ?? 0) ^ 0xff;
    writeFileSync(join(verzeichnis, 'datenbank.sql.gz'), inhalt);
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.ausgabe).toMatch(/Pruefsumme weicht ab|gzip nicht lesbar/u);
  });

  it('merkt, wenn die Datei abgeschnitten ist', () => {
    lege(gzipSync(Buffer.from(dumpText())));
    const inhalt = readFileSync(join(verzeichnis, 'datenbank.sql.gz'));
    writeFileSync(join(verzeichnis, 'datenbank.sql.gz'), inhalt.subarray(0, inhalt.length - 20));
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    // Die Groesse weicht ab - das faellt vor der Pruefsumme auf.
    expect(ergebnis.ausgabe).toContain('Bytes');
  });

  it('merkt einen Export ohne Abschlussmarke', () => {
    /*
     * Der wichtigste Fall, und der einzige, den keine Pruefsumme findet: ein
     * `pg_dump`, das mitten im Lauf abbrach. Das gzip ist gueltig, die
     * Pruefsumme stimmt, die Groesse ist plausibel - und die Haelfte der Daten
     * fehlt.
     */
    lege(gzipSync(Buffer.from(dumpText({ abschluss: false }))));
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.ausgabe).toContain('Abschlussmarke');
  });

  it('merkt einen Export ohne eine einzige Tabelle', () => {
    lege(gzipSync(Buffer.from(dumpText({ tabellen: 0 }))));
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.ausgabe).toContain('keine einzige Tabelle');
  });

  it('merkt eine leere Datei', () => {
    lege(Buffer.alloc(0));
    // Eine leere Datei wird schon beim Schreiben des Manifests mit 0 Bytes
    // vermerkt - die Pruefung beanstandet sie trotzdem, denn eine Sicherung
    // aus nichts ist keine.
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.ausgabe).toMatch(/leer|gzip nicht lesbar/u);
  });

  it('merkt eine ausgetauschte Seitendatei', () => {
    /*
     * Manifest und `pruefsummen.sha256` entstehen im gleichen Durchgang. Weichen
     * sie voneinander ab, hat jemand an einer der beiden gedreht - und die
     * Pruefung soll das sagen, statt der freundlicheren von beiden zu glauben.
     */
    lege(gzipSync(Buffer.from(dumpText())));
    writeFileSync(join(verzeichnis, 'pruefsummen.sha256'), `${'0'.repeat(64)}  datenbank.sql.gz\n`);
    const ergebnis = pruefe(verzeichnis);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.ausgabe).toContain('weicht vom Manifest ab');
  });

  it('merkt ein fehlendes Manifest', () => {
    lege(gzipSync(Buffer.from(dumpText())));
    rmSync(join(verzeichnis, 'manifest.json'));
    expect(pruefe(verzeichnis).ok).toBe(false);
  });

  it('merkt ein Manifest aus einer anderen Fassung', () => {
    // Ein Manifest, das dieser Leser nicht versteht, soll nichts raten.
    lege(gzipSync(Buffer.from(dumpText())));
    const manifest = JSON.parse(readFileSync(join(verzeichnis, 'manifest.json'), 'utf8')) as {
      version: number;
    };
    manifest.version = 99;
    writeFileSync(join(verzeichnis, 'manifest.json'), JSON.stringify(manifest));
    expect(pruefe(verzeichnis).ok).toBe(false);
    expect(leseManifest(manifest)).toBeNull();
  });
});

describe('Was ein Restore ergeben muss', () => {
  let verzeichnis = '';

  beforeEach(() => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'swisshub-erwartung-'));
  });

  afterEach(() => {
    rmSync(verzeichnis, { recursive: true, force: true });
  });

  it('zaehlt Tabellen und Datenzeilen', () => {
    /*
     * Die Zahl, ohne die ein Restore-Test keiner ist: ein Restore, der das
     * Schema aufbaut und die Daten verliert, laeuft ohne Fehler durch.
     */
    const pfad = join(verzeichnis, 'dump.sql.gz');
    writeFileSync(pfad, gzipSync(Buffer.from(dumpText({ tabellen: 3, zeilen: 5 }))));
    expect(py('erwartung', pfad)).toBe('tabellen=3\nzeilen=15\n');
  });

  it('zaehlt ein Schema ohne Daten als null Zeilen', () => {
    const pfad = join(verzeichnis, 'dump.sql.gz');
    writeFileSync(pfad, gzipSync(Buffer.from(dumpText({ tabellen: 2, zeilen: 0 }))));
    expect(py('erwartung', pfad)).toBe('tabellen=2\nzeilen=0\n');
  });
});

describe('Die Aufbewahrung', () => {
  let wurzel = '';

  beforeEach(() => {
    wurzel = mkdtempSync(join(tmpdir(), 'swisshub-aufbewahrung-'));
  });

  afterEach(() => {
    rmSync(wurzel, { recursive: true, force: true });
  });

  /** Eine Sicherung vortaeuschen - fuer die Aufbewahrung zaehlt nur die Kennung. */
  function lege(...kennungen: string[]): void {
    for (const kennung of kennungen) {
      mkdirSync(join(wurzel, kennung));
      writeFileSync(join(wurzel, kennung, 'manifest.json'), '{"version":1}');
    }
  }

  function weg(taeglich = 7, wochen = 4, monate = 3): string[] {
    return py('aufbewahrung', wurzel, String(taeglich), String(wochen), String(monate))
      .split('\n')
      .filter((zeile) => zeile !== '');
  }

  it('behaelt alles, solange wenig da ist', () => {
    lege('2026-09-20T030000Z', '2026-09-21T030000Z', '2026-09-22T030000Z');
    expect(weg()).toEqual([]);
  });

  it('behaelt die letzten sieben Tage', () => {
    const kennungen = Array.from(
      { length: 10 },
      (_wert, index) => `2026-09-${String(index + 10).padStart(2, '0')}T030000Z`,
    );
    lege(...kennungen);
    const entfernt = weg(7, 0, 0);
    expect(entfernt).toEqual(kennungen.slice(0, 3));
  });

  it('behaelt nie die neueste', () => {
    /*
     * Die Eigenschaft, an der alles haengt. Ein Rechenfehler, der die neueste
     * Sicherung zum Loeschen vorschlaegt, waere der schlimmste denkbare - und
     * das Backup-Skript hat eine zweite Bremse davor.
     */
    const kennungen = Array.from(
      { length: 40 },
      (_wert, index) =>
        `2026-0${Math.floor(index / 28) + 8}-${String((index % 28) + 1).padStart(2, '0')}T030000Z`,
    );
    lege(...kennungen);
    const neueste = [...kennungen].sort().at(-1)!;
    expect(weg()).not.toContain(neueste);
  });

  it('behaelt je Woche eine und je Monat eine', () => {
    /*
     * Vier Sicherungen aus vier verschiedenen ISO-Wochen, alle aelter als
     * sieben Tage. Ohne die Wochenregel waeren alle vier weg.
     */
    lege(
      '2026-06-01T030000Z',
      '2026-07-01T030000Z',
      '2026-08-01T030000Z',
      '2026-09-01T030000Z',
      '2026-09-08T030000Z',
      '2026-09-15T030000Z',
      '2026-09-22T030000Z',
      '2026-09-26T030000Z',
    );
    const entfernt = weg(1, 4, 3);
    /*
     * Erwartet - und einmal von Hand nachgerechnet, weil die erste Fassung
     * dieses Tests hier falsch lag:
     *
     * - taeglich (1):   09-26
     * - Wochen (4):     W39 -> 09-26, W38 -> 09-15, W37 -> 09-08, W36 -> 09-01
     * - Monate (3):     09 -> 09-26, 08 -> 08-01, 07 -> 07-01
     *
     * 09-22 (Dienstag) liegt in derselben ISO-Woche wie 09-26 (Samstag), und je
     * Woche bleibt die **neueste**. Es faellt also heraus, obwohl es jung ist -
     * genau so soll eine Wochenregel wirken. Juni faellt heraus, weil es
     * ausserhalb aller drei Zeitraeume liegt.
     */
    expect(entfernt.sort()).toEqual(['2026-06-01T030000Z', '2026-09-22T030000Z']);
  });

  it('rechnet zweimal dasselbe aus', () => {
    lege(
      '2026-01-05T030000Z',
      '2026-03-05T030000Z',
      '2026-06-05T030000Z',
      '2026-09-05T030000Z',
      '2026-09-25T030000Z',
    );
    expect(weg()).toEqual(weg());
  });

  it('nennt nichts bei einem leeren Verzeichnis', () => {
    expect(weg()).toEqual([]);
  });

  it('uebergeht ein Verzeichnis ohne Manifest', () => {
    /*
     * Ein Verzeichnis ohne Manifest ist eine Sicherung, die es nicht bis zum
     * Ende geschafft hat. Sie zaehlt nirgends mit - auch nicht als eine der
     * sieben taeglichen, denn sonst verdraengte eine gescheiterte Sicherung
     * eine gute.
     */
    lege('2026-09-25T030000Z');
    mkdirSync(join(wurzel, '2026-09-26T030000Z'));
    expect(weg(1, 0, 0)).toEqual([]);
  });

  it('uebergeht, was keine Kennung ist', () => {
    // `uploads/` und `swisshub_2026-08-19.sql.gz` des alten Skripts liegen im
    // selben Backup-Verzeichnis. Sie gehoeren nicht hierher und werden nicht
    // angetastet.
    lege('2026-09-25T030000Z');
    mkdirSync(join(wurzel, 'uploads'));
    writeFileSync(join(wurzel, 'uploads', 'manifest.json'), '{"version":1}');
    expect(weg(1, 0, 0)).toEqual([]);
  });
});

describe('Der Fingerabdruck des Hauptschluessels', () => {
  let verzeichnis = '';

  beforeEach(() => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'swisshub-schluessel-'));
  });

  afterEach(() => {
    rmSync(verzeichnis, { recursive: true, force: true });
  });

  const SCHLUESSEL = 'aGVsbG8gd29ybGQgdGhpcyBpcyAzMiBieXRlcyE=';

  function envDatei(inhalt: string): string {
    const pfad = join(verzeichnis, '.env');
    writeFileSync(pfad, inhalt);
    return pfad;
  }

  it('gibt zwoelf Hexzeichen und niemals den Wert', () => {
    const abdruck = py(
      'fingerabdruck',
      envDatei(`MASTER_ENCRYPTION_KEY=${SCHLUESSEL}\n`),
      'MASTER_ENCRYPTION_KEY',
    ).trim();
    expect(abdruck).toMatch(/^[0-9a-f]{12}$/u);
    expect(abdruck).not.toContain(SCHLUESSEL);
    expect(SCHLUESSEL).not.toContain(abdruck);
  });

  it('gibt fuer denselben Schluessel denselben Abdruck', () => {
    // Sonst waere er als Vergleich mit der Offline-Kopie wertlos.
    const pfad = envDatei(`MASTER_ENCRYPTION_KEY=${SCHLUESSEL}\n`);
    expect(py('fingerabdruck', pfad, 'MASTER_ENCRYPTION_KEY')).toBe(
      py('fingerabdruck', pfad, 'MASTER_ENCRYPTION_KEY'),
    );
  });

  it('gibt fuer einen anderen Schluessel einen anderen Abdruck', () => {
    const eins = py(
      'fingerabdruck',
      envDatei(`MASTER_ENCRYPTION_KEY=${SCHLUESSEL}\n`),
      'MASTER_ENCRYPTION_KEY',
    );
    const zwei = py(
      'fingerabdruck',
      envDatei('MASTER_ENCRYPTION_KEY=etwasanderes\n'),
      'MASTER_ENCRYPTION_KEY',
    );
    expect(eins).not.toBe(zwei);
  });

  it('schweigt, wenn es den Schluessel nicht gibt', () => {
    expect(py('fingerabdruck', envDatei('ANDERE=1\n'), 'MASTER_ENCRYPTION_KEY')).toBe('');
    expect(py('fingerabdruck', join(verzeichnis, 'gibtsnicht'), 'MASTER_ENCRYPTION_KEY')).toBe('');
  });

  it('gibt Variablennamen und keinen einzigen Wert', () => {
    const pfad = envDatei(
      [
        '# Kommentar',
        `MASTER_ENCRYPTION_KEY=${SCHLUESSEL}`,
        'POSTGRES_PASSWORD=sehr-geheim',
        '',
        'AUTH_SECRET=auch-geheim',
      ].join('\n'),
    );
    const ausgabe = py('variablennamen', pfad);
    expect(ausgabe.split('\n').filter((zeile) => zeile !== '')).toEqual([
      'AUTH_SECRET',
      'MASTER_ENCRYPTION_KEY',
      'POSTGRES_PASSWORD',
    ]);
    expect(ausgabe).not.toContain(SCHLUESSEL);
    expect(ausgabe).not.toContain('sehr-geheim');
    expect(ausgabe).not.toContain('auch-geheim');
  });
});

describe('Das Statusverzeichnis', () => {
  let wurzel = '';

  beforeEach(() => {
    wurzel = mkdtempSync(join(tmpdir(), 'swisshub-status-'));
  });

  afterEach(() => {
    rmSync(wurzel, { recursive: true, force: true });
  });

  it('schreibt den Zustand lesbar und fortschreibend', () => {
    const status = join(wurzel, 'status');
    py('zustand', status, 'letzterLauf=2026-09-26T03:00:00Z', 'letzterLaufStatus=erfolgreich');
    py('zustand', status, 'letztePruefung=2026-09-26T04:00:00Z');

    const zustand = leseZustand(JSON.parse(readFileSync(join(status, 'zustand.json'), 'utf8')) as unknown);
    // Fortschreibend: der zweite Aufruf ersetzt nicht, was der erste schrieb.
    expect(zustand?.letzterLauf).toBe('2026-09-26T03:00:00Z');
    expect(zustand?.letztePruefung).toBe('2026-09-26T04:00:00Z');

    /*
     * `0644`. Die WebApp laeuft als anderer Benutzer in einem Container; ohne
     * Leserecht zeigte sie «nicht eingerichtet», obwohl alles laeuft. Das
     * Backup-Verzeichnis selbst bleibt 0700 - hier liegen nur Manifeste.
     */
    expect(statSync(join(status, 'zustand.json')).mode & 0o777).toBe(0o644);
  });

  it('macht aus einem leeren Wert null', () => {
    // Die Skripte loeschen einen Fehler durch `letzterFehler=` - ein leerer
    // Text waere im Dashboard eine Fehlermeldung ohne Inhalt.
    const status = join(wurzel, 'status');
    py('zustand', status, 'letzterFehler=etwas ging schief');
    py('zustand', status, 'letzterFehler=');
    const zustand = leseZustand(JSON.parse(readFileSync(join(status, 'zustand.json'), 'utf8')) as unknown);
    expect(zustand?.letzterFehler).toBeNull();
  });

  it('spiegelt Manifeste und raeumt verwaiste weg', () => {
    const sicherungen = join(wurzel, 'sicherungen');
    const status = join(wurzel, 'status');
    for (const kennung of ['2026-09-25T030000Z', '2026-09-26T030000Z']) {
      mkdirSync(join(sicherungen, kennung), { recursive: true });
      writeFileSync(join(sicherungen, kennung, 'manifest.json'), `{"version":1,"id":"${kennung}"}`);
    }
    py('spiegle', sicherungen, status);
    expect(readdirSync(join(status, 'sicherungen')).sort()).toEqual([
      '2026-09-25T030000Z.json',
      '2026-09-26T030000Z.json',
    ]);

    // Die Aufbewahrung entfernt eine Sicherung - das Manifest darf nicht
    // liegenbleiben, sonst zeigte das Dashboard sie fuer immer weiter.
    rmSync(join(sicherungen, '2026-09-25T030000Z'), { recursive: true });
    py('spiegle', sicherungen, status);
    expect(readdirSync(join(status, 'sicherungen'))).toEqual(['2026-09-26T030000Z.json']);
  });

  it('spiegelt nur Manifeste, nie eine Nutzdatei', () => {
    /*
     * Die Zusage, auf der die Sicherheit der Oberflaeche ruht: in das
     * Verzeichnis, das die WebApp lesen kann, gelangt kein Datenbankexport.
     */
    const sicherungen = join(wurzel, 'sicherungen');
    const status = join(wurzel, 'status');
    mkdirSync(join(sicherungen, '2026-09-26T030000Z'), { recursive: true });
    writeFileSync(join(sicherungen, '2026-09-26T030000Z', 'manifest.json'), '{"version":1}');
    writeFileSync(join(sicherungen, '2026-09-26T030000Z', 'datenbank.sql.gz'), 'SEHR GEHEIM');
    writeFileSync(join(sicherungen, '2026-09-26T030000Z', 'geheimnisse.tar.gz.age'), 'AUCH GEHEIM');
    py('spiegle', sicherungen, status);

    const gespiegelt = readdirSync(join(status, 'sicherungen'));
    expect(gespiegelt).toEqual(['2026-09-26T030000Z.json']);
    for (const name of gespiegelt) {
      const inhalt = readFileSync(join(status, 'sicherungen', name), 'utf8');
      expect(inhalt).not.toContain('GEHEIM');
    }
  });
});

describe('Die Beurteilung fuer die Oberflaeche', () => {
  const manifest = (
    id: string,
    integritaet: 'ungeprueft' | 'bestanden' | 'gescheitert',
    restore: 'ungeprueft' | 'bestanden' | 'gescheitert',
    bytes = 1000,
  ): BackupManifest => ({
    version: 1,
    id,
    erstelltAm: '2026-09-26T03:00:00Z',
    typ: 'vollstaendig',
    status: 'abgeschlossen',
    host: 'testhost',
    komponenten: ['datenbank'],
    dateien: [],
    bytesGesamt: bytes,
    postgresVersion: '16.13',
    gitCommit: null,
    datenbank: 'direkt',
    uploadVerzeichnis: null,
    schluesselFingerabdruck: null,
    geheimnisse: 'nicht gesichert',
    integritaet: { status: integritaet, am: null, meldung: null },
    restoreTest: { status: restore, am: null, meldung: null },
  });

  it('sagt bei nichts, dass nichts eingerichtet ist', () => {
    // Und nicht «alles in Ordnung». Ein leerer Zustand ist kein guter Zustand.
    const befund = beurteile([], null);
    expect(befund.eingerichtet).toBe(false);
    expect(befund.gepruefteVorhanden).toBe(false);
    expect(befund.keinRestoreTest).toBe(false);
  });

  it('meldet, wenn nie eine Sicherung zurueckgelesen wurde', () => {
    const befund = beurteile([manifest('2026-09-26T030000Z', 'bestanden', 'ungeprueft')], null);
    expect(befund.gepruefteVorhanden).toBe(true);
    expect(befund.restoreGetestet).toBe(false);
    expect(befund.keinRestoreTest).toBe(true);
  });

  it('nennt jede beanstandete Sicherung', () => {
    const befund = beurteile(
      [
        manifest('2026-09-26T030000Z', 'bestanden', 'bestanden'),
        manifest('2026-09-25T030000Z', 'gescheitert', 'ungeprueft'),
        manifest('2026-09-24T030000Z', 'bestanden', 'gescheitert'),
      ],
      null,
    );
    expect(befund.beanstandet.map((eintrag) => eintrag.id)).toEqual([
      '2026-09-25T030000Z',
      '2026-09-24T030000Z',
    ]);
    // Eine gute daneben macht die schlechten nicht unsichtbar.
    expect(befund.restoreGetestet).toBe(true);
  });

  it('rechnet die belegten Bytes aus den Manifesten', () => {
    expect(
      belegteBytes([
        manifest('2026-09-26T030000Z', 'bestanden', 'bestanden', 1500),
        manifest('2026-09-25T030000Z', 'bestanden', 'bestanden', 2500),
      ]),
    ).toBe(4000);
  });
});

describe('Die Umrechnung der Texte aus den Skripten', () => {
  it('macht aus Text eine Zahl, und aus Unsinn nichts', () => {
    // Die Skripte schreiben mit `printf` - alles ist Text, und manches fehlt.
    expect(alsZahl('42')).toBe(42);
    expect(alsZahl('0')).toBe(0);
    expect(alsZahl('')).toBeNull();
    expect(alsZahl(null)).toBeNull();
    expect(alsZahl(undefined)).toBeNull();
    expect(alsZahl('keine Zahl')).toBeNull();
  });

  it('macht aus Text ein Datum, und aus Unsinn nichts', () => {
    expect(alsDatum('2026-09-26T03:00:00Z')?.toISOString()).toBe('2026-09-26T03:00:00.000Z');
    expect(alsDatum('')).toBeNull();
    expect(alsDatum(null)).toBeNull();
    expect(alsDatum('irgendwann')).toBeNull();
  });
});
