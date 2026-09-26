import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Backup-Werkzeuge - und der Zaun um sie herum.
 *
 * ## Warum dieser Test der wichtigste dieser Aufgabe ist
 *
 * Am 25.09.2026 fiel der Discord-Bot aus, und zwar wegen eines Backups. Die
 * damalige Implementierung lag in `packages/modules`, und drei ihrer Dateien
 * begannen mit `import 'server-only'`. Ueber ein Barrel wurden sie Teil von
 * `@swisshub/modules` - also Teil dessen, was der Bot beim Start laedt.
 * `server-only` wirft in jedem Node-Prozess, der kein Next.js ist.
 *
 * Die Pipeline war gruen. `tsc --noEmit` sieht keinen Laufzeitimport.
 *
 * Deshalb pruefen die Tests hier nicht, ob der Code uebersetzt - sondern **wo
 * er liegt**. Das eigentliche Laufzeitverhalten prueft `npm run
 * bot:startup-test`, ein eigener Schritt der Pipeline, der jede Datei des Bots
 * einzeln laedt und danach den echten Einstiegspunkt startet.
 */

const WURZEL = process.cwd();
const BACKUP_DIR = join(WURZEL, 'deploy/backup');
const MODUL_DIR = join(WURZEL, 'packages/modules/src/backup');

/**
 * Der Quelltext ohne Kommentare.
 *
 * Gebraucht, weil die Dateien ueber den Ausfall vom 25.09. **schreiben** - sie
 * nennen `import 'server-only'` im Kommentar, um zu erklaeren, warum die Zeile
 * dort nicht steht. Eine Suche im Rohtext haette genau diese Erklaerung
 * beanstandet: der erste Lauf dieses Tests ist daran gescheitert.
 *
 * Bewusst grob - Zeichenketten mit `//` darin werden mitverkuerzt. Fuer die
 * Frage «steht hier ein Import» genuegt das, und eine vollstaendige
 * Zerlegung waere ein Parser im Test.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/** Alle Dateien eines Verzeichnisses, rekursiv. */
function dateien(verzeichnis: string): string[] {
  if (!existsSync(verzeichnis)) {
    return [];
  }
  return readdirSync(verzeichnis).flatMap((name) => {
    const pfad = join(verzeichnis, name);
    return statSync(pfad).isDirectory() ? dateien(pfad) : [pfad];
  });
}

describe('Die Trennung, die den Bot am Leben laesst', () => {
  const modulDateien = dateien(MODUL_DIR).filter((pfad) => pfad.endsWith('.ts'));

  it('findet den laufzeitneutralen Teil', () => {
    // Ohne diese Pruefung waere ein umbenanntes Verzeichnis ein Test, der
    // nichts mehr prueft und trotzdem gruen ist.
    expect(modulDateien.length).toBeGreaterThan(0);
  });

  it.each(modulDateien.map((pfad) => [pfad.slice(WURZEL.length + 1), pfad] as const))(
    '%s bringt nichts Serverseitiges mit',
    (_name, pfad) => {
      const quelle = ohneKommentare(readFileSync(pfad, 'utf8'));
      /*
       * Genau die Zeile, die den Ausfall verursacht hat. Sie darf in
       * `apps/web` stehen - das laedt niemand ausser Next.js - und in
       * `packages/modules` nicht.
       */
      expect(quelle, 'server-only gehoert nicht in packages/modules').not.toMatch(/['"]server-only['"]/u);
      // Und ebenso nichts, was nur in einem Serverprozess Sinn hat: ein
      // Dateizugriff im gemeinsamen Paket waere der naechste Weg, auf dem
      // Backup-Code in den Bot gelangt.
      for (const verboten of ['node:fs', 'node:fs/promises', 'node:child_process', 'node:os']) {
        expect(quelle, `${verboten} gehoert nicht in packages/modules/src/backup`).not.toContain(
          `'${verboten}'`,
        );
      }
      // Kein Prisma: der Zustand kommt aus Manifesten, nicht aus der
      // Datenbank (siehe deploy/backup/README.md).
      expect(quelle).not.toContain('@swisshub/database');
    },
  );

  it('laesst sich im Node-Prozess laden', async () => {
    /*
     * Der Gegenbeweis zur Behauptung darueber. Ein Test, der nur den Quelltext
     * liest, wuerde einen Import uebersehen, der ueber eine dritte Datei
     * hereinkommt - dieser `import` fuehrt den Modulkopf wirklich aus.
     */
    const modul = await import('@swisshub/modules/backup/manifest');
    expect(typeof modul.leseManifest).toBe('function');
  });

  it('haelt die Backup-Oberflaeche aus dem Bot heraus', () => {
    // Der Bot darf nichts aus `apps/web` laden - und umgekehrt braucht er
    // nichts vom Backup. Waere es anders, stuenden wir wieder vor dem
    // Ausfall vom 25.09.
    const botQuellen = dateien(join(WURZEL, 'apps/bot/src')).filter((pfad) => pfad.endsWith('.ts'));
    expect(botQuellen.length).toBeGreaterThan(10);
    for (const pfad of botQuellen) {
      const quelle = ohneKommentare(readFileSync(pfad, 'utf8'));
      expect(quelle, `${pfad} laedt Backup-Code`).not.toMatch(/modules\/backup|modules\/src\/backup/u);
      expect(quelle, `${pfad} laedt die Backup-Oberflaeche`).not.toContain('modules/backup/status');
    }
  });

  it('exportiert den laufzeitneutralen Teil als eigenen Pfad', () => {
    /*
     * Und nicht ueber das Barrel. `@swisshub/modules` zieht die Registry
     * mitsamt Datenbank herein; ein eigener Export-Pfad laesst den Teil
     * benutzen, der nichts davon braucht.
     */
    const paket = JSON.parse(readFileSync(join(WURZEL, 'packages/modules/package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(paket.exports['./backup/manifest']).toBe('./src/backup/manifest.ts');

    const barrel = readFileSync(join(WURZEL, 'packages/modules/src/index.ts'), 'utf8');
    // Ausdruecklich **nicht** im Barrel: was dort steht, laedt der Bot.
    expect(barrel).not.toContain('./backup');
  });

  it('nutzt server-only dort, wo es hingehoert', () => {
    // Die andere Haelfte der Zusage: der Dateizugriff liegt in `apps/web` und
    // ist dort mit `server-only` verriegelt. Fehlte die Zeile, koennte die
    // Datei eines Tages in einer Client-Komponente landen.
    const quelle = readFileSync(join(WURZEL, 'apps/web/src/modules/backup/status.ts'), 'utf8');
    expect(quelle.split('\n')[0]).toBe("import 'server-only';");
  });
});

describe('Die Skripte sind syntaktisch in Ordnung', () => {
  const shellSkripte = [
    'deploy/backup.sh',
    'deploy/backup/lib/gemeinsam.sh',
    'deploy/backup/bin/swisshub-backup',
    'deploy/backup/bin/swisshub-backup-verify',
    'deploy/backup/bin/swisshub-restore-test',
    'deploy/backup/bin/swisshub-recovery',
  ];

  it.each(shellSkripte)('%s besteht bash -n', (pfad) => {
    /*
     * `bash -n` liest das Skript und uebersetzt es, ohne es auszufuehren. Ein
     * Tippfehler in einem Zweig, der nur im Ernstfall durchlaufen wird - genau
     * dort, wo man ihn am wenigsten braucht - faellt damit hier auf und nicht
     * bei der Wiederherstellung.
     */
    expect(() => execFileSync('bash', ['-n', join(WURZEL, pfad)], { stdio: 'pipe' })).not.toThrow();
  });

  it.each(shellSkripte.filter((pfad) => pfad.includes('/bin/')).concat('deploy/backup.sh'))(
    '%s ist ausfuehrbar',
    (pfad) => {
      // Ohne das Bit laeuft weder der systemd-Timer noch die CLI - und der
      // Fehler («Permission denied») erklaert sich nicht von selbst.
      expect(statSync(join(WURZEL, pfad)).mode & 0o111).toBeGreaterThan(0);
    },
  );

  it('manifest.py laesst sich uebersetzen', () => {
    expect(() =>
      execFileSync(
        'python3',
        [
          '-c',
          'import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True)',
          join(BACKUP_DIR, 'lib/manifest.py'),
        ],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it('manifest.py braucht nur die Standardbibliothek', () => {
    /*
     * Kein pip, keine virtuelle Umgebung, kein zusaetzliches Paket auf dem
     * Server. Eine Sicherung, die eine Installation braucht, faellt beim
     * naechsten Systemwechsel aus - und das faellt dann niemandem auf.
     */
    const quelle = readFileSync(join(BACKUP_DIR, 'lib/manifest.py'), 'utf8');
    const importe = [...quelle.matchAll(/^(?:import|from) ([a-z_.]+)/gmu)].map((treffer) => treffer[1]!);
    const erlaubt = new Set([
      '__future__',
      'gzip',
      'hashlib',
      'json',
      'os',
      're',
      'sys',
      'datetime',
      'pathlib',
      'tarfile',
    ]);
    for (const name of importe) {
      expect(erlaubt.has(name.split('.')[0]!), `unerwarteter Import: ${name}`).toBe(true);
    }
  });
});

describe('Die systemd-Einheiten', () => {
  const einheiten = readdirSync(join(BACKUP_DIR, 'systemd')).sort();

  it('bringt zu jedem Timer einen Dienst mit', () => {
    const timer = einheiten.filter((name) => name.endsWith('.timer'));
    expect(timer.length).toBe(3);
    for (const name of timer) {
      expect(einheiten).toContain(name.replace(/\.timer$/u, '.service'));
    }
  });

  it.each(einheiten.filter((name) => name.endsWith('.timer')))('%s hat einen Termin', (name) => {
    const inhalt = readFileSync(join(BACKUP_DIR, 'systemd', name), 'utf8');
    expect(inhalt).toMatch(/^OnCalendar=.+$/mu);
    /*
     * `Persistent=true` holt einen Lauf nach, der ausgefallen ist, weil der
     * Server aus war. Ohne das faellt die Sicherung eines Neustarts um 02:55
     * stillschweigend aus - und "stillschweigend" ist bei einem Backup die
     * gefaehrlichste Eigenschaft.
     */
    expect(inhalt).toContain('Persistent=true');
    expect(inhalt).toMatch(/^Unit=swisshub-.+\.service$/mu);
  });

  it.each(einheiten.filter((name) => name.endsWith('.service')))('%s ist gehaertet', (name) => {
    const inhalt = readFileSync(join(BACKUP_DIR, 'systemd', name), 'utf8');
    expect(inhalt).toContain('Type=oneshot');
    expect(inhalt).toContain('NoNewPrivileges=true');
    // `full` und nicht `strict`: unter `strict` waere das ganze Dateisystem
    // nur lesbar, und eine Sicherung muss schreiben. Was sie schreiben darf,
    // steht in ReadWritePaths - und nur das.
    expect(inhalt).toContain('ProtectSystem=full');
    expect(inhalt).toMatch(/^ReadWritePaths=/mu);
    // Kein Dienst darf laenger laufen als sein Timer-Abstand.
    expect(inhalt).toMatch(/^TimeoutStartSec=/mu);
  });

  it('nennt keinen Wert, der ein Geheimnis sein koennte', () => {
    for (const name of einheiten) {
      const inhalt = readFileSync(join(BACKUP_DIR, 'systemd', name), 'utf8');
      expect(inhalt, name).not.toMatch(/PASSWORD|TOKEN|SECRET|ENCRYPTION_KEY/u);
    }
  });
});

describe('Die Pipeline laesst die Backup-Tests wirklich laufen', () => {
  const workflow = readFileSync(join(WURZEL, '.github/workflows/deploy.yml'), 'utf8');

  it('stellt pg_dump und age bereit', () => {
    /*
     * Ohne `pg_dump` ueberspringt sich der Integrationstest selbst, und ohne
     * `age` die Pruefung der Versiegelung. Ein uebersprungener Test ist bei
     * einem Backup die schlechteste aller Auskuenfte: er ist gruen und sagt
     * nichts.
     */
    expect(workflow).toContain('postgresql-client');
    expect(workflow).toContain('age');
    expect(workflow).toMatch(/pg_dump --version/u);
  });

  it('haelt den Bot-Startup-Test im Weg zum Deployment', () => {
    // Die Absicherung gegen genau den Ausfall, um den es hier geht. Sie stand
    // schon vor dieser Aufgabe in der Pipeline; hier wird sie festgehalten,
    // weil eine Backup-Aenderung der Anlass war, an dem sie gebraucht wurde.
    expect(workflow).toContain('npm run bot:startup-test');
    expect(workflow).toMatch(/needs: validate/u);
  });
});

describe('Die Konfigurationsvorlage', () => {
  const vorlage = readFileSync(join(BACKUP_DIR, 'swisshub-backup.env.example'), 'utf8');

  it('nennt jede Variable, die die Bibliothek liest', () => {
    /*
     * Eine Einstellung, die es gibt und die nirgends dokumentiert ist, gibt es
     * praktisch nicht. Dieser Test findet die Lesestellen im Skript und
     * verlangt sie in der Vorlage.
     */
    const bibliothek = readFileSync(join(BACKUP_DIR, 'lib/gemeinsam.sh'), 'utf8');
    const gelesen = new Set(
      [...bibliothek.matchAll(/\$\{(SWISSHUB_[A-Z_]+)(?::-|\})/gu)].map((treffer) => treffer[1]!),
    );
    expect(gelesen.size).toBeGreaterThan(8);
    for (const name of gelesen) {
      // `SWISSHUB_BACKUP_ENV_FILE` sagt, wo diese Datei liegt - sie kann sich
      // nicht selbst dorthin verweisen.
      if (name === 'SWISSHUB_BACKUP_ENV_FILE') {
        continue;
      }
      expect(vorlage, `${name} fehlt in swisshub-backup.env.example`).toContain(name);
    }
  });

  it('enthaelt keinen echten Wert', () => {
    // Die Vorlage wird kopiert. Stuende hier ein Beispielpasswort, waere es
    // eines Tages ein Passwort.
    expect(vorlage).not.toMatch(/^(?!#)\s*SWISSHUB_\w+=\S/mu);
  });
});
