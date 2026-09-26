/**
 * Die Manifeste der Sicherung - laufzeitneutral gelesen.
 *
 * ## Warum diese Datei nichts kann
 *
 * Sie liest keine Datei, spricht mit keiner Datenbank und importiert kein
 * `server-only`. Sie nimmt bereits geparstes JSON und sagt, ob es ein Manifest
 * ist. Nichts weiter.
 *
 * Das ist die Lehre aus dem Ausfall vom 25.09.: drei Dateien der damaligen
 * Backup-Implementierung begannen mit `import 'server-only'`, wurden ueber ein
 * Barrel Teil von `@swisshub/modules` und damit Teil dessen, was der
 * Discord-Bot laedt. `server-only` wirft in jedem Node-Prozess, der kein Next
 * ist - der Bot kam nicht mehr hoch, und die Pipeline war gruen, weil ein
 * Typecheck keinen Laufzeitimport sieht.
 *
 * Deshalb ist die Arbeit jetzt so geteilt:
 *
 * | Wo                                          | Was                           |
 * | ------------------------------------------- | ----------------------------- |
 * | hier                                        | Typen und Pruefung, rein      |
 * | `apps/web/src/modules/backup/status.ts`     | Dateien lesen (nur WebApp)    |
 * | `deploy/backup/`                            | die Sicherung selbst (Shell)  |
 *
 * Die Sicherung selbst laeuft in **keinem** dieser Prozesse. Sie ist ein
 * Shell-Skript unter einem systemd-Timer; faellt es aus, faellt kein Dienst
 * aus. Fiele umgekehrt die ganze WebApp aus, liefe die Sicherung weiter.
 *
 * ## Warum das Format geprueft und nicht geglaubt wird
 *
 * Das Manifest schreibt ein Python-Skript, gelesen wird es hier von
 * TypeScript. Zwei Sprachen, eine Datei - ohne Pruefung waere jede Umbenennung
 * dort ein stiller Fehler hier. `tests/unit/backup-manifest.test.ts` haelt
 * beide Seiten zusammen: es laesst das echte Skript ein Manifest schreiben und
 * liest es mit dem Schema hier.
 */
import { z } from 'zod';

/** Die Fassung, die dieser Leser versteht. */
export const MANIFEST_VERSION = 1;

/**
 * Die drei Zustaende einer Sicherung, und warum sie getrennt bleiben.
 *
 * - **erstellt**: die Dateien liegen da.
 * - **Integritaet geprueft**: Pruefsummen stimmen, die Archive sind lesbar,
 *   der Datenbankexport traegt die Abschlussmarke von `pg_dump`.
 * - **Restore getestet**: der Export wurde in eine isolierte Datenbank
 *   eingespielt, und die Zahl der Tabellen und Zeilen stimmt.
 *
 * Eine richtige Pruefsumme ueber einen Dump, den PostgreSQL nicht annimmt, ist
 * eine richtige Pruefsumme. Wer die Zustaende vermischt, zeigt im Dashboard
 * ein gruenes Haekchen fuer eine Sicherung, die niemand zuruecklesen kann.
 */
export const PRUEFSTATUS = ['ungeprueft', 'bestanden', 'gescheitert'] as const;
export type Pruefstatus = (typeof PRUEFSTATUS)[number];

const pruefungSchema = z.object({
  status: z.enum(PRUEFSTATUS).catch('ungeprueft'),
  am: z.string().nullable().catch(null),
  meldung: z.string().nullable().catch(null),
});

const dateiSchema = z.object({
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

/**
 * Das Manifest einer Sicherung.
 *
 * Was hier **nicht** steht und nie stehen wird: ein Passwort, ein Token, ein
 * Schluessel. Der Fingerabdruck des Hauptschluessels ist ein SHA-256-Praefix -
 * er beantwortet "habe ich den richtigen Schluessel?" und gibt ihn nicht her.
 */
export const backupManifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{6}Z$/u),
  erstelltAm: z.string(),
  typ: z.string(),
  status: z.string(),
  host: z.string().catch(''),
  komponenten: z.array(z.string()).catch([]),
  dateien: z.array(dateiSchema).catch([]),
  bytesGesamt: z.number().int().nonnegative().catch(0),
  postgresVersion: z.string().nullable().catch(null),
  gitCommit: z.string().nullable().catch(null),
  datenbank: z.string().nullable().catch(null),
  uploadVerzeichnis: z.string().nullable().catch(null),
  schluesselFingerabdruck: z.string().nullable().catch(null),
  geheimnisse: z.string().catch('unbekannt'),
  integritaet: pruefungSchema,
  restoreTest: pruefungSchema,
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

/**
 * Der Gesamtzustand, wie die Skripte ihn fortschreiben.
 *
 * Alle Werte sind Text oder fehlen: die Skripte schreiben mit `printf`, und ein
 * Schema, das Zahlen verlangt, waere an der ersten leeren Zeile gescheitert.
 * Umgerechnet wird beim Lesen, und zwar tolerant - ein unlesbarer Zaehler darf
 * die Uebersicht nicht unbenutzbar machen.
 */
export const backupZustandSchema = z.object({
  version: z.literal(1),
  anzahl: z.string().nullable().optional(),
  bytesGesamt: z.string().nullable().optional(),
  letzterLauf: z.string().nullable().optional(),
  letzterLaufStatus: z.string().nullable().optional(),
  letzterErfolg: z.string().nullable().optional(),
  letzteKennung: z.string().nullable().optional(),
  letzterFehler: z.string().nullable().optional(),
  letzterFehlerAm: z.string().nullable().optional(),
  letztePruefung: z.string().nullable().optional(),
  letztePruefungStatus: z.string().nullable().optional(),
  letztePruefungMeldung: z.string().nullable().optional(),
  letzterRestoreTest: z.string().nullable().optional(),
  letzterRestoreTestStatus: z.string().nullable().optional(),
  letzterRestoreTestKennung: z.string().nullable().optional(),
  letzterRestoreTestMeldung: z.string().nullable().optional(),
  backupVerzeichnis: z.string().nullable().optional(),
  aufbewahrung: z.string().nullable().optional(),
  extern: z.string().nullable().optional(),
  externLetzterErfolg: z.string().nullable().optional(),
  externLetzterFehlerAm: z.string().nullable().optional(),
});

export type BackupZustand = z.infer<typeof backupZustandSchema>;

/**
 * Ein Manifest aus unbekanntem JSON.
 *
 * `null` statt einer Ausnahme: ein einzelnes unlesbares Manifest - aus einer
 * kuenftigen Fassung, halb geschrieben, von Hand bearbeitet - darf die
 * Uebersicht nicht leeren. Es fehlt dann in der Liste, und die uebrigen sind
 * da.
 */
export function leseManifest(rohdaten: unknown): BackupManifest | null {
  const ergebnis = backupManifestSchema.safeParse(rohdaten);
  return ergebnis.success ? ergebnis.data : null;
}

export function leseZustand(rohdaten: unknown): BackupZustand | null {
  const ergebnis = backupZustandSchema.safeParse(rohdaten);
  return ergebnis.success ? ergebnis.data : null;
}

/** Eine Zahl aus dem Text, den die Skripte schreiben. */
export function alsZahl(wert: string | null | undefined): number | null {
  if (wert === null || wert === undefined || wert.trim() === '') {
    return null;
  }
  const zahl = Number(wert);
  return Number.isFinite(zahl) ? zahl : null;
}

/** Ein Zeitpunkt aus dem Text, den die Skripte schreiben. */
export function alsDatum(wert: string | null | undefined): Date | null {
  if (wert === null || wert === undefined || wert.trim() === '') {
    return null;
  }
  const datum = new Date(wert);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/**
 * Wie viele Bytes eine Sicherung belegt.
 *
 * Aus dem Manifest gerechnet und nicht von der Platte gelesen: die WebApp sieht
 * das Backup-Verzeichnis nicht, und das ist Absicht.
 */
export function belegteBytes(manifeste: BackupManifest[]): number {
  return manifeste.reduce((summe, manifest) => summe + manifest.bytesGesamt, 0);
}

/**
 * Der zusammenfassende Zustand aller Sicherungen.
 *
 * Was hier nicht gemacht wird: aus "es gibt Sicherungen" auf "wir sind
 * gesichert" schliessen. Eine Sicherung, die nie zurueckgelesen wurde, ist
 * eine Annahme - und `keinRestoreTest` sagt das.
 */
export interface BackupBefund {
  /** Ist ueberhaupt etwas eingerichtet? */
  eingerichtet: boolean;
  /** Mindestens eine Sicherung mit bestandener Integritaetspruefung. */
  gepruefteVorhanden: boolean;
  /** Mindestens eine Sicherung mit bestandenem Restore-Test. */
  restoreGetestet: boolean;
  /** Sicherungen, deren Pruefung fehlgeschlagen ist. */
  beanstandet: BackupManifest[];
  /** Keine einzige Sicherung wurde je zurueckgelesen. */
  keinRestoreTest: boolean;
}

export function beurteile(manifeste: BackupManifest[], zustand: BackupZustand | null): BackupBefund {
  const beanstandet = manifeste.filter(
    (manifest) =>
      manifest.integritaet.status === 'gescheitert' || manifest.restoreTest.status === 'gescheitert',
  );
  const gepruefteVorhanden = manifeste.some((manifest) => manifest.integritaet.status === 'bestanden');
  const restoreGetestet = manifeste.some((manifest) => manifest.restoreTest.status === 'bestanden');
  return {
    // Eingerichtet heisst: die Skripte haben schon einmal geschrieben. Ein
    // leeres Statusverzeichnis ist der Normalfall direkt nach dem Deployment
    // und kein Fehler - die Oberflaeche sagt dann, was noch fehlt.
    eingerichtet: manifeste.length > 0 || zustand !== null,
    gepruefteVorhanden,
    restoreGetestet,
    beanstandet,
    keinRestoreTest: manifeste.length > 0 && !restoreGetestet,
  };
}
