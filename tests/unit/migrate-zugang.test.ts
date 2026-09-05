import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNavigation, migration, moduleViewPermission } from '@swisshub/modules';
import { PERMISSION_PRESETS, resolvePreset } from '@swisshub/permissions';

/**
 * Wer Migrate sieht - und wer nicht.
 *
 * Ein Werkzeug, das die Berechtigungen einer ganzen Installation auf eine
 * andere Guild schreibt, gehört nicht in die Seitenleiste von jemandem, der
 * Tickets bearbeitet.
 */

const P = migration.MIGRATION_PERMISSIONS;
const SEHEN = moduleViewPermission('migration');
const MODULE = new Set(['migration', 'tickets', 'jail', 'automation']);

const nav = (rechte: string[]) =>
  buildNavigation(rechte, MODULE).filter((eintrag) => eintrag.href === '/migrate');

describe('Sichtbarkeit', () => {
  it('zeigt Migrate niemandem ohne Berechtigung', () => {
    expect(nav([])).toEqual([]);
    expect(nav(['tickets.view', 'jail.view', 'moderation.view'])).toEqual([]);
  });

  it('zeigt es mit «Modul sehen» und der Ansichtsberechtigung', () => {
    expect(nav([SEHEN, P.view])).toHaveLength(1);
  });

  it('zeigt es nicht ohne «Modul sehen»', () => {
    // Sichtbarkeit ist eine eigene Entscheidung und keine Nebenwirkung.
    expect(nav([P.view])).toEqual([]);
  });

  it('steht im Systembereich', () => {
    expect(nav([SEHEN, P.view])[0]?.group).toBe('system');
  });
});

describe('Keine Vorlage bringt Migrate mit', () => {
  it('gibt weder Mitgliedern noch Premium noch Moderation eine Migrationsberechtigung', () => {
    for (const id of ['mitglied', 'premium', 'prestige', 'moderator', 'senior-moderator', 'support-team']) {
      const vorlage = PERMISSION_PRESETS.find((eintrag) => eintrag.id === id);
      if (!vorlage) {
        continue;
      }
      const rechte = resolvePreset(vorlage);
      for (const verboten of Object.values(P)) {
        expect(rechte, `${id} darf «${verboten}» nicht haben`).not.toContain(verboten);
      }
    }
  });
});

describe('Die kritischen Schritte sind als kritisch ausgewiesen', () => {
  const definition = migration.migrationModule;

  it('markiert Anwenden und Zurücknehmen', () => {
    const kritisch = (definition.permissions ?? [])
      .filter((eintrag) => eintrag.critical)
      .map((eintrag) => eintrag.key);

    expect(kritisch).toContain(P.execute);
    expect(kritisch).toContain(P.rollback);
  });

  it('lässt Ansehen und Probelauf gewöhnlich', () => {
    const kritisch = (definition.permissions ?? [])
      .filter((eintrag) => eintrag.critical)
      .map((eintrag) => eintrag.key);

    expect(kritisch).not.toContain(P.view);
    expect(kritisch).not.toContain(P.dryRun);
  });

  it('ist standardmässig ausgeschaltet', () => {
    // Ein Werkzeug dieser Reichweite soll nicht in jeder Installation von
    // selbst dastehen.
    expect(definition.defaultEnabled).toBe(false);
  });
});

describe('Die Aktionen prüfen serverseitig', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/migration/actions.ts'), 'utf8');

  const abschnitt = (name: string): string => {
    const start = quelle.indexOf(`name: '${name}'`);
    return quelle.slice(start, quelle.indexOf('defineAction', start + 10));
  };

  it('verlangt für das Anwenden die eigene Berechtigung', () => {
    expect(abschnitt('migration.execute')).toContain('P.execute');
  });

  it('verlangt für die Rücknahme die eigene Berechtigung', () => {
    expect(abschnitt('migration.rollback')).toContain('P.rollback');
  });

  it('verlangt eine ausdrückliche Bestätigung vor dem Anwenden', () => {
    expect(abschnitt('migration.execute')).toContain('z.literal(true');
  });

  it('nimmt die Quell-Guild aus der Sitzung, nie aus der Eingabe', () => {
    // Sonst liesse sich mit einer fremden Guild-ID der Lauf einer anderen
    // Installation lesen.
    expect(quelle).toContain('async function quellGuild()');
    expect(quelle).toContain('resolveGuildId()');
  });

  it('prüft die Ziel-Guild, statt eine beliebige ID zu übernehmen', () => {
    expect(quelle).toContain('pruefeZielGuild');
  });

  it('beansprucht den Lauf, ehe es losgeht', () => {
    // Zwei Klicks dürfen nicht zwei Übertragungen anstossen.
    expect(quelle).toContain('updateMany');
    expect(quelle).toContain("status: { in: ['DRAFT', 'VALIDATING', 'READY'] }");
  });

  it('verlangt einen Probelauf vor dem Anwenden', () => {
    expect(quelle).toContain('Vor dem Anwenden muss ein Probelauf gemacht werden.');
  });
});
