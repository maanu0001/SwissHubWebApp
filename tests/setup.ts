/**
 * Test-Umgebung.
 *
 * Es werden ausschliesslich Platzhalterwerte gesetzt - Tests sprechen niemals
 * mit dem echten Discord oder einer produktiven Datenbank.
 */
process.env.NODE_ENV = 'test';
// Datenbankgestützte Tests nutzen `SWISSHUB_TEST_DATABASE_URL` (siehe
// `tests/helpers/database.ts`) und werden ohne sie übersprungen. Die übrigen
// Tests sprechen nie mit einer echten Datenbank - der Platzhalter genügt.
process.env.DATABASE_URL =
  process.env.SWISSHUB_TEST_DATABASE_URL?.trim() ||
  'postgresql://test:test@localhost:5432/test?schema=public';
process.env.DISCORD_BOT_TOKEN = 'test-bot-token-placeholder-value';
process.env.DISCORD_CLIENT_ID = '100000000000000000';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
process.env.DISCORD_GUILD_ID = '200000000000000000';
process.env.AUTH_SECRET = 'test-auth-secret-test-auth-secret-test-auth';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.LOG_LEVEL = 'error';

/**
 * Kein Besitzer in Tests.
 *
 * Vitest übernimmt Werte aus `.env` in `process.env`. Stimmt die dort
 * hinterlegte Besitzer-ID zufällig mit einer Test-ID überein, umgeht dieser
 * Aufrufer sämtliche Berechtigungsprüfungen - und ein Test, der genau die
 * prüfen soll, wird still wirkungslos.
 */
process.env.SWISSHUB_OWNER_DISCORD_ID = '';
