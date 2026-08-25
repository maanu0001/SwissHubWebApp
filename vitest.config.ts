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
  },
});
