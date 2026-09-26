import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { leseManifest, leseZustand } from '@swisshub/modules/backup/manifest';
import { TEST_DATABASE_URL, describeWithDatabase } from '../helpers/database';

/**
 * Die Sicherung gegen eine echte Datenbank.
 *
 * ## Warum dieser Test nicht mit einer Nachbildung geht
 *
 * Weil genau das geprueft werden soll, was eine Nachbildung nicht hat: dass
 * `pg_dump` einen Export schreibt, den `psql` wieder annimmt. Ein Backup ist
 * erst dann ein Backup, wenn es einmal zurueckgelesen wurde - und «einmal
 * zurueckgelesen» ist keine Eigenschaft, die man nachbilden kann.
 *
 * ## Was hier isoliert ist
 *
 * Jeder Lauf legt eine **eigene Datenbank** an (`swisshub_backup_test_<zufall>`)
 * und entfernt sie danach. Die Testdatenbank der uebrigen Integrationstests
 * wird nur als Verbindung benutzt, nie beschrieben: `pg_dump` sichert eine
 * ganze Datenbank, und liefe der Test gegen das gemeinsame Schema, saehe er die
 * Tabellen aller parallel laufenden Dateien.
 *
 * Die produktive Datenbank kann dieser Test nicht erreichen: `pruefe_umgebung`
 * unten besteht darauf, dass der Datenbankname mit `swisshub_backup_test_`
 * beginnt.
 */

const WURZEL = process.cwd();
const BIN = join(WURZEL, 'deploy/backup/bin');

interface Lauf {
  code: number;
  ausgabe: string;
}

describeWithDatabase('Backup & Recovery gegen eine echte Datenbank', () => {
  /** Die Verbindung zur Verwaltung - dort wird die Wegwerf-Datenbank angelegt. */
  const verwaltung = new URL(TEST_DATABASE_URL);
  verwaltung.search = '';
  verwaltung.pathname = '/postgres';

  const datenbankName = `swisshub_backup_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const quelle = new URL(TEST_DATABASE_URL);
  quelle.search = '';
  quelle.pathname = `/${datenbankName}`;

  let arbeit = '';
  let backupDir = '';
  let statusDir = '';
  let uploadDir = '';
  let appEnv = '';

  const SCHLUESSEL = 'aGVsbG8gd29ybGQgdGhpcyBpcyAzMiBieXRlcyE=';
  const PASSWORT = 'ein-sehr-geheimes-passwort-4711';

  function psql(url: string, sql: string): string {
    return execFileSync('psql', ['-tAX', '-v', 'ON_ERROR_STOP=1', '-c', sql, url], {
      encoding: 'utf8',
    });
  }

  /**
   * Ein Backup-Werkzeug ausfuehren und Code samt **beiden** Ausgabestroemen
   * zurueckgeben.
   *
   * `spawnSync` und nicht `execFileSync`: das Letztere gibt bei Erfolg nur
   * `stdout` zurueck. Die Warnungen der Skripte gehen nach `stderr` - und die
   * wichtigste davon ist «es wird nichts geloescht», die bei Exit-Code 0
   * erscheint. Der erste Lauf dieses Tests hat sie genau deshalb nicht
   * gesehen.
   */
  function starte(programm: string, argumente: string[] = [], zusatz: Record<string, string> = {}): Lauf {
    const umgebung: Record<string, string> = {
      ...process.env,
      // Keine Konfigurationsdatei des Servers - der Test bestimmt alles selbst.
      SWISSHUB_BACKUP_ENV_FILE: '/dev/null',
      SWISSHUB_BACKUP_DIR: backupDir,
      SWISSHUB_BACKUP_STATUS_DIR: statusDir,
      SWISSHUB_UPLOAD_DIR: uploadDir,
      SWISSHUB_BACKUP_APP_ENV: appEnv,
      SWISSHUB_PROJECT_DIR: WURZEL,
      DATABASE_URL: quelle.toString(),
      ...zusatz,
    };
    const ergebnis = spawnSync(join(BIN, programm), argumente, {
      encoding: 'utf8',
      env: umgebung,
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      code: ergebnis.status ?? -1,
      ausgabe: `${ergebnis.stdout ?? ''}${ergebnis.stderr ?? ''}`,
    };
  }

  function kennungen(): string[] {
    const pfad = join(backupDir, 'sicherungen');
    return existsSync(pfad) ? readdirSync(pfad).sort() : [];
  }

  function manifestVon(kennung: string): ReturnType<typeof leseManifest> {
    return leseManifest(
      JSON.parse(readFileSync(join(backupDir, 'sicherungen', kennung, 'manifest.json'), 'utf8')) as unknown,
    );
  }

  function zustand(): ReturnType<typeof leseZustand> {
    const pfad = join(statusDir, 'zustand.json');
    return existsSync(pfad) ? leseZustand(JSON.parse(readFileSync(pfad, 'utf8')) as unknown) : null;
  }

  beforeAll(() => {
    /*
     * Die Sicherheitsleine dieses Tests. Er legt Datenbanken an und spielt
     * Exporte ein; ein falsch gesetztes `DATABASE_URL` waere hier teuer.
     */
    expect(datenbankName.startsWith('swisshub_backup_test_')).toBe(true);

    // Ohne `pg_dump` kann dieser Test nichts beweisen - und soll dann laut
    // scheitern und nicht still uebersprungen werden.
    expect(() => execFileSync('pg_dump', ['--version'], { stdio: 'pipe' })).not.toThrow();

    psql(verwaltung.toString(), `CREATE DATABASE "${datenbankName}"`);
    psql(
      quelle.toString(),
      `CREATE TYPE stimmung AS ENUM ('gut', 'mittel', 'schlecht');
       CREATE TABLE mitglied (
         id serial PRIMARY KEY,
         name text NOT NULL,
         laune stimmung NOT NULL DEFAULT 'gut',
         daten jsonb,
         angelegt timestamptz NOT NULL DEFAULT now()
       );
       CREATE TABLE stimme (
         id serial PRIMARY KEY,
         mitglied_id integer NOT NULL REFERENCES mitglied(id),
         wert integer NOT NULL
       );
       INSERT INTO mitglied (name, laune, daten)
         SELECT 'Mitglied ' || i, (ARRAY['gut','mittel','schlecht']::stimmung[])[1 + (i % 3)],
                jsonb_build_object('nummer', i, 'text', 'Apostroph '' und Anfuehrung "')
         FROM generate_series(1, 250) i;
       INSERT INTO stimme (mitglied_id, wert) SELECT id, id % 7 FROM mitglied;`,
    );
  });

  afterAll(() => {
    try {
      psql(verwaltung.toString(), `DROP DATABASE IF EXISTS "${datenbankName}" WITH (FORCE)`);
    } catch {
      // Ein Aufraeumfehler soll den Testlauf nicht roetlich faerben.
    }
    if (arbeit !== '') {
      rmSync(arbeit, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (arbeit !== '') {
      rmSync(arbeit, { recursive: true, force: true });
    }
    arbeit = mkdtempSync(join(tmpdir(), 'swisshub-backup-e2e-'));
    backupDir = join(arbeit, 'backups');
    statusDir = join(arbeit, 'status');
    uploadDir = join(arbeit, 'uploads');
    appEnv = join(arbeit, 'app.env');

    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(join(uploadDir, 'logo-abc.png'), 'ein Logo');
    writeFileSync(join(uploadDir, 'clip-00112233445566778899aabbccddeeff.mp4'), 'ein Clip');
    // Ein Name, an dem naives Shell-Quoting zerbricht.
    writeFileSync(join(uploadDir, "datei mit leerzeichen und 'apostroph'.png"), 'x');

    writeFileSync(
      appEnv,
      [
        `MASTER_ENCRYPTION_KEY=${SCHLUESSEL}`,
        `POSTGRES_PASSWORD=${PASSWORT}`,
        'DISCORD_BOT_TOKEN=MTAwMC.geheim.nicht-echt',
        'AUTH_SECRET=auch-geheim-und-mindestens-32-zeichen-lang',
      ].join('\n'),
    );
  });

  // --- Sichern ---------------------------------------------------------------

  it('erstellt eine vollstaendige, gepruefte Sicherung', () => {
    const lauf = starte('swisshub-backup');
    expect(lauf.code, lauf.ausgabe).toBe(0);
    expect(kennungen()).toHaveLength(1);

    const manifest = manifestVon(kennungen()[0]!)!;
    expect([...manifest.komponenten].sort()).toEqual(['dateien', 'datenbank', 'umgebung']);
    expect(manifest.postgresVersion).toMatch(/^1[6-9]/u);
    // Der Commit, auf dem der Server stand - die Angabe, die nach einer
    // Wiederherstellung sagt, welcher Codestand zu diesen Daten passte.
    expect(manifest.gitCommit).toMatch(/^[0-9a-f]{40}$/u);
    // Beim Erstellen geprueft: was die Pruefung nicht besteht, wird nie eine
    // Sicherung.
    expect(manifest.integritaet.status).toBe('bestanden');
    // Und ausdruecklich noch nicht zurueckgelesen.
    expect(manifest.restoreTest.status).toBe('ungeprueft');

    expect(starte('swisshub-backup-verify').code).toBe(0);
  });

  it('haelt die Rechte streng und das Statusverzeichnis lesbar', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;

    /*
     * Die Sicherungen gehoeren nur root: `0700` auf dem Verzeichnis, `0600` auf
     * jeder Datei. Das Statusverzeichnis dagegen muss lesbar sein - die WebApp
     * laeuft als anderer Benutzer in einem Container.
     */
    expect(statSync(join(backupDir, 'sicherungen', kennung)).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(join(backupDir, 'sicherungen', kennung))) {
      expect(statSync(join(backupDir, 'sicherungen', kennung, name)).mode & 0o777, name).toBe(0o600);
    }
    expect(statSync(statusDir).mode & 0o777).toBe(0o755);
    expect(statSync(join(statusDir, 'zustand.json')).mode & 0o777).toBe(0o644);
  });

  it('traegt kein Geheimnis in die Sicherung und keines in den Status', () => {
    /*
     * Die Zusage, die am meisten zaehlt. Laege der `MASTER_ENCRYPTION_KEY`
     * neben dem Datenbankexport, haette jeder, der die Sicherung hat, beides -
     * und die Verschluesselung der Integrationen waere nur so viel wert wie der
     * Zugriffsschutz des Backup-Verzeichnisses.
     */
    expect(starte('swisshub-backup').code).toBe(0);

    const durchsuche = (verzeichnis: string): string[] =>
      readdirSync(verzeichnis, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) {
          return durchsuche(pfad);
        }
        // Auch die komprimierten Dateien: ein Geheimnis im Dump waere durch
        // gzip nur unsichtbar, nicht abwesend.
        const inhalt = eintrag.name.endsWith('.gz')
          ? execFileSync('gzip', ['-cd', pfad], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
          : readFileSync(pfad, 'utf8');
        return [SCHLUESSEL, PASSWORT, 'MTAwMC.geheim.nicht-echt'].some((wert) => inhalt.includes(wert))
          ? [pfad]
          : [];
      });

    expect(durchsuche(backupDir)).toEqual([]);
    expect(durchsuche(statusDir)).toEqual([]);

    // Was stattdessen darinsteht: die Namen, und ein Fingerabdruck.
    const umgebung = readFileSync(join(backupDir, 'sicherungen', kennungen()[0]!, 'umgebung.txt'), 'utf8');
    expect(umgebung).toContain('MASTER_ENCRYPTION_KEY');
    expect(umgebung).not.toContain(SCHLUESSEL);
    expect(manifestVon(kennungen()[0]!)?.schluesselFingerabdruck).toMatch(/^[0-9a-f]{12}$/u);
  });

  it('sichert die hochgeladenen Dateien mitsamt schwierigen Namen', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const archiv = join(backupDir, 'sicherungen', kennungen()[0]!, 'dateien.tar.gz');
    const liste = execFileSync('tar', ['-tzf', archiv], { encoding: 'utf8' });
    expect(liste).toContain('logo-abc.png');
    expect(liste).toContain('clip-00112233445566778899aabbccddeeff.mp4');
    expect(liste).toContain("datei mit leerzeichen und 'apostroph'.png");
  });

  // --- Wenn es schiefgeht ----------------------------------------------------

  it('legt keine Sicherung ab, wenn der Datenbankexport scheitert', () => {
    /*
     * Und, wichtiger: die vorhandene bleibt unversehrt. Ein gescheiterter Lauf
     * darf die letzte funktionierende Sicherung nicht kosten - das ist die
     * Eigenschaft, wegen der in `.arbeit/` gearbeitet und erst am Ende
     * umbenannt wird.
     */
    expect(starte('swisshub-backup').code).toBe(0);
    const vorher = kennungen();
    const inhaltVorher = readFileSync(join(backupDir, 'sicherungen', vorher[0]!, 'datenbank.sql.gz'));

    const kaputt = new URL(quelle.toString());
    kaputt.pathname = '/gibt-es-nicht';
    const lauf = starte('swisshub-backup', [], { DATABASE_URL: kaputt.toString() });

    expect(lauf.code).toBe(5);
    expect(kennungen()).toEqual(vorher);
    expect(readFileSync(join(backupDir, 'sicherungen', vorher[0]!, 'datenbank.sql.gz'))).toEqual(
      inhaltVorher,
    );
    // Kein Arbeitsverzeichnis bleibt liegen.
    expect(readdirSync(join(backupDir, '.arbeit'))).toEqual([]);
    // Und der Fehlschlag steht im Status - sonst zeigte das Dashboard
    // weiterhin den letzten Erfolg, und niemand wuesste, dass seit Wochen
    // nichts mehr gelingt.
    expect(zustand()?.letzterLaufStatus).toBe('gescheitert');
    expect(zustand()?.letzterFehler).toBeTruthy();
  });

  it('bricht ab, bevor der Platz ausgeht', () => {
    const lauf = starte('swisshub-backup', [], { SWISSHUB_BACKUP_MIN_FREE_MB: '99999999' });
    expect(lauf.code).toBe(4);
    expect(lauf.ausgabe).toContain('Zu wenig Platz');
    // Nichts geschrieben: die Pruefung kommt vor dem ersten Byte.
    expect(kennungen()).toEqual([]);
  });

  it('bricht ab, wenn die Uploads ueber der Grenze liegen', () => {
    const lauf = starte('swisshub-backup', [], { SWISSHUB_BACKUP_DATEIEN_MAX_MB: '0' });
    expect(lauf.code).toBe(6);
    // Ausdruecklich ein Abbruch und keine stille Auslassung: sonst fehlten die
    // Dateien monatelang, ohne dass es jemandem auffiele.
    expect(lauf.ausgabe).toContain('Grenze');
    expect(kennungen()).toEqual([]);
  });

  it('laesst nur einen Lauf gleichzeitig', () => {
    /*
     * Zwei Laeufe schreiben in dasselbe Verzeichnis, raeumen nach derselben
     * Regel auf und koennen sich die Datei unter den Fuessen wegloeschen.
     *
     * Die Sperre wird hier von aussen gehalten - `flock` auf derselben Datei.
     * Das prueft genau den Mechanismus und nicht das Timing zweier Prozesse,
     * die sich zufaellig treffen muessten.
     */
    mkdirSync(join(backupDir, 'sicherungen'), { recursive: true });
    const sperre = join(backupDir, '.sperre');
    writeFileSync(sperre, '');
    const halter = spawn('flock', ['-x', sperre, '-c', 'sleep 5'], { stdio: 'ignore' });
    try {
      // Kurz warten, bis `flock` die Sperre wirklich hat.
      execFileSync('sleep', ['0.5']);
      const lauf = starte('swisshub-backup');
      expect(lauf.code).toBe(3);
      expect(lauf.ausgabe).toContain('laeuft bereits');
      expect(kennungen()).toEqual([]);
    } finally {
      halter.kill('SIGKILL');
    }
  });

  // --- Pruefen ---------------------------------------------------------------

  it('erkennt eine beschaedigte Sicherung und vermerkt sie', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;
    const pfad = join(backupDir, 'sicherungen', kennung, 'datenbank.sql.gz');

    // Ein einzelnes Byte, gleiche Laenge: nur die Pruefsumme findet das.
    const inhalt = readFileSync(pfad);
    const stelle = Math.floor(inhalt.length / 2);
    inhalt[stelle] = (inhalt[stelle] ?? 0) ^ 0xff;
    writeFileSync(pfad, inhalt);

    const lauf = starte('swisshub-backup-verify');
    expect(lauf.code).toBe(7);
    expect(manifestVon(kennung)?.integritaet.status).toBe('gescheitert');
    // Der Vermerk bleibt am Manifest, damit das Dashboard die defekte
    // Sicherung als defekt zeigt, statt sie mitzuzaehlen.
    expect(manifestVon(kennung)?.integritaet.meldung).toBeTruthy();
    expect(zustand()?.letztePruefungStatus).toBe('gescheitert');
  });

  // --- Aufbewahrung ----------------------------------------------------------

  it('entfernt nur, was aus der Aufbewahrung faellt', () => {
    // Zwei Sicherungen vortaeuschen, die aelter sind als die Aufbewahrung.
    expect(starte('swisshub-backup').code).toBe(0);
    const echte = kennungen()[0]!;

    const alt = ['2020-01-01T030000Z', '2020-01-02T030000Z'];
    for (const kennung of alt) {
      const ziel = join(backupDir, 'sicherungen', kennung);
      mkdirSync(ziel);
      execFileSync('cp', ['-a', `${join(backupDir, 'sicherungen', echte)}/.`, ziel]);
    }
    expect(kennungen()).toHaveLength(3);

    // Mit 1/0/0 bleibt genau die neueste.
    const lauf = starte('swisshub-backup', [], {
      SWISSHUB_BACKUP_KEEP_DAILY: '1',
      SWISSHUB_BACKUP_KEEP_WEEKLY: '0',
      SWISSHUB_BACKUP_KEEP_MONTHLY: '0',
    });
    expect(lauf.code, lauf.ausgabe).toBe(0);

    const uebrig = kennungen();
    expect(uebrig).toHaveLength(1);
    // Die Sicherung dieses Laufs - nicht eine der alten.
    expect(uebrig[0]! > echte).toBe(true);
    // Und die Manifeste im Status sind mitgewandert.
    expect(readdirSync(join(statusDir, 'sicherungen'))).toEqual([`${uebrig[0]!}.json`]);
  });

  it('loescht nichts, wenn die neueste Sicherung die Pruefung nicht besteht', () => {
    /*
     * Die zweite Bremse. Ein defekter Lauf darf nicht dazu fuehren, dass die
     * aelteren, die noch gut waren, verschwinden - und genau das waere die
     * Folge einer Aufbewahrung, die ungeprueft loescht.
     *
     * Aufgebaut wird das so: zwei Sicherungen, dann wird die **neuere**
     * beschaedigt, danach die Aufbewahrung mit 1/0/0 angestossen. Ohne die
     * Bremse waere die aeltere - die intakte - weg.
     */
    expect(starte('swisshub-backup').code).toBe(0);
    const erste = kennungen()[0]!;
    const zweite = '2999-01-01T030000Z';
    const ziel = join(backupDir, 'sicherungen', zweite);
    mkdirSync(ziel);
    execFileSync('cp', ['-a', `${join(backupDir, 'sicherungen', erste)}/.`, ziel]);
    rmSync(join(ziel, 'datenbank.sql.gz'));

    const lauf = starte('swisshub-backup-verify');
    expect(lauf.code).toBe(7);

    // Jetzt aufraeumen lassen - mit einer Aufbewahrung, die alles ausser der
    // neuesten entfernen wuerde.
    const zweiterLauf = starte('swisshub-backup', [], {
      SWISSHUB_BACKUP_KEEP_DAILY: '1',
      SWISSHUB_BACKUP_KEEP_WEEKLY: '0',
      SWISSHUB_BACKUP_KEEP_MONTHLY: '0',
    });
    expect(zweiterLauf.code, zweiterLauf.ausgabe).toBe(0);
    expect(zweiterLauf.ausgabe).toContain('es wird nichts geloescht');
    // Die intakte erste Sicherung ist noch da.
    expect(kennungen()).toContain(erste);
  });

  // --- Restore-Test ----------------------------------------------------------

  it('spielt die Sicherung wirklich in eine isolierte Datenbank ein', () => {
    /*
     * Der Test, der aus einer Datei eine Sicherung macht. Bestanden ist er nur,
     * wenn die Zahl der Tabellen **und** der Datenzeilen dem entspricht, was im
     * Export steht - ein Restore, der das Schema aufbaut und die Daten
     * verliert, laeuft ohne Fehlermeldung durch.
     */
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;

    const lauf = starte('swisshub-restore-test');
    expect(lauf.code, lauf.ausgabe).toBe(0);
    // 2 Tabellen, 250 + 250 Zeilen.
    expect(lauf.ausgabe).toContain('Wiederhergestellt: 2 Tabellen, 500 Zeilen');

    const manifest = manifestVon(kennung)!;
    expect(manifest.restoreTest.status).toBe('bestanden');
    expect(manifest.restoreTest.meldung).toContain('500 Zeilen');
    expect(zustand()?.letzterRestoreTestStatus).toBe('bestanden');

    // Die Wegwerf-Datenbank ist wieder weg - sonst sammelte sich jede Woche
    // eine weitere an.
    const uebrig = psql(
      verwaltung.toString(),
      "SELECT count(*) FROM pg_database WHERE datname LIKE 'swisshub_restoretest_%'",
    ).trim();
    expect(uebrig).toBe('0');
  });

  it('verweigert den Restore-Test bei beschaedigter Sicherung', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;
    writeFileSync(join(backupDir, 'sicherungen', kennung, 'datenbank.sql.gz'), 'kein gzip');

    const lauf = starte('swisshub-restore-test');
    expect(lauf.code).toBe(7);
    expect(manifestVon(kennung)?.restoreTest.status).toBe('gescheitert');
  });

  // --- Recovery-CLI ----------------------------------------------------------

  it('gibt Auskunft ueber die vorhandenen Sicherungen', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;

    const liste = starte('swisshub-recovery', ['liste']);
    expect(liste.code, liste.ausgabe).toBe(0);
    expect(liste.ausgabe).toContain(kennung);
    expect(liste.ausgabe).toContain('bestanden');

    const zeige = starte('swisshub-recovery', ['zeige', kennung]);
    expect(zeige.code, zeige.ausgabe).toBe(0);
    expect(zeige.ausgabe).toContain('Fingerabdruck, nicht der Wert');
    // Keine Zeile der Auskunft enthaelt ein Geheimnis.
    expect(zeige.ausgabe).not.toContain(SCHLUESSEL);
    expect(zeige.ausgabe).not.toContain(PASSWORT);

    const plan = starte('swisshub-recovery', ['plan', kennung]);
    expect(plan.code, plan.ausgabe).toBe(0);
    expect(plan.ausgabe).toContain('Wiederherstellungsplan');
    expect(plan.ausgabe).toContain('Sicherheitssicherung');
    // Der Plan sagt ausdruecklich, was er nicht mitbringt.
    expect(plan.ausgabe).toContain('MASTER_ENCRYPTION_KEY');
  });

  it('nennt eine Kennung, die es nicht gibt, statt irgendetwas zu tun', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const lauf = starte('swisshub-recovery', ['zeige', '1999-01-01T000000Z']);
    expect(lauf.code).toBe(1);
    expect(lauf.ausgabe).toContain('Keine Sicherung');
  });

  // --- Wiederherstellung -----------------------------------------------------

  it('verweigert eine produktive Wiederherstellung ohne bewusste Bestaetigung', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;
    const vorher = psql(quelle.toString(), 'SELECT count(*) FROM mitglied').trim();

    for (const argumente of [
      ['wiederherstellen', kennung],
      ['wiederherstellen', kennung, '--ziel', 'produktion'],
      ['wiederherstellen', kennung, '--ziel', 'produktion', '--bestaetigen', 'ja'],
    ]) {
      const lauf = starte('swisshub-recovery', argumente);
      expect(lauf.code, argumente.join(' ')).toBe(2);
      expect(lauf.ausgabe).toMatch(/Es wurde nichts geaendert|Ohne diese Angabe passiert nichts/u);
    }

    // Unveraendert, dreimal abgelehnt.
    expect(psql(quelle.toString(), 'SELECT count(*) FROM mitglied').trim()).toBe(vorher);
    expect(kennungen()).toHaveLength(1);
  });

  it('stellt Datenbank und Dateien wieder her - mit Rueckweg', () => {
    /*
     * Der Ernstfall, einmal durchgespielt. Ziel ist die Wegwerf-Datenbank
     * dieses Tests, also derselbe Codepfad wie in der Produktion.
     */
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;

    // Etwas kaputt machen, das die Sicherung noch kennt.
    psql(quelle.toString(), 'DELETE FROM stimme; DELETE FROM mitglied;');
    expect(psql(quelle.toString(), 'SELECT count(*) FROM mitglied').trim()).toBe('0');
    rmSync(join(uploadDir, 'logo-abc.png'));

    const lauf = starte('swisshub-recovery', [
      'wiederherstellen',
      kennung,
      '--ziel',
      'produktion',
      '--bestaetigen',
      kennung,
    ]);
    expect(lauf.code, lauf.ausgabe).toBe(0);

    // Die Daten sind zurueck.
    expect(psql(quelle.toString(), 'SELECT count(*) FROM mitglied').trim()).toBe('250');
    expect(psql(quelle.toString(), 'SELECT count(*) FROM stimme').trim()).toBe('250');
    // Auch die Aufzaehlung und das JSON - nicht nur die Zeilenzahl.
    expect(psql(quelle.toString(), 'SELECT laune::text FROM mitglied WHERE id = 1').trim()).toBe('mittel');
    expect(psql(quelle.toString(), "SELECT daten->>'text' FROM mitglied WHERE id = 1").trim()).toBe(
      'Apostroph \' und Anfuehrung "',
    );

    // Die Datei ist zurueck.
    expect(existsSync(join(uploadDir, 'logo-abc.png'))).toBe(true);
    // Der bisherige Stand der Uploads wurde beiseitegelegt und nicht geloescht.
    expect(readdirSync(arbeit).some((name) => name.startsWith('uploads.vor-restore-'))).toBe(true);

    // Und der Rueckweg: eine zusaetzliche Sicherung von vor der
    // Wiederherstellung.
    expect(kennungen().length).toBe(2);
    expect(lauf.ausgabe).toContain('Rueckweg');
  });

  it('stellt nicht wieder her, wenn die Sicherung beschaedigt ist', () => {
    expect(starte('swisshub-backup').code).toBe(0);
    const kennung = kennungen()[0]!;
    writeFileSync(join(backupDir, 'sicherungen', kennung, 'datenbank.sql.gz'), 'kein gzip');
    const vorher = psql(quelle.toString(), 'SELECT count(*) FROM mitglied').trim();

    const lauf = starte('swisshub-recovery', [
      'wiederherstellen',
      kennung,
      '--ziel',
      'produktion',
      '--bestaetigen',
      kennung,
    ]);
    expect(lauf.code).toBe(7);
    expect(lauf.ausgabe).toContain('Es wurde nichts geaendert');
    expect(psql(quelle.toString(), 'SELECT count(*) FROM mitglied').trim()).toBe(vorher);
  });

  it('nur die Datenbank, wenn darum gebeten', () => {
    // Fuer eine Installation mit vielen Gigabyte Uploads: die Datenbank
    // taeglich, die Dateien seltener. Der Typ steht im Manifest, damit spaeter
    // niemand eine Sicherung fuer vollstaendig haelt, die es nicht ist.
    const lauf = starte('swisshub-backup', ['--nur-datenbank']);
    expect(lauf.code, lauf.ausgabe).toBe(0);
    const manifest = manifestVon(kennungen()[0]!)!;
    expect(manifest.typ).toBe('nur-datenbank');
    expect(manifest.komponenten).not.toContain('dateien');
    expect(existsSync(join(backupDir, 'sicherungen', kennungen()[0]!, 'dateien.tar.gz'))).toBe(false);
  });

  it('versiegelt die Geheimnisse nur, wenn Empfaenger eingerichtet sind', () => {
    /*
     * Der optionale age-Weg. Er ist ausdruecklich nicht die Vorgabe - der
     * Grund steht im README: der Hauptschluessel neben dem Datenbankexport ist
     * der Schluessel am selben Bund wie das Schloss.
     *
     * Ist `age` nicht installiert, wird das Paket nicht geschrieben **und nicht
     * behauptet**. Genau das prueft der Test auch, wenn `age` fehlt: dann muss
     * im Manifest «nicht gesichert» stehen, und nicht etwas Beruhigendes.
     */
    const hatAge = (() => {
      try {
        execFileSync('age', ['--version'], { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

    if (!hatAge) {
      const lauf = starte('swisshub-backup', [], {
        SWISSHUB_BACKUP_AGE_RECIPIENTS: 'age1nurbeispiel',
      });
      expect(lauf.code, lauf.ausgabe).toBe(0);
      expect(manifestVon(kennungen()[0]!)?.geheimnisse).toBe('nicht gesichert (age fehlt)');
      return;
    }

    // Ein Schluesselpaar, das nur in diesem Test existiert.
    const schluesselDatei = join(arbeit, 'age.key');
    execFileSync('age-keygen', ['-o', schluesselDatei], { stdio: 'pipe' });
    const oeffentlich = /public key: (age1\S+)/iu.exec(readFileSync(schluesselDatei, 'utf8'))?.[1];
    expect(oeffentlich).toBeTruthy();

    const lauf = starte('swisshub-backup', [], {
      SWISSHUB_BACKUP_AGE_RECIPIENTS: oeffentlich!,
    });
    expect(lauf.code, lauf.ausgabe).toBe(0);

    const kennung = kennungen()[0]!;
    const versiegelt = join(backupDir, 'sicherungen', kennung, 'geheimnisse.tar.gz.age');
    expect(existsSync(versiegelt)).toBe(true);
    expect(manifestVon(kennung)?.geheimnisse).toContain('age');
    expect(manifestVon(kennung)?.komponenten).toContain('geheimnisse');

    // Im Paket steht kein Klartext - der Server kann es nach dem Schreiben
    // selbst nicht mehr lesen.
    expect(readFileSync(versiegelt, 'utf8')).not.toContain(SCHLUESSEL);

    // Und mit dem privaten Schluessel geht es auf, mit einem fremden nicht.
    const entschluesselt = execFileSync('age', ['--decrypt', '-i', schluesselDatei, versiegelt], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const entpackt = spawnSync('tar', ['-xzO'], { input: entschluesselt, encoding: 'utf8' });
    expect(entpackt.stdout).toContain(SCHLUESSEL);

    const fremd = join(arbeit, 'fremd.key');
    execFileSync('age-keygen', ['-o', fremd], { stdio: 'pipe' });
    const mitFremdem = spawnSync('age', ['--decrypt', '-i', fremd, versiegelt], { encoding: 'utf8' });
    expect(mitFremdem.status).not.toBe(0);
  });

  it('meldet einen unbekannten Aufruf statt etwas zu erraten', () => {
    expect(starte('swisshub-backup', ['--gibtsnicht']).code).toBe(2);
    expect(starte('swisshub-recovery', ['loeschalles']).code).toBe(2);
  });
});
