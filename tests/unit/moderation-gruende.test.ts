import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listModuleDefinitions, moderation } from '@swisshub/modules';

/**
 * Die eine Liste von Gründen.
 *
 * Vorher gab es sie zweimal: das Jail-Modul führte eine im Dashboard
 * pflegbare Liste, und das Moderation Center hatte für Bann, Kick und Timeout
 * gar keine - dort war der Grund jedes Mal neu zu tippen. Das Ergebnis war
 * absehbar: derselbe Sachverhalt stand als «Spam», «spam», «Spamming» und
 * «spammt seit Tagen» in der Akte, und keine Auswertung darüber war je etwas
 * wert.
 *
 * Drei Dinge, die eine Vorlage ausdrücklich nicht ist, und alle drei stehen
 * hier: keine Vorschrift, keine Regel, keine Berechtigung.
 */

const { reasonTemplatesFor, STANDARD_REASON_TEMPLATES, MODERATION_ACTIONS } = moderation;
const OHNE_EIGENE: moderation.ReasonTemplateQuelle = { reasonTemplates: '' };

const texte = (
  action: moderation.ModerationAction,
  quelle: moderation.ReasonTemplateQuelle = OHNE_EIGENE,
): string[] =>
  reasonTemplatesFor(action, quelle).map((vorlage) => vorlage.reasonText);

describe('Jede Massnahme bekommt Vorlagen', () => {
  it('bietet für jede Massnahme mit Grundfeld etwas an', () => {
    for (const action of MODERATION_ACTIONS) {
      expect(texte(action).length, action).toBeGreaterThan(0);
    }
  });

  it('bietet sie bei Bann, Kick, Timeout und Jail an', () => {
    // Die vier, die vorher nichts hatten oder eine eigene Liste führten.
    for (const action of ['BAN', 'KICK', 'TIMEOUT', 'JAIL'] as const) {
      expect(texte(action), action).toContain('Spam');
    }
  });

  it('bietet sie auch beim Aufheben eines Timeouts und bei der Notiz an', () => {
    expect(texte('TIMEOUT_REMOVE').length).toBeGreaterThan(0);
    expect(texte('NOTE').length).toBeGreaterThan(0);
  });
});

describe('Welche Gründe es gibt', () => {
  it('kennt «Unter 16» und «Bot»', () => {
    expect(texte('BAN')).toContain('Unter 16');
    expect(texte('BAN')).toContain('Bot');
  });

  it('bietet sie dort an, wo sie einen Sinn ergeben', () => {
    // Sie beschreiben, wer jemand ist, nicht was er getan hat: als Notiz
    // ergäben sie keinen Satz, und einen Timeout gegen einen Bot setzt
    // niemand - man entfernt ihn.
    for (const action of ['BAN', 'KICK', 'JAIL'] as const) {
      expect(texte(action), action).toContain('Unter 16');
      expect(texte(action), action).toContain('Bot');
    }
    for (const action of ['NOTE', 'TIMEOUT', 'TIMEOUT_REMOVE'] as const) {
      expect(texte(action), action).not.toContain('Unter 16');
      expect(texte(action), action).not.toContain('Bot');
    }
  });

  it('verliert keinen der bisherigen Jail-Gründe', () => {
    for (const bisher of [
      'Spam',
      'Beleidigung',
      'Provokation',
      'Regelverstoss',
      'Unangemessenes Verhalten',
      'Voice-Verhalten',
      'Werbung',
    ]) {
      expect(texte('JAIL'), bisher).toContain(bisher);
    }
  });

  it('vergibt jede Kennung genau einmal', () => {
    const ids = STANDARD_REASON_TEMPLATES.map((vorlage) => vorlage.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hält eine Reihenfolge ein', () => {
    const reihen = texte('BAN');
    expect(reihen[0]).toBe('Spam');
    expect(reihen[reihen.length - 1]).toBe('Bot');
  });
});

describe('Eigene Gründe', () => {
  it('nimmt sie aus den Einstellungen dazu', () => {
    const mitEigenen = texte('BAN', { reasonTemplates: 'Streaming-Regeln\nAlt-Account' });

    expect(mitEigenen).toContain('Streaming-Regeln');
    expect(mitEigenen).toContain('Alt-Account');
    // Und die Vorgaben bleiben.
    expect(mitEigenen).toContain('Spam');
  });

  it('bietet sie bei jeder Massnahme an', () => {
    // Wer einen eigenen Grund einträgt, weiss selbst, wann er ihn braucht.
    for (const action of MODERATION_ACTIONS) {
      expect(texte(action, { reasonTemplates: 'Alt-Account' }), action).toContain('Alt-Account');
    }
  });

  it('erzeugt keine Duplikate - auch nicht in anderer Schreibweise', () => {
    const doppelt = texte('BAN', { reasonTemplates: 'Spam\nspam\n  SPAM  \nAlt-Account\nAlt-Account' });

    expect(doppelt.filter((grund) => grund.toLowerCase() === 'spam')).toHaveLength(1);
    expect(doppelt.filter((grund) => grund === 'Alt-Account')).toHaveLength(1);
  });

  it('lässt leere Zeilen und Unbrauchbares weg', () => {
    const gefiltert = texte('BAN', { reasonTemplates: '  \n\nok\n' + 'x'.repeat(200) + '\nGültig' });

    expect(gefiltert).toContain('Gültig');
    expect(gefiltert).not.toContain('ok');
    expect(gefiltert.some((grund) => grund.length > 100)).toBe(false);
  });
});

describe('Vorgaben ausblenden', () => {
  it('blendet eine Vorgabe je Kennung aus', () => {
    const ohne = texte('BAN', { reasonTemplates: '', disabledReasonTemplates: 'werbung' });

    expect(ohne).not.toContain('Werbung');
    expect(ohne).toContain('Spam');
  });

  it('lässt eine ausgeblendete Vorgabe bei keiner Massnahme erscheinen', () => {
    for (const action of MODERATION_ACTIONS) {
      const ohne = texte(action, { reasonTemplates: '', disabledReasonTemplates: 'spam' });
      expect(ohne, action).not.toContain('Spam');
    }
  });
});

describe('Eine Vorlage ist ein Text und sonst nichts', () => {
  it('trägt keine Sonderbedeutung', () => {
    // Aus «Bot» folgt keine Sonderbehandlung irgendwo im System - sonst wäre
    // aus einer Textvorlage eine versteckte Geschäftsregel geworden.
    const quelltext = readFileSync(
      join(process.cwd(), 'packages/modules/src/moderation/reasons.ts'),
      'utf8',
    );
    expect(quelltext).not.toMatch(/if\s*\(\s*reason/u);

    const dienst = readFileSync(
      join(process.cwd(), 'packages/modules/src/moderation/service.ts'),
      'utf8',
    );
    for (const vorlage of ['Unter 16', "'Bot'"]) {
      expect(dienst, vorlage).not.toContain(vorlage);
    }
  });

  it('kennt keine fest eingetragene Rollen- oder Guild-Kennung', () => {
    const quelltext = readFileSync(
      join(process.cwd(), 'packages/modules/src/moderation/reasons.ts'),
      'utf8',
    );
    expect(quelltext).not.toMatch(/\d{17,20}/u);
  });
});

describe('Konfigurierbar über die bestehenden Einstellungen', () => {
  const modul = listModuleDefinitions().find((eintrag) => eintrag.id === 'moderation');

  it('hängt an den Moduleinstellungen der Moderation', () => {
    expect(modul?.settingsSchema).toBeTruthy();
    expect(modul?.settingsFields?.map((feld) => feld.key)).toEqual(
      expect.arrayContaining(['reasonTemplates', 'disabledReasonTemplates']),
    );
  });

  it('lässt das Jail-Modul keine zweite Liste mehr führen', () => {
    const jailModul = listModuleDefinitions().find((eintrag) => eintrag.id === 'jail');

    expect(jailModul?.settingsFields?.some((feld) => feld.key === 'reasonPresets')).toBe(false);
  });

  it('schützt die Einstellungen mit der bestehenden Berechtigung', () => {
    // Kein eigener Schlüssel fürs Pflegen von Vorlagen - wer die
    // Moduleinstellungen ändern darf, ändert auch diese.
    const nav = readFileSync(join(process.cwd(), 'apps/web/src/server/moderation.ts'), 'utf8');
    expect(nav).toContain("can(context, p.settingsManage) || can(context, 'modules.manage')");
  });
});
