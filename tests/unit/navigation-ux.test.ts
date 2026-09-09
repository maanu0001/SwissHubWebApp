import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NAVIGATION_GROUPS,
  buildNavigation,
  groupNavigation,
  listModuleDefinitions,
} from '@swisshub/modules';
import {
  PERMISSION_PRESETS,
  expandPermissions,
  listPermissions,
  resolvePermissions,
  resolvePreset,
} from '@swisshub/permissions';
import { ausGruppen, passt } from '../../apps/web/src/components/layout/palette-suche';

/**
 * Der UX-Refactor der Navigation.
 *
 * Die eine Zusage, die diesen Umbau trägt: **niemand sieht hinterher etwas
 * anderes als vorher.** Gruppen umbenennen, Abschnitte einklappbar machen und
 * eine Schnellnavigation bauen sind Darstellungsfragen - sie dürfen die
 * Sichtbarkeit keines einzigen Eintrags verändern.
 *
 * Deshalb steht hier zuerst die Paritätsprüfung über alle Rollenvorlagen und
 * erst danach das Neue.
 */

const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));
const ROLLE = '900000000000013001';

function rechteVon(erteilt: readonly string[]): string[] {
  const resolution = resolvePermissions(
    { discordId: '900000000000013099', roleIds: [ROLLE], isOwner: false },
    erteilt.map((permission) => ({ discordRoleId: ROLLE, permission })),
  );
  return expandPermissions(
    resolution,
    listPermissions().map((definition) => definition.key),
  );
}

const navVon = (erteilt: readonly string[]) => buildNavigation(rechteVon(erteilt), ALLE_MODULE);

describe('Sichtbarkeit bleibt unverändert', () => {
  it.each(PERMISSION_PRESETS.map((preset) => [preset.id, preset] as const))(
    'gibt der Vorlage «%s» dieselben Einträge wie zuvor',
    (_id, preset) => {
      const eintraege = navVon(resolvePreset(preset));

      // Jeder Eintrag ist durch eine Berechtigung oder `baseline` gedeckt -
      // die Gruppierung hat daran nichts geändert.
      expect(eintraege.length).toBeGreaterThan(0);
      for (const eintrag of eintraege) {
        expect(ALLE_MODULE.has(eintrag.moduleId), eintrag.href).toBe(true);
      }
    },
  );

  it('zeigt einer Rolle ohne Rechte weiterhin nur die baseline-Einträge', () => {
    expect(
      navVon([])
        .map((eintrag) => eintrag.href)
        .sort(),
    ).toEqual(['/profile', '/xp-gluecksrad']);
  });

  it('zeigt ohne members.view weiterhin keinen Mitgliederbereich', () => {
    const eintraege = navVon(['dashboard.view', 'premium.view']).map((eintrag) => eintrag.href);

    expect(eintraege).not.toContain('/members');
    expect(eintraege).not.toContain('/server/permissions');
  });

  it('gibt dem Administrator weiterhin jeden Bereich', () => {
    const admin = navVon(['admin.full']).map((eintrag) => eintrag.href);

    for (const pflicht of ['/dashboard', '/members', '/tickets', '/automationen', '/analytics']) {
      expect(admin, pflicht).toContain(pflicht);
    }
  });
});

describe('Die Abschnitte der Seitenleiste', () => {
  it('trägt für jeden Abschnitt eine Beschriftung ausser dem ersten', () => {
    const [erster, ...weitere] = NAVIGATION_GROUPS;

    expect(erster?.label).toBeNull();
    for (const gruppe of weitere) {
      expect(gruppe.label, gruppe.id).toBeTruthy();
    }
  });

  it('lässt den ersten Abschnitt nicht zuklappen', () => {
    // Er ist kurz, und wer ihn zuklappt, hat seine Seitenleiste leer gemacht.
    expect(NAVIGATION_GROUPS[0]?.collapsible).toBe(false);
  });

  it('lässt jeden beschrifteten Abschnitt zuklappen', () => {
    for (const gruppe of NAVIGATION_GROUPS.filter((eintrag) => eintrag.label !== null)) {
      expect(gruppe.collapsible, gruppe.id).toBe(true);
    }
  });

  it('nennt die Abschnitte nach der Sache statt nach der Bauart', () => {
    const labels = NAVIGATION_GROUPS.map((gruppe) => gruppe.label);

    expect(labels).toContain('Community');
    expect(labels).toContain('Support & Moderation');
    // «Module» war ein Wort aus der Bauart - es sagte niemandem, was dort steht.
    expect(labels).not.toContain('Module');
  });

  it('führt Analytics nicht mehr unter Moderation', () => {
    // Es zeigt Zahlen über den Server, nicht Massnahmen gegen Menschen.
    const gruppen = groupNavigation(navVon(['admin.full']));
    const moderation = gruppen.find((gruppe) => gruppe.id === 'moderation');
    const system = gruppen.find((gruppe) => gruppe.id === 'system');

    expect(moderation?.items.map((eintrag) => eintrag.href)).not.toContain('/analytics');
    expect(system?.items.map((eintrag) => eintrag.href)).toContain('/analytics');
  });

  it('reicht die Einklappbarkeit an die Oberfläche weiter', () => {
    const gruppen = groupNavigation(navVon(['admin.full']));

    expect(gruppen.every((gruppe) => typeof gruppe.collapsible === 'boolean')).toBe(true);
  });

  it('lässt keinen leeren Abschnitt stehen', () => {
    for (const gruppe of groupNavigation(navVon(['dashboard.view']))) {
      expect(gruppe.items.length, gruppe.id).toBeGreaterThan(0);
    }
  });
});

describe('Schnellnavigation', () => {
  const gruppen = groupNavigation(navVon(['admin.full']));
  const eintraege = ausGruppen(gruppen);
  type Eintrag = (typeof eintraege)[number];

  it('kennt genau die Einträge der Seitenleiste', () => {
    // Die eigentliche Zusage: die Palette hat keine eigene Liste. Sie kann
    // deshalb nichts anbieten, was die Seitenleiste nicht auch zeigt.
    expect(eintraege.map((eintrag: Eintrag) => eintrag.href).sort()).toEqual(
      gruppen
        .flatMap((gruppe) => gruppe.items)
        .map((item) => item.href)
        .sort(),
    );
  });

  it('bietet einem Mitglied ohne Rechte nur seine eigenen Bereiche an', () => {
    const ohneRechte = ausGruppen(groupNavigation(navVon([])));

    expect(ohneRechte.map((eintrag) => eintrag.href).sort()).toEqual(['/profile', '/xp-gluecksrad']);
    expect(ohneRechte.some((eintrag) => eintrag.href === '/members')).toBe(false);
  });

  it('findet einen Bereich über den Anfang seines Namens', () => {
    expect(
      eintraege.filter((eintrag: Eintrag) => passt(eintrag, 'tick')).map((eintrag) => eintrag.href),
    ).toContain('/tickets');
    expect(
      eintraege.filter((eintrag: Eintrag) => passt(eintrag, 'auto')).map((eintrag) => eintrag.href),
    ).toContain('/automationen');
    expect(
      eintraege.filter((eintrag: Eintrag) => passt(eintrag, 'kal')).map((eintrag) => eintrag.href),
    ).toContain('/kalender');
  });

  it('ignoriert Gross- und Kleinschreibung', () => {
    const treffer = eintraege.filter((eintrag: Eintrag) => passt(eintrag, 'TICKETS'));

    expect(treffer.map((eintrag) => eintrag.href)).toContain('/tickets');
  });

  it('findet auch über die Adresse', () => {
    expect(
      eintraege.filter((eintrag: Eintrag) => passt(eintrag, '/vote-jail')).map((eintrag) => eintrag.href),
    ).toContain('/vote-jail');
  });

  it('zeigt ohne Eingabe alles an, was diese Person darf', () => {
    expect(eintraege.filter((eintrag: Eintrag) => passt(eintrag, '')).length).toBe(eintraege.length);
    expect(eintraege.filter((eintrag: Eintrag) => passt(eintrag, '   ')).length).toBe(eintraege.length);
  });

  it('findet nichts, was es nicht gibt', () => {
    expect(eintraege.filter((eintrag: Eintrag) => passt(eintrag, 'zzzzz'))).toEqual([]);
  });

  it('nennt die Herkunft jedes Treffers', () => {
    // Zwei Bereiche können ähnlich heissen - der Abschnitt daneben sagt,
    // welcher gemeint ist.
    const mitGruppe = eintraege.filter((eintrag: Eintrag) => eintrag.gruppe !== null);

    expect(mitGruppe.length).toBeGreaterThan(0);
  });
});

describe('Die Palette lädt nichts vor', () => {
  const QUELLE = readFileSync(
    join(process.cwd(), 'apps/web/src/components/layout/command-palette.tsx'),
    'utf8',
  );

  it('fragt beim Öffnen keine Daten ab', () => {
    // Eine Schnellsuche, die beim Öffnen Mitglieder oder Tickets lädt, wäre
    // eine Abfrage bei jedem Tastendruck - und lüde Daten, die auf dieser
    // Seite niemand angefordert hat.
    expect(QUELLE).not.toContain('fetch(');
    expect(QUELLE).not.toContain('useEffect(() => {\n    void');
  });

  it('bringt keine eigene Berechtigungsprüfung mit', () => {
    // Sie bekommt die bereits gefilterte Liste. Eine zweite Prüfung wäre
    // eine zweite Wahrheit über dieselbe Frage.
    expect(QUELLE).not.toContain('hasPermission');
    expect(QUELLE).not.toContain('listPermissions');
    expect(QUELLE).not.toContain('admin.full');
  });

  it('führt die Mitgliedersuche auf die bestehende Adresse', () => {
    // Dieselbe Route wie das frühere Feld in der Kopfzeile - kein zweites
    // Suchsystem.
    expect(QUELLE).toContain('/members?q=');
  });

  it('bietet die Mitgliedersuche nur Berechtigten an', () => {
    expect(QUELLE).toContain('canSearchMembers && suche.trim()');
  });
});

describe('Mobile und Desktop teilen sich die Navigation', () => {
  it('rendert in beiden Fällen dieselbe Komponente', () => {
    for (const datei of [
      'apps/web/src/components/layout/sidebar.tsx',
      'apps/web/src/components/layout/mobile-nav.tsx',
    ]) {
      expect(readFileSync(join(process.cwd(), datei), 'utf8'), datei).toContain('<SidebarNav');
    }
  });

  it('gibt der mobilen Navigation grössere Ziele', () => {
    const mobil = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/mobile-nav.tsx'), 'utf8');
    const nav = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/sidebar-nav.tsx'), 'utf8');

    expect(mobil).toContain('touch');
    // 44px ist die kleinste Fläche, die ein Daumen sicher trifft.
    expect(nav).toContain('min-h-11');
  });

  it('merkt sich zugeklappte Abschnitte lokal, nicht in der Datenbank', () => {
    const nav = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/sidebar-nav.tsx'), 'utf8');

    expect(nav).toContain('localStorage');
    // Eine Anzeigevorliebe rechtfertigt keine Datenbankmigration.
    expect(nav).not.toContain('prisma');
  });

  it('hält den Abschnitt der aktuellen Seite offen', () => {
    const nav = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/sidebar-nav.tsx'), 'utf8');

    expect(nav).toContain('enthaeltAktiven');
    expect(nav).toContain('!zugeklappt.has(group.id) || enthaeltAktiven');
  });
});
