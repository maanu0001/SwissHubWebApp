import { describe, expect, it } from 'vitest';
import { jail } from '@swisshub/modules';
import { escapeDiscordMarkdown, sanitizeText, snowflakeSchema, snowflakeToDate } from '@swisshub/shared';

/** Zero-Width-Space, mit dem Massen-Mentions entschärft werden. */
const ZERO_WIDTH = String.fromCharCode(0x200b);

describe('Jail-Eingabevalidierung', () => {
  const validInput = {
    targetDiscordId: '123456789012345678',
    durationSeconds: 3600,
    reason: 'Spam im Chat',
    idempotencyKey: '2f6a5f7e-2a4b-4c1d-9f3e-8a7b6c5d4e3f',
  };

  it('akzeptiert gültige Eingaben', () => {
    const parsed = jail.createJailSchema.parse(validInput);
    expect(parsed.durationSeconds).toBe(3600);
    expect(parsed.reason).toBe('Spam im Chat');
  });

  it('lehnt ungültige Discord IDs ab', () => {
    expect(() => jail.createJailSchema.parse({ ...validInput, targetDiscordId: 'abc' })).toThrow();
    expect(() => jail.createJailSchema.parse({ ...validInput, targetDiscordId: '123' })).toThrow();
    expect(() =>
      jail.createJailSchema.parse({ ...validInput, targetDiscordId: "123456789012345678' OR 1=1--" }),
    ).toThrow();
  });

  it('erzwingt Mindest- und Maximaldauer', () => {
    expect(() => jail.createJailSchema.parse({ ...validInput, durationSeconds: 30 })).toThrow();
    expect(() => jail.createJailSchema.parse({ ...validInput, durationSeconds: -3600 })).toThrow();
    expect(() =>
      jail.createJailSchema.parse({ ...validInput, durationSeconds: 400 * 24 * 60 * 60 }),
    ).toThrow();
  });

  it('erzwingt einen aussagekräftigen Grund', () => {
    expect(() => jail.createJailSchema.parse({ ...validInput, reason: 'a' })).toThrow();
    expect(() => jail.createJailSchema.parse({ ...validInput, reason: '   ' })).toThrow();
    expect(() => jail.createJailSchema.parse({ ...validInput, reason: 'x'.repeat(501) })).toThrow();
  });

  it('verlangt einen gültigen Idempotency Key', () => {
    expect(() => jail.createJailSchema.parse({ ...validInput, idempotencyKey: 'nicht-uuid' })).toThrow();
  });

  it('prüft die konfigurierte Maximaldauer zusätzlich', () => {
    expect(() => jail.assertDurationWithinLimit(8 * 24 * 3600, 7 * 24 * 3600)).toThrow();
    expect(() => jail.assertDurationWithinLimit(3600, 7 * 24 * 3600)).not.toThrow();
  });

  it('begrenzt Pagination-Parameter', () => {
    expect(jail.jailListQuerySchema.parse({ page: '5', pageSize: '10' }).page).toBe(5);
    expect(() => jail.jailListQuerySchema.parse({ pageSize: '5000' })).toThrow();
    expect(jail.jailListQuerySchema.parse({}).tab).toBe('active');
    expect(() => jail.jailListQuerySchema.parse({ tab: 'alles' })).toThrow();
  });
});

describe('Eingabe-Sanitisierung', () => {
  it('entfernt Steuerzeichen und normalisiert Leerraum', () => {
    expect(sanitizeText('Hallo    Welt\n\n')).toBe('Hallo Welt');
    expect(sanitizeText(`a${String.fromCharCode(7)}b`)).toBe('ab');
  });

  it('kürzt zu lange Eingaben', () => {
    expect(sanitizeText('x'.repeat(100), 10)).toHaveLength(10);
  });

  it('behält HTML als reinen Text (keine Interpretation im UI)', () => {
    expect(sanitizeText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });

  it('entschärft Discord-Markdown und Massen-Mentions', () => {
    expect(escapeDiscordMarkdown('**fett**')).toBe('\\*\\*fett\\*\\*');
    expect(escapeDiscordMarkdown('@everyone')).toBe(`@${ZERO_WIDTH}everyone`);
    expect(escapeDiscordMarkdown('@here')).toBe(`@${ZERO_WIDTH}here`);
  });
});

describe('Snowflakes', () => {
  it('validiert Discord IDs', () => {
    expect(snowflakeSchema.safeParse('123456789012345678').success).toBe(true);
    expect(snowflakeSchema.safeParse('12345').success).toBe(false);
    expect(snowflakeSchema.safeParse('1234567890123456789012').success).toBe(false);
  });

  it('leitet das Erstellungsdatum aus der Snowflake ab', () => {
    const date = snowflakeToDate('175928847299117063');
    expect(date?.toISOString().slice(0, 10)).toBe('2016-04-30');
    expect(snowflakeToDate('keine-id')).toBeNull();
  });
});
