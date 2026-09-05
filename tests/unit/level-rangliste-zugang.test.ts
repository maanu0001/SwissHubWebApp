import { describe, expect, it } from 'vitest';
import { buildNavigation, listModuleDefinitions, moduleViewPermission } from '@swisshub/modules';
import { PERMISSION_PRESETS, resolvePreset } from '@swisshub/permissions';

/**
 * Wer die Rangliste sehen darf - und was er dadurch sonst nicht sieht.
 *
 * Die Rangliste ist öffentlich gemeint: sie zeigt Platz, Name und Level, und
 * genau das darf jedes Mitglied wissen. Die Übersicht des Level-Systems ist
 * etwas anderes - dort stehen die Kennzahlen des Servers.
 *
 * Der Fehler war, dass beides am selben Eintrag hing: wer nur die Rangliste
 * sehen durfte, sah gar keinen Eintrag. Diese Datei hält fest, dass er jetzt
 * einen bekommt - und dass er dadurch nichts weiter bekommt.
 */

const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));
const LEVEL_SEHEN = moduleViewPermission('level');

/**
 * Die Level-Eintraege - ohne den, der immer dasteht.
 *
 * Das XP-Gluecksrad haengt an der Anmeldung und nicht an einer Zuteilung: es
 * gehoert der ganzen Gemeinschaft. Hier geht es um die Eintraege, die man
 * zugeteilt bekommt, und die Frage «welchen Weg bekommt jemand» beantwortet
 * es nicht mit.
 */
const eintraege = (permissions: string[]) =>
  buildNavigation(permissions, ALLE_MODULE).filter(
    (eintrag) => eintrag.moduleId === 'level' && eintrag.href !== '/xp-gluecksrad',
  );

describe('Zugang zur Rangliste', () => {
  it('führt einen reinen Ranglisten-Berechtigten direkt dorthin', () => {
    const gefunden = eintraege([LEVEL_SEHEN, 'level.leaderboard.view']);

    expect(gefunden).toHaveLength(1);
    expect(gefunden[0]?.href).toBe('/level/rangliste');
    expect(gefunden[0]?.label).toBe('Rangliste');
  });

  it('zeigt einem Übersichts-Berechtigten weiterhin das ganze Modul', () => {
    const gefunden = eintraege([LEVEL_SEHEN, 'level.view', 'level.leaderboard.view']);

    expect(gefunden).toHaveLength(1);
    expect(gefunden[0]?.href).toBe('/level');
  });

  it('zeigt ohne beide Berechtigungen nichts', () => {
    expect(eintraege([LEVEL_SEHEN])).toEqual([]);
  });

  it('gibt Mitglied und Premium den Zugang', () => {
    for (const id of ['mitglied', 'premium', 'prestige']) {
      const rechte = resolvePreset(PERMISSION_PRESETS.find((preset) => preset.id === id)!);
      expect(rechte, `Vorlage «${id}»`).toContain('level.leaderboard.view');

      const gefunden = eintraege(rechte);
      expect(gefunden.length, `Vorlage «${id}» sieht das Level-System nicht`).toBeGreaterThan(0);
    }
  });
});

describe('Was die Rangliste nicht mitgibt', () => {
  const MITGLIED = resolvePreset(PERMISSION_PRESETS.find((preset) => preset.id === 'mitglied')!);
  const PREMIUM = resolvePreset(PERMISSION_PRESETS.find((preset) => preset.id === 'premium')!);

  it.each([
    ['level.members.view', 'die Mitgliederliste des Level-Systems'],
    ['level.members.manage', 'XP zu ändern'],
    ['level.stats.view', 'die Serverstatistik'],
    ['level.settings.view', 'die Einstellungen'],
    ['level.settings.manage', 'die Einstellungen zu ändern'],
    ['level.roles.manage', 'die Level-Rollen'],
    ['level.rules.manage', 'die XP-Regeln'],
  ])('gibt weder Mitglied noch Premium «%s» (%s)', (schluessel) => {
    expect(MITGLIED).not.toContain(schluessel);
    expect(PREMIUM).not.toContain(schluessel);
  });

  it('lässt die Ranglistenseite ihre eigene Berechtigung prüfen', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const quelle = readFileSync(
      join(process.cwd(), 'apps/web/src/app/(app)/level/rangliste/page.tsx'),
      'utf8',
    );
    // Der Eintrag in der Seitenleiste gewährt nichts - die Seite prüft selbst.
    expect(quelle).toContain('requirePagePermission');
    expect(quelle).toContain('leaderboardView');
  });
});
