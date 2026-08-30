import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pfad = (relativ: string): string => fileURLToPath(new URL(relativ, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Damit Tests die Server-Helfer der WebApp aufrufen koennen statt ihren
      // Quelltext zu lesen. `server-only` wirft beim Import ausserhalb einer
      // Server-Umgebung - im Test steht dafuer ein leeres Modul.
      'server-only': pfad('./tests/helpers/server-only-stub.ts'),
      '@': pfad('./apps/web/src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
    /**
     * `beforeAll` bringt bei datenbankgestuetzten Tests das Schema hoch, und
     * das ist ein eigener Prozess: `prisma db push` gegen ein Schema mit weit
     * ueber hundert Tabellen. Bei 96 Testdateien laufen davon viele
     * gleichzeitig, und unter dieser Last braucht ein einzelner Aufruf
     * regelmaessig mehr als die zehn Sekunden, die Vitest fuer Hooks vorgibt.
     *
     * Der Test selbst ist dann nicht langsam - nur seine Vorbereitung. Eine
     * knappe Frist macht daraus einen Fehlschlag, der nichts ueber den Code
     * aussagt, und genau so ein Fehlschlag ist schlimmer als gar keiner: er
     * kostet Vertrauen in alle uebrigen.
     */
    hookTimeout: 120_000,
  },
});
