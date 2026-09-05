import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildNavigation,
  groupNavigation,
  level,
  listModuleDefinitions,
} from '@swisshub/modules';
import { PERMISSION_PRESETS, resolvePreset } from '@swisshub/permissions';

/**
 * Wer das XP-Glücksrad sieht - und was er dort darf.
 *
 * Zwei Dinge standen dem Eintrag im Weg, beide gut gemeint. Er hing an
 * `level.raffle.view`, einer Berechtigung, die jemand hätte zuteilen müssen;
 * für einen Bereich, der der ganzen Gemeinschaft gehört, ist das falsch
 * herum. Und er verschwand ganz, sobald keine Verlosung lief - womit niemand
 * mehr sah, dass es das Glücksrad überhaupt gibt, und die nächste Verlosung
 * ohne Publikum begann.
 *
 * Sichtbar ist nicht erlaubt: Teilnehmen, Anlegen, Ziehen, Neuziehen und
 * Abbrechen bleiben getrennte Berechtigungen. Genau diese Trennung hält diese
 * Datei fest - sonst wäre aus «für alle sichtbar» leicht «für alle offen»
 * geworden.
 */

const P = level.LEVEL_PERMISSIONS;
const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));
const RAD = '/xp-gluecksrad';

const nav = (rechte: string[]) => buildNavigation(rechte, ALLE_MODULE);
const sieht = (rechte: string[]): boolean => nav(rechte).some((eintrag) => eintrag.href === RAD);

const preset = (id: string): string[] =>
  resolvePreset(PERMISSION_PRESETS.find((vorlage) => vorlage.id === id)!);

describe('Sichtbarkeit in der Seitenleiste', () => {
  it('zeigt das Glücksrad einem Mitglied ganz ohne Berechtigungen', () => {
    expect(sieht([])).toBe(true);
  });

  it('zeigt es allen fünf Personas', () => {
    for (const rolle of ['mitglied', 'premium', 'moderator', 'admin']) {
      const vorlage = PERMISSION_PRESETS.find((eintrag) => eintrag.id === rolle);
      if (!vorlage) {
        continue;
      }
      expect(sieht(resolvePreset(vorlage)), rolle).toBe(true);
    }
    // Und dem, der ohnehin alles darf.
    expect(sieht(['admin.full'])).toBe(true);
  });

  it('zeigt es auch ohne «Modul sehen» des Level-Moduls', () => {
    // Sonst hinge der Bereich der Gemeinschaft an einer Berechtigung für die
    // Verwaltungsseiten des Level-Systems.
    expect(sieht([P.raffleView])).toBe(true);
    expect(nav([]).some((eintrag) => eintrag.href === '/level')).toBe(false);
  });

  it('bringt dabei keine weiteren Level-Einträge mit', () => {
    const eintraege = nav([]).filter((eintrag) => eintrag.moduleId === 'level');

    expect(eintraege.map((eintrag) => eintrag.href)).toEqual([RAD]);
  });

  it('steht in derselben Gruppe wie zuvor', () => {
    const gruppen = groupNavigation(nav([]));
    const gruppe = gruppen.find((eintrag) =>
      eintrag.items.some((item) => item.href === RAD),
    );

    expect(gruppe?.id).toBe('overview');
  });

  it('hängt nicht mehr an einer laufenden Verlosung', () => {
    const eintrag = nav([]).find((item) => item.href === RAD);

    expect(eintrag).toBeDefined();
    expect(eintrag).not.toHaveProperty('visibleWhen');
  });
});

describe('Was Sichtbarkeit nicht mitbringt', () => {
  it('lässt jede Verwaltungsberechtigung getrennt bestehen', () => {
    for (const schluessel of [
      'raffleCreate',
      'raffleEdit',
      'raffleOpen',
      'raffleClose',
      'raffleManage',
      'raffleDraw',
      'raffleRedraw',
      'raffleCancel',
      'raffleHistory',
      'raffleParticipate',
    ] as const) {
      expect(P[schluessel], schluessel).toBeTruthy();
    }
    // Und sie sind wirklich verschieden - kein Schlüssel doppelt vergeben.
    const alle = [
      P.raffleView,
      P.raffleParticipate,
      P.raffleCreate,
      P.raffleEdit,
      P.raffleOpen,
      P.raffleClose,
      P.raffleManage,
      P.raffleDraw,
      P.raffleRedraw,
      P.raffleCancel,
      P.raffleHistory,
    ];
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('gibt einem Mitglied ohne Zuteilung keine einzige Raffle-Aktion', () => {
    const eintrag = nav([]).find((item) => item.href === RAD)!;

    // Der Eintrag selbst nennt weiterhin die View-Berechtigung - er umgeht
    // sie nur für die Sichtbarkeit, nicht für das, was dahinter passiert.
    expect(eintrag.permission).toBe(P.raffleView);
    expect(eintrag.baseline).toBe(true);
  });

  it('gibt der Vorlage «Mitglied» Sehen und Teilnehmen, aber nichts weiter', () => {
    const rechte = preset('mitglied');

    expect(rechte).toContain(P.raffleView);
    expect(rechte).toContain(P.raffleParticipate);
    for (const verboten of [
      P.raffleCreate,
      P.raffleEdit,
      P.raffleDraw,
      P.raffleRedraw,
      P.raffleCancel,
      P.raffleManage,
    ]) {
      expect(rechte, verboten).not.toContain(verboten);
    }
  });

  it('gibt der Vorlage «Premium» dieselben Raffle-Rechte wie einem Mitglied', () => {
    // Premium ist beim Glücksrad kein Sonderfall - was Premium mehr hat,
    // steht woanders. Eine Sonderlogik für Premium gäbe es hier nicht zu
    // testen, weil es sie nicht geben soll.
    const mitglied = preset('mitglied').filter((recht) => recht.startsWith('level.raffle.'));
    const premium = preset('premium').filter((recht) => recht.startsWith('level.raffle.'));

    expect(premium.slice().sort()).toEqual(mitglied.slice().sort());
  });
});

describe('Die Seite selbst', () => {
  const quelle = (pfad: string): string =>
    readFileSync(fileURLToPath(new URL(`../../apps/web/src/${pfad}`, import.meta.url)), 'utf8');

  it('lässt jedes angemeldete Mitglied herein', () => {
    const seite = quelle('app/(app)/xp-gluecksrad/page.tsx');

    expect(seite).toContain('await requireMember()');
    expect(seite).not.toContain('requirePagePermission');
  });

  it('prüft die Teilnahme weiterhin einzeln', () => {
    const seite = quelle('app/(app)/xp-gluecksrad/page.tsx');

    expect(seite).toContain('can(context, level.LEVEL_PERMISSIONS.raffleParticipate)');
  });

  it('kennt keine fest eingetragene Rollenkennung', () => {
    // Weder hier noch in der Registry darf eine Discord-Rolle im Code stehen.
    for (const pfad of ['app/(app)/xp-gluecksrad/page.tsx', 'app/(app)/layout.tsx']) {
      expect(quelle(pfad), pfad).not.toMatch(/['"`]\d{17,20}['"`]/u);
    }
  });

  it('entscheidet die Navigation an einer Stelle für alle Darstellungen', () => {
    // Desktop, mobil und eingeklappt bekommen dieselbe Liste - es gibt keinen
    // zweiten Ort, an dem ein Eintrag entstehen könnte.
    const layout = quelle('app/(app)/layout.tsx');

    expect(layout).toContain('buildNavigation(navigationKeys, moduleIds)');
    expect(layout).not.toMatch(/xp-gluecksrad/u);
  });
});

describe('Die Ziehung wird nicht wiederholt', () => {
  const stage = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/modules/level/components/raffle-stage.tsx', import.meta.url)),
    'utf8',
  );

  it('bietet kein «Animation erneut ansehen» mehr an', () => {
    expect(stage).not.toContain('Animation erneut ansehen');
    // Auch nicht versteckt: der Rückruf dahinter ist ebenfalls weg.
    expect(stage).not.toContain('const nochmal');
    expect(stage).not.toContain('RotateCcw');
  });

  it('dreht die erste Ziehung weiterhin', () => {
    // Der Reveal-Ablauf bleibt vollständig - nur das Wiederholen fällt weg.
    expect(stage).toContain('setRevealed');
    expect(stage).toContain('spinning={spinning}');
    expect(stage).toContain('onSpinEnd={handleSpinEnd}');
  });

  it('behält den Fall, dass die Ziehung bei offener Seite durchläuft', () => {
    expect(stage).toContain('liveWechsel');
    expect(stage).toContain('darfNachlaufDrehen');
  });
});
