/**
 * Test-Umgebung.
 *
 * Es werden ausschliesslich Platzhalterwerte gesetzt - Tests sprechen niemals
 * mit dem echten Discord oder einer produktiven Datenbank.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.DISCORD_BOT_TOKEN = 'test-bot-token-placeholder-value';
process.env.DISCORD_CLIENT_ID = '100000000000000000';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
process.env.DISCORD_GUILD_ID = '200000000000000000';
process.env.AUTH_SECRET = 'test-auth-secret-test-auth-secret-test-auth';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.LOG_LEVEL = 'error';
