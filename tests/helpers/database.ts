import { execFileSync } from 'node:child_process';
import { describe } from 'vitest';

/**
 * Tests gegen eine echte PostgreSQL-Datenbank.
 *
 * Die übrigen Integrationstests nutzen eine In-Memory-Nachbildung von Prisma.
 * Für die Spielersuche reicht das nicht: dort hängt das Verhalten an echten
 * Datenbankeigenschaften - Unique-Indizes, Transaktionen mit Zeilensperre,
 * `groupBy` und `aggregate`. Eine handgeschriebene Nachbildung davon würde
 * am Ende vor allem sich selbst prüfen und falsche Sicherheit geben.
 *
 * Deshalb laufen diese Tests gegen eine echte Datenbank - und werden sauber
 * übersprungen, wenn keine erreichbar ist. `npm test` funktioniert damit auch
 * ohne PostgreSQL, meldet die Auslassung aber deutlich.
 *
 * Verwendet wird `SWISSHUB_TEST_DATABASE_URL`. Beispiel:
 *
 *   SWISSHUB_TEST_DATABASE_URL=postgresql://swisshub:swisshub@localhost:5432/swisshub_test npm test
 */
export const TEST_DATABASE_URL = process.env.SWISSHUB_TEST_DATABASE_URL?.trim() ?? '';

export const hasTestDatabase = TEST_DATABASE_URL.length > 0;

/**
 * `describe`, das ohne Datenbank übersprungen wird.
 *
 * Der Hinweis erscheint einmal beim Laden der Datei, damit eine ausgelassene
 * Prüfung nicht unbemerkt bleibt.
 */
export function describeWithDatabase(name: string, factory: () => void): void {
  if (!hasTestDatabase) {
    console.warn(
      `[übersprungen] ${name} - ohne SWISSHUB_TEST_DATABASE_URL laufen die datenbankgestützten Tests nicht.`,
    );
    describe.skip(name, factory);
    return;
  }
  describe(name, factory);
}

/**
 * Gibt dieser Testdatei ein eigenes PostgreSQL-Schema.
 *
 * Vitest führt Testdateien parallel aus. Ohne getrennte Schemata würden sich
 * zwei datenbankgestützte Dateien gegenseitig die Tabellen leeren - und die
 * Fehler wären sporadisch und schwer zu deuten.
 *
 * Muss vor dem ersten Import von `@swisshub/database` aufgerufen werden: der
 * Prisma Client liest die Verbindungszeichenfolge beim Laden.
 */
export function useTestSchema(name: string): string {
  if (!hasTestDatabase) {
    return '';
  }
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set('schema', name);
  process.env.DATABASE_URL = url.toString();
  return url.toString();
}

/**
 * Bringt das Schema der Testdatenbank auf den Stand des Prisma-Schemas.
 *
 * `db push` statt `migrate deploy`: die Testdatenbank ist ein Wegwerfobjekt,
 * ihre Migrationshistorie interessiert niemanden.
 *
 * `--accept-data-loss` aus demselben Grund: das Schema behaelt zwischen
 * Laeufen die Zeilen des letzten Laufs, und eine neu hinzugekommene
 * Eindeutigkeit oder eine entfallene Spalte laesst `db push` sonst mit einer
 * Warnung stehenbleiben - der Lauf braeche ab, obwohl genau diese Altdaten
 * niemanden interessieren. Auf eine echte Datenbank zeigt `pushSchema` nie:
 * es laeuft ausschliesslich gegen `SWISSHUB_TEST_DATABASE_URL`.
 */
export function pushSchema(): void {
  execFileSync(
    'npx',
    [
      'prisma',
      'db',
      'push',
      '--schema',
      'packages/database/prisma/schema.prisma',
      '--skip-generate',
      '--accept-data-loss',
    ],
    {
      // `process.env.DATABASE_URL` zeigt hier bereits auf das Schema dieser
      // Datei (siehe `useTestSchema`).
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? TEST_DATABASE_URL },
      stdio: 'pipe',
    },
  );
}
