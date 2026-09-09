import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNavigation,
  groupNavigation,
  level,
  listModuleDefinitions,
  listNavigationSignals,
  resolveNavigationSignals,
} from '@swisshub/modules';
import { expandPermissions, listPermissions, resolvePermissions } from '@swisshub/permissions';
import { ausGruppen } from '../../apps/web/src/components/layout/palette-suche';

/**
 * Das XP-Glücksrad erscheint nur, solange es etwas zu sehen gibt.
 *
 * Der Eintrag stand dauerhaft in der Seitenleiste - auch in den Wochen
 * zwischen zwei Verlosungen, in denen die Seite nichts weiter sagt als
 * «Aktuell läuft keine XP-Verlosung». Jetzt hängt er an einem
 * Laufzeit-Kennzeichen, das das Level-Modul selbst beantwortet.
 *
 * Zwei Dinge prüft diese Datei, und das zweite ist das wichtigere:
 *
 * 1. Das Kennzeichen blendet den Eintrag aus und wieder ein.
 * 2. **Es gibt kein Recht.** Wer den Eintrag sieht, darf deswegen nichts,
 *    und wer ihn nicht sieht, verliert nichts - Teilnahme, Ziehung und
 *    Verwaltung hängen unverändert an ihren Berechtigungen.
 */

const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));
const ROLLE = '900000000000014001';
const SIGNAL = level.RAFFLE_NAVIGATION_SIGNAL;

function rechteVon(erteilt: readonly string[]): string[] {
  const resolution = resolvePermissions(
    { discordId: '900000000000014099', roleIds: [ROLLE], isOwner: false },
    erteilt.map((permission) => ({ discordRoleId: ROLLE, permission })),
  );
  return expandPermissions(
    resolution,
    listPermissions().map((definition) => definition.key),
  );
}

/** Die Navigation einer Person - mit oder ohne laufende Verlosung. */
const navVon = (erteilt: readonly string[], laufend: boolean) =>
  buildNavigation(rechteVon(erteilt), ALLE_MODULE, laufend ? new Set([SIGNAL]) : new Set<string>());

const hrefs = (erteilt: readonly string[], laufend: boolean): string[] =>
  navVon(erteilt, laufend).map((eintrag) => eintrag.href);

const MITGLIED = ['dashboard.view'];
const ADMIN = ['admin.full'];

describe('Der Eintrag hängt am Laufzeit-Kennzeichen', () => {
  it('erscheint nicht, solange keine Verlosung läuft', () => {
    expect(hrefs(MITGLIED, false)).not.toContain('/xp-gluecksrad');
  });

  it('erscheint, sobald eine läuft', () => {
    expect(hrefs(MITGLIED, true)).toContain('/xp-gluecksrad');
  });

  it('verschwindet auch beim Administrator, wenn keine läuft', () => {
    // Das Kennzeichen sagt «es gibt hier gerade nichts» - das gilt für alle.
    // Verwaltet wird das Glücksrad weiterhin über das Level-System.
    expect(hrefs(ADMIN, false)).not.toContain('/xp-gluecksrad');
    expect(hrefs(ADMIN, true)).toContain('/xp-gluecksrad');
  });

  it('lässt den Rest der Navigation unberührt', () => {
    const ohne = hrefs(ADMIN, false);
    const mit = hrefs(ADMIN, true);

    expect(mit.filter((href) => href !== '/xp-gluecksrad')).toEqual(ohne);
  });

  it('nimmt niemandem den Zugang zum Level-System', () => {
    // Dort wird das Glücksrad verwaltet - dieser Weg bleibt immer offen.
    expect(hrefs(ADMIN, false)).toContain('/level');
  });
});

describe('Sichtbar ist nicht erlaubt', () => {
  it('gibt einem Mitglied ohne Rechte keine Verlosungsrechte', () => {
    const keys = rechteVon(MITGLIED);

    for (const recht of [
      level.LEVEL_PERMISSIONS.raffleCreate,
      level.LEVEL_PERMISSIONS.raffleDraw,
      level.LEVEL_PERMISSIONS.raffleManage,
    ]) {
      expect(keys, recht).not.toContain(recht);
    }
  });

  it('ändert die Rechte nicht, je nachdem ob eine Verlosung läuft', () => {
    // Das Kennzeichen entfernt einen Eintrag; es vergibt keinen.
    expect(rechteVon(MITGLIED)).toEqual(rechteVon(MITGLIED));

    const ohne = navVon(MITGLIED, false).map((eintrag) => eintrag.permission);
    const mit = navVon(MITGLIED, true).map((eintrag) => eintrag.permission);

    expect(mit.filter((permission) => permission !== level.LEVEL_PERMISSIONS.raffleView)).toEqual(ohne);
  });

  it('behält die bestehende Semantik: während des Fensters sehen es alle', () => {
    // Der Eintrag war und bleibt `baseline` - wer angemeldet ist, sieht ihn,
    // solange eine Verlosung läuft. Diese Änderung fügt nur das Zeitfenster
    // hinzu, sie nimmt keiner Rolle etwas weg.
    const eintrag = navVon([], true).find((zeile) => zeile.href === '/xp-gluecksrad');

    expect(eintrag).toBeDefined();
    expect(eintrag?.baseline).toBe(true);
  });
});

describe('Eine Regel für alle Navigationen', () => {
  it('meldet das Level-Modul genau ein Kennzeichen an', () => {
    const ids = listNavigationSignals().map((signal) => signal.id);

    expect(ids).toContain(SIGNAL);
  });

  it('löst die Kennzeichen an genau einer Stelle im Layout auf', () => {
    const layout = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/layout.tsx'), 'utf8');

    expect(layout).toContain('resolveNavigationSignals()');
    // Genau ein Aufruf von `buildNavigation` - Seitenleiste, mobile
    // Navigation und Schnellnavigation bekommen dieselbe fertige Liste.
    expect(layout.match(/buildNavigation\(/gu)).toHaveLength(1);
  });

  it('lässt den Eintrag auch aus der Schnellnavigation verschwinden', () => {
    // Sonst gäbe es einen versteckten Weg zu einem ausgeblendeten Bereich.
    const ohne = ausGruppen(groupNavigation(navVon(ADMIN, false)));
    const mit = ausGruppen(groupNavigation(navVon(ADMIN, true)));

    expect(ohne.map((eintrag) => eintrag.href)).not.toContain('/xp-gluecksrad');
    expect(mit.map((eintrag) => eintrag.href)).toContain('/xp-gluecksrad');
  });

  it('kann keinen Zustand «Desktop unsichtbar, Mobile sichtbar» erzeugen', () => {
    // Beide rendern dieselbe Komponente mit derselben Liste - es gibt keine
    // zweite Stelle, an der gefiltert würde.
    for (const datei of [
      'apps/web/src/components/layout/sidebar.tsx',
      'apps/web/src/components/layout/mobile-nav.tsx',
    ]) {
      const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
      expect(quelle, datei).toContain('<SidebarNav');
      expect(quelle, datei).not.toContain('xp-gluecksrad');
    }
  });

  it('kennt im App Shell keinen Modulnamen', () => {
    // Ein `if` auf «xp-gluecksrad» im Layout wäre genau die parallele Logik,
    // die die Module Registry verhindern soll.
    const layout = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/layout.tsx'), 'utf8');

    expect(layout).not.toContain('xp-gluecksrad');
    expect(layout).not.toContain('hatLaufendeVerlosung');
  });
});

describe('Ein Kennzeichen ohne Antwort blendet aus', () => {
  it('behandelt ein fehlendes Kennzeichen als nicht gesetzt', () => {
    // Ohne Angabe gilt keines als gesetzt - die vorsichtige Richtung. Ein
    // Bereich, über dessen Zustand wir nichts wissen, wird nicht angepriesen.
    expect(buildNavigation(rechteVon(ADMIN), ALLE_MODULE).map((eintrag) => eintrag.href)).not.toContain(
      '/xp-gluecksrad',
    );
  });

  it('liefert bei einem scheiternden Kennzeichen kein gesetztes zurück', async () => {
    // `resolveNavigationSignals` fängt Fehler ab: ein Ausfall der Datenbank
    // darf nicht die ganze Navigation mitreissen.
    const gesetzt = await resolveNavigationSignals();

    expect(gesetzt instanceof Set).toBe(true);
  });
});
