import 'server-only';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  alsDatum,
  alsZahl,
  belegteBytes,
  beurteile,
  leseManifest,
  leseZustand,
  type BackupBefund,
  type BackupManifest,
  type BackupZustand,
} from '@swisshub/modules/backup/manifest';

/**
 * Was die WebApp ueber die Sicherungen weiss.
 *
 * ## Wo `server-only` stehen darf
 *
 * Hier. Diese Datei liegt in `apps/web`, und `apps/web` laedt niemand ausser
 * Next.js. Der Ausfall vom 25.09. entstand daraus, dass dieselbe Zeile in
 * `packages/modules` stand - einem Paket, das auch der Discord-Bot laedt.
 *
 * Die Zeile ist deshalb hier kein Versehen, sondern der Zaun: sie laesst diese
 * Datei in keinem anderen Prozess starten. `tests/unit/backup-runtime.test.ts`
 * haelt fest, dass sie hier steht und in `packages/modules/src/backup/` nicht.
 *
 * ## Was sie lesen darf
 *
 * Ausschliesslich das Statusverzeichnis - Manifeste und die Zustandsdatei.
 * Nicht das Backup-Verzeichnis: das gehoert root und ist `0700`. Die WebApp
 * kann damit keinen Datenbankexport ausliefern, weil die Datei fuer sie nicht
 * existiert. Das ist eine Eigenschaft des Dateisystems und nicht eine Regel in
 * einer Route, die jemand uebersehen kann.
 */

/**
 * Wo die Manifeste liegen.
 *
 * Dasselbe Verzeichnis, das `deploy/backup/` beschreibt, in
 * `docker-compose.prod.yml` nur lesbar in den Container gemountet.
 */
const STATUS_DIR = process.env.SWISSHUB_BACKUP_STATUS_DIR ?? '/var/lib/swisshub/backup-status';

export interface BackupUebersicht {
  /** Hat der Backup-Dienst auf diesem Server schon einmal geschrieben? */
  eingerichtet: boolean;
  /** Wo die WebApp gesucht hat - fuer die Meldung, wenn dort nichts ist. */
  statusVerzeichnis: string;
  zustand: BackupZustand | null;
  /** Neueste zuerst. */
  sicherungen: BackupManifest[];
  befund: BackupBefund;
  /** Summe der Dateigroessen aus den Manifesten. */
  bytes: number;
  /** Aufgeloeste Zeitpunkte, damit die Seite nicht selbst parsen muss. */
  letzterLauf: Date | null;
  letzterErfolg: Date | null;
  letzterFehlerAm: Date | null;
  letztePruefung: Date | null;
  letzterRestoreTest: Date | null;
  /** Aus der Vorgabe des systemd-Timers gerechnet, nicht aus dem Timer gelesen. */
  naechsteSicherung: Date | null;
}

const LEER: Omit<BackupUebersicht, 'statusVerzeichnis'> = {
  eingerichtet: false,
  zustand: null,
  sicherungen: [],
  befund: {
    eingerichtet: false,
    gepruefteVorhanden: false,
    restoreGetestet: false,
    beanstandet: [],
    keinRestoreTest: false,
  },
  bytes: 0,
  letzterLauf: null,
  letzterErfolg: null,
  letzterFehlerAm: null,
  letztePruefung: null,
  letzterRestoreTest: null,
  naechsteSicherung: null,
};

/** JSON lesen, oder `null`. Ein fehlendes Verzeichnis ist der Normalfall. */
async function leseJson(pfad: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(pfad, 'utf8')) as unknown;
  } catch {
    /*
     * Jeder Fehler endet hier gleich: es gibt die Datei nicht, sie ist nicht
     * lesbar, oder sie ist kein JSON. Alle drei heissen fuer die Oberflaeche
     * dasselbe - keine Auskunft. Eine Unterscheidung waere eine Fehlermeldung,
     * mit der niemand etwas anfangen kann; was zu tun ist, steht so oder so in
     * der Anleitung.
     */
    return null;
  }
}

/**
 * Der naechste Sicherungstermin.
 *
 * Gerechnet aus der Vorgabe des Timers (taeglich 03:00 Ortszeit), nicht aus
 * `systemctl list-timers` - die WebApp hat keinen Zugang zu systemd, und den
 * soll sie auch nicht bekommen. Deshalb ist das eine Erwartung und keine
 * Auskunft, und die Oberflaeche beschriftet sie entsprechend.
 */
function naechsterTermin(jetzt: Date): Date {
  const ziel = new Date(jetzt);
  ziel.setHours(3, 0, 0, 0);
  if (ziel.getTime() <= jetzt.getTime()) {
    ziel.setDate(ziel.getDate() + 1);
  }
  return ziel;
}

export async function ladeBackupUebersicht(jetzt: Date = new Date()): Promise<BackupUebersicht> {
  const zustand = leseZustand(await leseJson(join(STATUS_DIR, 'zustand.json')));

  let namen: string[] = [];
  try {
    namen = (await readdir(join(STATUS_DIR, 'sicherungen'))).filter((name) => name.endsWith('.json'));
  } catch {
    namen = [];
  }

  const gelesen = await Promise.all(
    namen.map(async (name) => leseManifest(await leseJson(join(STATUS_DIR, 'sicherungen', name)))),
  );
  /*
   * Absteigend nach Kennung. Die Kennung ist ein UTC-Zeitstempel in
   * `YYYY-MM-DDTHHMMSSZ` - sortierbar als Text, und genau dafuer wurde sie so
   * gewaehlt. Nach `erstelltAm` zu sortieren waere dasselbe Ergebnis mit einem
   * zusaetzlichen Parser dazwischen.
   */
  const sicherungen = gelesen
    .filter((manifest): manifest is BackupManifest => manifest !== null)
    .sort((a, b) => b.id.localeCompare(a.id));

  if (zustand === null && sicherungen.length === 0) {
    return { ...LEER, statusVerzeichnis: STATUS_DIR };
  }

  return {
    eingerichtet: true,
    statusVerzeichnis: STATUS_DIR,
    zustand,
    sicherungen,
    befund: beurteile(sicherungen, zustand),
    /*
     * Die Summe aus den Manifesten, nicht der Zaehler aus `zustand.json`: der
     * Zaehler misst das Backup-Verzeichnis samt Arbeitsdateien, die Manifeste
     * messen die Sicherungen. Wenn eine Sicherung aus der Aufbewahrung faellt,
     * stimmt die Summe sofort und der Zaehler erst beim naechsten Lauf.
     */
    bytes: belegteBytes(sicherungen),
    letzterLauf: alsDatum(zustand?.letzterLauf),
    letzterErfolg: alsDatum(zustand?.letzterErfolg),
    letzterFehlerAm: alsDatum(zustand?.letzterFehlerAm),
    letztePruefung: alsDatum(zustand?.letztePruefung),
    letzterRestoreTest: alsDatum(zustand?.letzterRestoreTest),
    naechsteSicherung: naechsterTermin(jetzt),
  };
}

export { alsZahl };
