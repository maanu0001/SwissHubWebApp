import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupUebersicht } from '@/modules/backup/status';

/**
 * Was die Oberflaeche aus den Manifesten macht.
 *
 * Geprueft wird der Lesepfad der WebApp - dieselbe Funktion, die die Seite
 * `System -> Backup & Recovery` aufruft. Die Manifeste schreibt dabei das echte
 * Python-Skript: ein von Hand gebautes JSON wuerde hier vor allem bestaetigen,
 * dass dieser Test dasselbe annimmt wie dieser Test.
 *
 * ## Warum dynamisch importiert wird
 *
 * `status.ts` liest `SWISSHUB_BACKUP_STATUS_DIR` beim Laden des Moduls - so wie
 * es im Betrieb auch ist, wo die Variable aus der Container-Umgebung kommt und
 * sich nie aendert. Der Test setzt sie deshalb **vor** dem Import und leert
 * dazwischen die Modulregistrierung.
 */

const MANIFEST_PY = join(process.cwd(), 'deploy/backup/lib/manifest.py');

function py(...argumente: string[]): void {
  execFileSync('python3', [MANIFEST_PY, ...argumente], { stdio: 'pipe' });
}

describe('Die Uebersicht der WebApp', () => {
  let wurzel = '';
  let statusDir = '';
  let vorher: string | undefined;

  beforeEach(() => {
    wurzel = mkdtempSync(join(tmpdir(), 'swisshub-uebersicht-'));
    statusDir = join(wurzel, 'status');
    vorher = process.env.SWISSHUB_BACKUP_STATUS_DIR;
    process.env.SWISSHUB_BACKUP_STATUS_DIR = statusDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (vorher === undefined) {
      delete process.env.SWISSHUB_BACKUP_STATUS_DIR;
    } else {
      process.env.SWISSHUB_BACKUP_STATUS_DIR = vorher;
    }
    rmSync(wurzel, { recursive: true, force: true });
  });

  async function lade(): Promise<BackupUebersicht> {
    const modul = await import('@/modules/backup/status');
    return modul.ladeBackupUebersicht(new Date('2026-09-26T12:00:00Z'));
  }

  /** Eine Sicherung ins Statusverzeichnis legen, wie `spiegle` es tut. */
  function legeSicherung(
    kennung: string,
    { integritaet = 'bestanden', restore = 'ungeprueft', bytes = 1234 } = {},
  ): void {
    const sicherungen = join(wurzel, 'sicherungen', kennung);
    mkdirSync(sicherungen, { recursive: true });
    writeFileSync(join(sicherungen, 'datenbank.sql.gz'), 'x'.repeat(bytes));
    writeFileSync(
      join(sicherungen, '.angaben'),
      [`id=${kennung}`, `erstelltAm=${kennung.slice(0, 10)}T03:00:00Z`, 'komponenten=datenbank'].join('\n'),
    );
    py('schreibe', sicherungen, join(sicherungen, '.angaben'));
    py('vermerke', sicherungen, 'integritaet', integritaet, 'im Test gesetzt');
    if (restore !== 'ungeprueft') {
      py('vermerke', sicherungen, 'restoreTest', restore, 'im Test gesetzt');
    }
    py('spiegle', join(wurzel, 'sicherungen'), statusDir);
  }

  it('sagt bei einem fehlenden Verzeichnis, dass nichts eingerichtet ist', async () => {
    /*
     * Der Normalfall direkt nach einem Deployment - und er darf nichts
     * kaputtmachen. Der Container startet, die Seite laedt, sie sagt was fehlt.
     * Ein Absturz hier waere der Beweis, dass die Oberflaeche vom Systemdienst
     * abhaengt, und genau das soll sie nicht.
     */
    const uebersicht = await lade();
    expect(uebersicht.eingerichtet).toBe(false);
    expect(uebersicht.sicherungen).toEqual([]);
    expect(uebersicht.statusVerzeichnis).toBe(statusDir);
    // Keine erfundenen Zahlen.
    expect(uebersicht.bytes).toBe(0);
    expect(uebersicht.letzterErfolg).toBeNull();
  });

  it('uebersteht ein unlesbares Verzeichnis', async () => {
    // Ein Bind-Mount, den Docker als root angelegt hat, oder ein Tippfehler im
    // Pfad. Beides darf nicht mehr sein als «nicht eingerichtet».
    writeFileSync(join(wurzel, 'keine-datei'), '');
    process.env.SWISSHUB_BACKUP_STATUS_DIR = join(wurzel, 'keine-datei');
    vi.resetModules();
    const modul = await import('@/modules/backup/status');
    const uebersicht = await modul.ladeBackupUebersicht();
    expect(uebersicht.eingerichtet).toBe(false);
  });

  it('liest Zustand und Sicherungen', async () => {
    py(
      'zustand',
      statusDir,
      'letzterLauf=2026-09-26T03:00:00Z',
      'letzterLaufStatus=erfolgreich',
      'letzterErfolg=2026-09-26T03:00:20Z',
      'letzteKennung=2026-09-26T030000Z',
      'aufbewahrung=7/4/3',
      'extern=nicht eingerichtet',
    );
    legeSicherung('2026-09-26T030000Z', { restore: 'bestanden', bytes: 2000 });

    const uebersicht = await lade();
    expect(uebersicht.eingerichtet).toBe(true);
    expect(uebersicht.zustand?.letzterLaufStatus).toBe('erfolgreich');
    expect(uebersicht.letzterErfolg?.toISOString()).toBe('2026-09-26T03:00:20.000Z');
    expect(uebersicht.sicherungen).toHaveLength(1);
    expect(uebersicht.befund.gepruefteVorhanden).toBe(true);
    expect(uebersicht.befund.restoreGetestet).toBe(true);
    expect(uebersicht.befund.keinRestoreTest).toBe(false);
    expect(uebersicht.bytes).toBe(2000);
  });

  it('sortiert die Sicherungen von neu nach alt', async () => {
    for (const kennung of ['2026-09-24T030000Z', '2026-09-26T030000Z', '2026-09-25T030000Z']) {
      legeSicherung(kennung);
    }
    const uebersicht = await lade();
    expect(uebersicht.sicherungen.map((eintrag) => eintrag.id)).toEqual([
      '2026-09-26T030000Z',
      '2026-09-25T030000Z',
      '2026-09-24T030000Z',
    ]);
  });

  it('meldet, wenn keine Sicherung je zurueckgelesen wurde', async () => {
    legeSicherung('2026-09-26T030000Z');
    const uebersicht = await lade();
    // Der Hinweis, der im Dashboard erscheint: Pruefsummen allein sind eine
    // Annahme.
    expect(uebersicht.befund.keinRestoreTest).toBe(true);
    expect(uebersicht.befund.restoreGetestet).toBe(false);
  });

  it('nennt beanstandete Sicherungen, ohne die guten zu verstecken', async () => {
    legeSicherung('2026-09-26T030000Z', { restore: 'bestanden' });
    legeSicherung('2026-09-25T030000Z', { integritaet: 'gescheitert' });
    const uebersicht = await lade();
    expect(uebersicht.sicherungen).toHaveLength(2);
    expect(uebersicht.befund.beanstandet.map((eintrag) => eintrag.id)).toEqual(['2026-09-25T030000Z']);
    expect(uebersicht.befund.restoreGetestet).toBe(true);
  });

  it('uebergeht ein einzelnes unlesbares Manifest', async () => {
    /*
     * Ein Manifest aus einer kuenftigen Fassung oder eine halb geschriebene
     * Datei darf die Uebersicht nicht leeren - sie fehlt in der Liste, die
     * uebrigen sind da.
     */
    legeSicherung('2026-09-26T030000Z');
    mkdirSync(join(statusDir, 'sicherungen'), { recursive: true });
    writeFileSync(join(statusDir, 'sicherungen', '2026-09-25T030000Z.json'), '{kein json');
    writeFileSync(join(statusDir, 'sicherungen', '2026-09-24T030000Z.json'), '{"version":99}');

    const uebersicht = await lade();
    expect(uebersicht.sicherungen.map((eintrag) => eintrag.id)).toEqual(['2026-09-26T030000Z']);
    expect(uebersicht.eingerichtet).toBe(true);
  });

  it('nennt den naechsten Termin in der Zukunft', async () => {
    py('zustand', statusDir, 'letzterLauf=2026-09-26T03:00:00Z');
    const uebersicht = await lade();
    expect(uebersicht.naechsteSicherung).not.toBeNull();
    expect(uebersicht.naechsteSicherung!.getTime()).toBeGreaterThan(
      new Date('2026-09-26T12:00:00Z').getTime(),
    );
  });

  it('gibt nie einen Pfad aus dem Backup-Verzeichnis heraus', async () => {
    /*
     * Die Zusage der Trennung: was die Oberflaeche in der Hand hat, sind
     * Manifeste aus dem Statusverzeichnis. Sie kennt keinen Pfad, unter dem ein
     * Datenbankexport liegt - und kann deshalb keinen ausliefern.
     */
    legeSicherung('2026-09-26T030000Z');
    const uebersicht = await lade();
    const alsText = JSON.stringify(uebersicht);
    expect(alsText).not.toContain(join(wurzel, 'sicherungen'));
    expect(alsText).not.toContain('datenbank.sql.gz.');
  });
});
