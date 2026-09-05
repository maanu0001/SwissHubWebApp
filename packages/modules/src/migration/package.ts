import { z } from 'zod';

/**
 * Das Übertragungspaket.
 *
 * Was eine SwissHub-Installation ausmacht, ohne das, was sie geheim hält:
 * welche Module laufen und wie sie eingestellt sind, welche Discord-Rolle
 * welche Berechtigungen trägt, welche Automationen es gibt. Verweise auf
 * Rollen und Kanäle stehen als Quell-IDs darin und werden beim Anwenden
 * übersetzt - eine Rolle der einen Guild gibt es in der anderen nicht.
 *
 * Drei Entscheidungen prägen dieses Schema.
 *
 * **`.strict()` überall.** Ein Paket kommt als Datei von aussen, und ein
 * Feld, das niemand erwartet hat, ist kein Zusatz, sondern ein Angriff.
 * Unbekannte Schlüssel führen zur Ablehnung, nicht zum Ignorieren -
 * ignorierte Felder wandern sonst irgendwann doch in ein `...spread`.
 *
 * **Keine Tabellen, keine Modelle.** Es gibt hier keinen generischen Weg,
 * Datenbankzeilen zu beschreiben. Jedes Feld ist einzeln benannt, und was
 * nicht benannt ist, lässt sich auch nicht importieren.
 *
 * **Keine Geheimnisse.** Weder Token noch Schlüssel noch Zugangsdaten haben
 * ein Feld. Integrationen erscheinen nur als Zustand - «eingerichtet» oder
 * «fehlt» -, damit man weiss, was am Ziel noch zu tun ist.
 */

/**
 * Die Fassung des Paketformats.
 *
 * Eine Zahl und keine Bereichsangabe: ein Paket, das eine andere Fassung
 * trägt, wird abgelehnt statt hoffnungsvoll gelesen. Ältere Fassungen
 * bekommen bei Bedarf einen ausdrücklichen Übersetzer.
 */
export const MIGRATION_PACKAGE_VERSION = 1;

/** Grösse, ab der ein Paket nicht mehr plausibel ist. */
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

/**
 * Schlüsselnamen, die niemals in einem Paket stehen dürfen.
 *
 * Der Export baut das Paket selbst und nimmt nichts davon auf - diese Liste
 * ist die zweite Sperre, für den Fall, dass ein Paket von aussen kommt oder
 * ein Modul künftig ein Feld einführt, das hier hineinrutscht. Sie prüft
 * Namen, nicht Werte: ein Wert lässt sich verschleiern, ein Name muss zum
 * Lesen taugen.
 */
const GEHEIME_SCHLUESSEL = [
  'token',
  'secret',
  'password',
  'passwort',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'encryptionkey',
  'encryption_key',
  'masterkey',
  'master_key',
  'credential',
  'authsecret',
  'auth_secret',
  'webhooksecret',
  'webhook_secret',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
] as const;

/** Ob ein Schlüsselname nach einem Geheimnis aussieht. */
export function istGeheimerSchluessel(schluessel: string): boolean {
  const normal = schluessel.toLowerCase().replaceAll('-', '_');
  return GEHEIME_SCHLUESSEL.some((verboten) => normal.includes(verboten));
}

/**
 * Ein Objekt nach geheim aussehenden Schlüsseln durchsuchen.
 *
 * Gibt die Pfade zurück, an denen etwas gefunden wurde - für den Export als
 * Notbremse, für den Import als Ablehnungsgrund mit Fundstelle.
 */
export function findeGeheimnisse(wert: unknown, pfad = ''): string[] {
  if (wert === null || typeof wert !== 'object') {
    return [];
  }
  if (Array.isArray(wert)) {
    return wert.flatMap((eintrag, index) => findeGeheimnisse(eintrag, `${pfad}[${index}]`));
  }
  const treffer: string[] = [];
  for (const [schluessel, inhalt] of Object.entries(wert as Record<string, unknown>)) {
    const stelle = pfad ? `${pfad}.${schluessel}` : schluessel;
    if (istGeheimerSchluessel(schluessel)) {
      treffer.push(stelle);
      continue;
    }
    treffer.push(...findeGeheimnisse(inhalt, stelle));
  }
  return treffer;
}

/**
 * Ein Wert, wie er in Moduleinstellungen vorkommt.
 *
 * Bewusst ohne Rekursion in beliebige Tiefe und ohne `__proto__`: ein Paket
 * ist eine Datei von aussen, und `JSON.parse` legt einen Schlüssel dieses
 * Namens als gewöhnliches Feld an. Wer ihn ungeprüft in ein `Object.assign`
 * gibt, ändert die Prototypkette des Prozesses.
 */
const VERBOTENE_SCHLUESSEL = new Set(['__proto__', 'constructor', 'prototype']);

const einstellungsWert: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string().max(4000),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(einstellungsWert).max(200),
    z
      .record(z.string().max(200), einstellungsWert)
      .refine(
        (objekt) => Object.keys(objekt).every((schluessel) => !VERBOTENE_SCHLUESSEL.has(schluessel)),
        'Unzulässiger Schlüssel in den Einstellungen.',
      ),
  ]),
);

const snowflake = z.string().regex(/^\d{17,20}$/u, 'Keine gültige Discord-ID.');

export const migrationModulSchema = z
  .object({
    id: z.string().min(1).max(64),
    enabled: z.boolean(),
    configVersion: z.number().int().min(0).max(1000),
    settings: z.record(z.string().max(200), einstellungsWert),
  })
  .strict();

export const migrationRolleSchema = z
  .object({
    discordRoleId: snowflake,
    /** Der Name in der Quelle - nur zum Wiedererkennen beim Zuordnen. */
    sourceName: z.string().max(200),
    label: z.string().max(200),
    isProtected: z.boolean(),
    keepOnJail: z.boolean(),
    moderationLevel: z.number().int().min(0).max(1000),
    permissions: z.array(z.string().max(120)).max(500),
  })
  .strict();

export const migrationAutomationSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    triggerType: z.string().min(1).max(64),
    triggerConfig: einstellungsWert,
    conditions: einstellungsWert.nullable(),
    steps: einstellungsWert,
    concurrency: z.string().max(64).nullable(),
    concurrencyKey: z.string().max(200).nullable(),
  })
  .strict();

/**
 * Eine Integration - als Zustand, nicht als Zugangsdaten.
 *
 * «Der KI-Zugang ist eingerichtet» ist die Auskunft, die beim Übertragen
 * hilft. Der Schlüssel selbst gehört in die Geheimnisverwaltung des Ziels
 * und niemals in eine Datei, die jemand herunterlädt.
 */
export const migrationIntegrationSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().max(200),
    /** Hängt sie an der Guild oder gilt sie für die ganze Installation? */
    guildScoped: z.boolean(),
    konfiguriert: z.boolean(),
  })
  .strict();

export const migrationPackageSchema = z
  .object({
    schemaVersion: z.literal(MIGRATION_PACKAGE_VERSION),
    createdAt: z.string().datetime(),
    applicationVersion: z.string().max(64),
    sourceGuild: z.object({ id: snowflake, name: z.string().max(200) }).strict(),
    modules: z.array(migrationModulSchema).max(100),
    roles: z.array(migrationRolleSchema).max(200),
    automations: z.array(migrationAutomationSchema).max(500),
    integrations: z.array(migrationIntegrationSchema).max(50),
  })
  .strict();

export type MigrationPackage = z.infer<typeof migrationPackageSchema>;
export type MigrationModul = z.infer<typeof migrationModulSchema>;
export type MigrationRolle = z.infer<typeof migrationRolleSchema>;
export type MigrationAutomation = z.infer<typeof migrationAutomationSchema>;

/**
 * Ein Paket von aussen einlesen.
 *
 * Vier Hürden, und jede hat ihren Grund: die Grösse, damit ein Upload nicht
 * den Speicher füllt; die Fassung, damit ein Paket aus einer anderen Zeit
 * nicht halb verstanden wird; das Schema, damit nur benannte Felder
 * ankommen; und die Geheimnissuche, damit ein Paket mit einem Token darin
 * abgewiesen wird, statt es weiterzureichen.
 */
export function lesePaket(roh: string): MigrationPackage {
  if (roh.length > MAX_PACKAGE_BYTES) {
    throw new Error('Das Paket ist zu gross.');
  }

  let geparst: unknown;
  try {
    geparst = JSON.parse(roh);
  } catch {
    throw new Error('Das Paket ist keine gültige JSON-Datei.');
  }

  const fassung = (geparst as { schemaVersion?: unknown })?.schemaVersion;
  if (fassung !== MIGRATION_PACKAGE_VERSION) {
    throw new Error(
      `Dieses Paket hat die Fassung ${String(fassung ?? 'unbekannt')}, erwartet wird ${MIGRATION_PACKAGE_VERSION}.`,
    );
  }

  const geheim = findeGeheimnisse(geparst);
  if (geheim.length > 0) {
    throw new Error(
      `Das Paket enthält Felder, die nach Zugangsdaten aussehen (${geheim.slice(0, 3).join(', ')}). Es wird nicht eingelesen.`,
    );
  }

  const ergebnis = migrationPackageSchema.safeParse(geparst);
  if (!ergebnis.success) {
    const erster = ergebnis.error.issues[0];
    throw new Error(
      `Das Paket passt nicht zum erwarteten Aufbau${erster ? `: ${erster.path.join('.')} - ${erster.message}` : '.'}`,
    );
  }
  return ergebnis.data;
}
