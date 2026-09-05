import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNavigation,
  groupNavigation,
  listModuleDefinitions,
  moduleViewPermission,
} from '@swisshub/modules';

/**
 * Keine Zahlen in der Seitenleiste.
 *
 * Am Jail-Eintrag stand die Anzahl aktiver Jails - eine Zahl, die dort
 * niemandem half: sie beantwortete keine Frage, die man vor dem Klick hat,
 * und sie liess die Navigation bei jedem Seitenaufruf wackeln. Sie ist weg,
 * und diese Datei hält fest, dass sie nicht zurückkommt.
 *
 * Sie prüft auf drei Ebenen, weil die Zahl über drei Stationen lief und an
 * jeder einzelnen wieder entstehen könnte: die Registry beschrieb den Zähler,
 * das Layout füllte ihn, die Komponente stellte ihn dar. Ein Test nur auf der
 * letzten hätte übersehen, dass die Registry ihn weiterhin anbietet.
 *
 * Ausdrücklich *nicht* geprüft wird die Zahl selbst - `getJailStats()` gibt
 * es weiterhin, und das Jail-Modul zeigt sie dort, wo sie hingehört.
 */

const WURZEL = process.cwd();
const quelle = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));

/** Feldnamen, unter denen eine Zahl in einen Eintrag zurückfinden könnte. */
const ZAEHLER_FELDER = [
  'count',
  'counter',
  'notificationCount',
  'activeCount',
  'activeJailCount',
  'totalJailCount',
  'jailCount',
  'voteJailCount',
  'totalCount',
  'badgeCount',
  'badgeLabel',
];

const JAIL_SEHEN = moduleViewPermission('jail');
const P = {
  view: 'jail.view',
  voteStart: 'jail.vote.start',
  import: 'jail.import',
};

/** Der Eintrag, den diese Berechtigungen in der Seitenleiste erzeugen. */
function eintraege(permissions: string[]) {
  return groupNavigation(buildNavigation(permissions, ALLE_MODULE)).flatMap(
    (gruppe) => gruppe.items,
  );
}

describe('Jail in der Seitenleiste', () => {
  const jail = eintraege([JAIL_SEHEN, P.view]).filter((eintrag) => eintrag.moduleId === 'jail');

  it('wird gerendert', () => {
    expect(jail).toHaveLength(1);
    expect(jail[0]?.label).toBe('Jail');
    expect(jail[0]?.href).toBe('/jail');
  });

  it('trägt Icon, Label und Ziel - und sonst keine Zahl', () => {
    const eintrag = jail[0]!;
    expect(eintrag.icon).toBeTruthy();

    for (const feld of ZAEHLER_FELDER) {
      expect(eintrag, `«${feld}» ist wieder am Jail-Eintrag`).not.toHaveProperty(feld);
    }
  });

  it('trägt auch keine Badge', () => {
    // Die Badge-Möglichkeit bleibt bestehen - der Jail-Eintrag nutzt sie nur
    // nicht. Ein `undefined` hier wäre schon zu viel: die Komponente würde
    // dann eine leere Hülle rendern.
    expect(jail[0]?.badge).toBeUndefined();
  });
});

describe('Vote Jail in der Seitenleiste', () => {
  // Wer nur abstimmen lassen darf, bekommt statt «Jail» den Eintrag, der zu
  // seinem Recht passt - dieselbe Registry-Zeile, anderes Ziel.
  const vote = eintraege([JAIL_SEHEN, P.voteStart]).filter(
    (eintrag) => eintrag.moduleId === 'jail',
  );

  it('wird gerendert', () => {
    expect(vote).toHaveLength(1);
    expect(vote[0]?.label).toBe('Vote Jail');
    expect(vote[0]?.href).toBe('/jail/votes');
  });

  it('trägt keine Zahl und keine Badge', () => {
    const eintrag = vote[0]!;
    for (const feld of ZAEHLER_FELDER) {
      expect(eintrag, `«${feld}» ist wieder am Vote-Jail-Eintrag`).not.toHaveProperty(feld);
    }
    expect(eintrag.badge).toBeUndefined();
  });

  it('gilt auch für den Import-Eintrag', () => {
    const importEintrag = eintraege([JAIL_SEHEN, P.import]).filter(
      (eintrag) => eintrag.moduleId === 'jail',
    )[0];
    expect(importEintrag?.href).toBe('/jail/import');
    expect(importEintrag?.badge).toBeUndefined();
    expect(importEintrag).not.toHaveProperty('count');
  });
});

describe('Kein Modul trägt eine Zahl in die Seitenleiste', () => {
  it('beschreibt in der Registry keinen Zähler mehr', () => {
    // Der Ursprung: die Registry kannte ein Feld `counter`, das Jail als
    // einziges Modul setzte. Ohne das Feld kann es niemand mehr setzen.
    for (const modul of listModuleDefinitions()) {
      for (const eintrag of modul.navigation) {
        for (const feld of ZAEHLER_FELDER) {
          expect(eintrag, `${modul.id} → ${eintrag.href} trägt «${feld}»`).not.toHaveProperty(feld);
        }
      }
    }
  });

  it('füllt im Layout keine Zahl mehr ab', () => {
    // Die zweite Station: das Layout holte die Jail-Statistik und reichte sie
    // als `count` an die Seitenleiste weiter.
    const layout = quelle('apps/web/src/app/(app)/layout.tsx');
    expect(layout).not.toMatch(/count:/u);
    expect(layout).not.toContain('activeJails');
    expect(layout).not.toContain('getJailStats');
  });

  it('stellt in der Komponente keine Zahl mehr dar', () => {
    // Die dritte Station. Kein CSS-Trick: es gibt schlicht keinen Zweig mehr,
    // der eine Zahl ausgäbe.
    const nav = quelle('apps/web/src/components/layout/sidebar-nav.tsx');
    expect(nav).not.toContain('entry.count');
    expect(nav).not.toMatch(/count\?:/u);
    expect(nav).not.toMatch(/display:\s*none|opacity-0|invisible/u);
  });
});

describe('Was bleiben soll, bleibt', () => {
  it('kann weiterhin statische Badges anzeigen', () => {
    // Andere Module dürfen «NEU» an einen Eintrag hängen - die Möglichkeit
    // wurde nicht mit abgeräumt, nur ihr einziger zahlenmässiger Missbrauch.
    const nav = quelle('apps/web/src/components/layout/sidebar-nav.tsx');
    expect(nav).toContain('entry.badge');

    const [gruppe] = groupNavigation([
      {
        href: '/beispiel',
        label: 'Beispiel',
        permission: 'x',
        icon: 'Star',
        group: 'modules',
        order: 1,
        badge: 'NEU',
        moduleId: 'beispiel',
      },
    ]);
    expect(gruppe?.items[0]?.badge).toBe('NEU');
  });

  it('liefert die Jail-Zahlen weiterhin - nur nicht an die Seitenleiste', async () => {
    // Die Daten sind unangetastet: der Dienst existiert und wird im Modul
    // weiterhin verwendet.
    const { jail } = await import('@swisshub/modules');
    expect(typeof jail.getJailStats).toBe('function');

    const jailSeite = quelle('apps/web/src/app/(app)/jail/page.tsx');
    expect(jailSeite.length).toBeGreaterThan(0);
  });

  it('lässt Jail und Vote Jail weiterhin erreichbar', () => {
    // Die Berechtigungslogik ist unverändert: dieselben Rechte, dieselben
    // Ziele - nur ohne Zahl daneben.
    expect(eintraege([JAIL_SEHEN, P.view])[0]?.href).toBeTruthy();
    expect(eintraege([JAIL_SEHEN, P.voteStart]).some((e) => e.href === '/jail/votes')).toBe(true);
    // Und ohne «Modul sehen» weiterhin gar nichts.
    expect(eintraege([P.view, P.voteStart]).filter((e) => e.moduleId === 'jail')).toEqual([]);
  });
});
