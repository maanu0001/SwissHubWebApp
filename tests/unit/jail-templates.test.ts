import { describe, expect, it } from 'vitest';
import { jail } from '@swisshub/modules';

/**
 * Nachrichtenvorlagen.
 *
 * Die Texte kommen aus dem Dashboard und damit von Menschen. Getestet wird
 * deshalb nicht nur, dass die Platzhalter stimmen, sondern vor allem, dass
 * eine unglückliche oder böswillige Vorlage keinen Schaden anrichtet.
 */
const BASE = {
  targetDiscordId: '100000000000000004',
  targetLabel: 'spammer99',
  moderatorLabel: 'nina.mod',
  durationSeconds: 2 * 60 * 60,
  endsAt: new Date('2026-08-20T18:30:00Z'),
  gender: null,
};

describe('Platzhalter', () => {
  it('setzt die bekannten Werte ein', () => {
    const text = jail.renderJailTemplate(
      '{mention} ({user}) · {duration} · von {moderator}',
      BASE,
    );

    expect(text).toBe('<@100000000000000004> (spammer99) · 2 Std. · von nina.mod');
  });

  it('nutzt Discord-Zeitstempel statt fest formatierter Daten', () => {
    // Discord rechnet den Wert im Client der Leserin um - inklusive Zeitzone.
    const text = jail.renderJailTemplate('{end_time} / {end_relative}', BASE);
    expect(text).toMatch(/^<t:\d+:f> \/ <t:\d+:R>$/u);
  });

  it('schreibt bei einem permanenten Jail "permanent" statt eines Datums', () => {
    const text = jail.renderJailTemplate('{duration} bis {end_time}', {
      ...BASE,
      durationSeconds: null,
      endsAt: null,
    });
    expect(text).toBe('permanent bis permanent');
  });

  it('lässt unbekannte Platzhalter unverändert stehen', () => {
    // Ein Tippfehler soll sichtbar sein, nicht stillschweigend verschwinden.
    expect(jail.renderJailTemplate('{mentionn} {duration}', BASE)).toBe('{mentionn} 2 Std.');
  });
});

describe('Anrede', () => {
  it('wählt die Variante passend zum Geschlecht', () => {
    const template = '{gendered:De|D|De/D} {user} isch im Jail';
    expect(jail.renderJailTemplate(template, { ...BASE, gender: 'MALE' })).toBe('De spammer99 isch im Jail');
    expect(jail.renderJailTemplate(template, { ...BASE, gender: 'FEMALE' })).toBe('D spammer99 isch im Jail');
    expect(jail.renderJailTemplate(template, { ...BASE, gender: null })).toBe('De/D spammer99 isch im Jail');
  });

  it('verbindet ohne dritte Variante beide Formen, statt eine zu raten', () => {
    expect(jail.renderJailTemplate('{gendered:Er|Si}', { ...BASE, gender: null })).toBe('Er/Si');
  });

  it('setzt das Pronomen', () => {
    expect(jail.renderJailTemplate('{pronoun}', { ...BASE, gender: 'FEMALE' })).toBe('sie');
    expect(jail.renderJailTemplate('{pronoun}', { ...BASE, gender: null })).toBe('er/sie');
  });

  it('leitet das Geschlecht nur aus konfigurierten Rollen ab', () => {
    const config = { maleRoleId: '900000000000000010', femaleRoleId: '900000000000000011' };
    expect(jail.resolveGender(['900000000000000011'], config)).toBe('FEMALE');
    expect(jail.resolveGender(['900000000000000010'], config)).toBe('MALE');
    expect(jail.resolveGender(['900000000000000099'], config)).toBeNull();
    // Ohne Konfiguration bleibt alles neutral - es wird nichts vermutet.
    expect(jail.resolveGender(['900000000000000011'], { maleRoleId: null, femaleRoleId: null })).toBeNull();
  });
});

describe('Sicherheit', () => {
  it('entschärft Markdown im Namen', () => {
    const text = jail.renderJailTemplate('{user}', { ...BASE, targetLabel: '**fett**' });

    expect(text).not.toContain('**fett**');
    expect(text).toContain('\\*\\*fett\\*\\*');
  });

  it('gibt den Grund über eine Vorlage nicht mehr aus', () => {
    // Öffentliche Vorlagen kennen den Grund nicht mehr - und eine alte
    // Vorlage, die ihn noch enthält, gibt ihn auch nicht preis.
    expect(jail.renderJailTemplate('{user}: {reason}', BASE)).toBe('spammer99:');
    expect(jail.renderJailTemplate('{mention} isch im Jail. Grund: {reason}', BASE)).toBe(
      `<@${BASE.targetDiscordId}> isch im Jail.`,
    );
    // Auch die Beschriftung verschwindet mit - «Grund:» ohne Grund wäre
    // schlimmer als beides.
    expect(jail.renderJailTemplate('{mention} — Grund: {reason}', BASE)).toBe(
      `<@${BASE.targetDiscordId}>`,
    );
  });

  it('kann über die Vorlage niemanden zusätzlich anpingen', () => {
    // Der Text kann `@everyone` enthalten - wirksam wird er nur, wenn die
    // Erwähnung beim Senden ausdrücklich freigegeben ist. Genau das tut
    // `postTemplateMessage` nicht.
    const text = jail.renderJailTemplate('@everyone {mention}', BASE);
    expect(text).toBe('@everyone <@100000000000000004>');
  });

  it('kürzt eine übermässig lange Vorlage', () => {
    const text = jail.renderJailTemplate('x'.repeat(5000), BASE);
    expect(text.length).toBeLessThanOrEqual(1800);
  });
});

describe('Vorschau', () => {
  it('zeigt lesbare Beispielwerte statt roher IDs', () => {
    const preview = jail.previewJailTemplate(jail.DEFAULT_PUBLIC_TEMPLATE);

    expect(preview).toContain('@Beispiel');
    expect(preview).not.toContain('<@');
    expect(preview).not.toContain('<t:');
  });

  it('zeigt die permanente Fassung ohne Enddatum', () => {
    const preview = jail.previewJailTemplate(jail.DEFAULT_PERMANENT_PUBLIC_TEMPLATE, { permanent: true });
    expect(preview).toContain('permanent');
  });
});
