import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactString } from '@swisshub/logger';

/**
 * Secret Redaction.
 *
 * Der Bot Token, das Client Secret und die Datenbank-URL dürfen nirgends
 * auftauchen - auch nicht in einer verschachtelten Fehlermeldung oder in einer
 * Konfigurationsänderung, die ins Audit Log wandert.
 */
describe('Redaction', () => {
  it('entfernt Werte echter Secrets aus Freitext', () => {
    const token = process.env.DISCORD_BOT_TOKEN!;
    expect(redactString(`Discord antwortete 401 für ${token}`)).not.toContain(token);
    expect(redactString(`Discord antwortete 401 für ${token}`)).toContain(REDACTED);
  });

  it('entfernt Authorization-Header unabhängig vom konkreten Token', () => {
    expect(redactString('Authorization: Bot MTIzNDU2Nzg5MC5hYmNkZWY')).toContain(`Bot ${REDACTED}`);
    expect(redactString('Authorization: Bearer abcdefghijklmnop')).toContain(`Bearer ${REDACTED}`);
  });

  it('maskiert sensible Schlüsselnamen in Objekten', () => {
    const output = redact({
      moduleId: 'jail',
      botToken: 'sollte-nicht-erscheinen',
      clientSecret: 'auch-nicht',
      sessionToken: 'niemals',
      cookie: 'weg damit',
      jailRoleId: '900000000000000006',
    }) as Record<string, unknown>;

    expect(output.botToken).toBe(REDACTED);
    expect(output.clientSecret).toBe(REDACTED);
    expect(output.sessionToken).toBe(REDACTED);
    expect(output.cookie).toBe(REDACTED);
    // Konfigurationswerte müssen lesbar bleiben - sonst wäre das Audit Log wertlos.
    expect(output.jailRoleId).toBe('900000000000000006');
    expect(output.moduleId).toBe('jail');
  });

  it('maskiert auch verschachtelte Konfigurationsobjekte', () => {
    const output = redact({
      before: { jailRoleId: '1', authSecret: 'geheim' },
      after: { jailRoleId: '2', authSecret: 'geheim' },
    }) as { before: Record<string, unknown>; after: Record<string, unknown> };

    expect(output.before.authSecret).toBe(REDACTED);
    expect(output.after.jailRoleId).toBe('2');
  });

  it('entfernt die Datenbank-URL aus Fehlermeldungen', () => {
    const error = new Error(`connect ECONNREFUSED ${process.env.DATABASE_URL}`);
    const output = redact(error) as { message: string };
    expect(output.message).not.toContain('postgresql://');
  });
});
