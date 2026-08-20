import { afterEach, describe, expect, it } from 'vitest';
import {
  EnvironmentError,
  assertServerEnv,
  listDeprecatedEnvKeys,
  resetServerEnvCache,
  serverEnvSchema,
} from '@swisshub/config';

const VALID = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  DISCORD_BOT_TOKEN: 'a-token-that-is-long-enough',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_GUILD_ID: '123456789012345678',
  AUTH_SECRET: 'x'.repeat(32),
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
} as NodeJS.ProcessEnv;

afterEach(() => {
  resetServerEnvCache();
});

describe('Environment-Validierung', () => {
  it('akzeptiert eine vollständige Konfiguration', () => {
    const parsed = serverEnvSchema.parse(VALID);
    expect(parsed.DISCORD_GUILD_ID).toBe('123456789012345678');
    expect(parsed.SESSION_ABSOLUTE_TTL_HOURS).toBe(168);
    expect(parsed.DEV_MOCK_DISCORD).toBe(false);
  });

  it('meldet fehlende Variablen mit klarer Fehlermeldung', () => {
    resetServerEnvCache();
    const incomplete = { ...VALID };
    delete incomplete.DISCORD_BOT_TOKEN;

    try {
      assertServerEnv(incomplete);
      throw new Error('Es hätte ein Fehler geworfen werden müssen');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      expect((error as EnvironmentError).message).toContain('DISCORD_BOT_TOKEN');
      expect((error as EnvironmentError).message).toContain('.env.example');
    }
  });

  it('lehnt zu kurze Secrets ab', () => {
    const result = serverEnvSchema.safeParse({ ...VALID, AUTH_SECRET: 'zu-kurz' });
    expect(result.success).toBe(false);
  });

  it('lehnt ungültige Discord IDs ab', () => {
    expect(serverEnvSchema.safeParse({ ...VALID, DISCORD_GUILD_ID: 'nicht-numerisch' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...VALID, DISCORD_ADMIN_ROLE_ID: '42' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...VALID, DISCORD_ADMIN_ROLE_ID: '' }).success).toBe(true);
  });

  it('startet auch ohne DISCORD_GUILD_ID - der Server wird im Dashboard verbunden', () => {
    const withoutGuild = { ...VALID };
    delete withoutGuild.DISCORD_GUILD_ID;

    const parsed = serverEnvSchema.safeParse(withoutGuild);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.DISCORD_GUILD_ID).toBeUndefined();
  });

  it('meldet abgelöste Variablen mit Hinweis auf die neue Stelle', () => {
    expect(listDeprecatedEnvKeys({} as NodeJS.ProcessEnv)).toEqual([]);

    const deprecated = listDeprecatedEnvKeys({
      DISCORD_GUILD_ID: '123456789012345678',
      DISCORD_JAIL_ROLE_ID: '',
      DISCORD_ADMIN_ROLE_ID: '123456789012345678',
    } as NodeJS.ProcessEnv);

    expect(deprecated.map((entry) => entry.key)).toEqual(['DISCORD_GUILD_ID', 'DISCORD_ADMIN_ROLE_ID']);
    expect(deprecated[0]?.replacement).toContain('/setup');
  });

  it('verweigert den Mock-Modus in Production', () => {
    const result = serverEnvSchema.safeParse({
      ...VALID,
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://swisshub.example',
      DEV_MOCK_DISCORD: 'true',
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('Production');
  });

  it('verlangt HTTPS in Production', () => {
    const result = serverEnvSchema.safeParse({ ...VALID, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
  });
});
