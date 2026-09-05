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
 * Zahlen in der Seitenleiste - und wo keine hingehören.
 *
 * Am Jail-Eintrag stand die Anzahl aktiver Jails. Sie beantwortete keine
 * Frage, die man vor dem Klick hat, und liess die Navigation bei jedem
 * Seitenaufruf wackeln. Sie ist weg und soll nicht zurückkommen.
 *
 * Beim Ticket-Eintrag ist es umgekehrt: «wartet dort Arbeit auf mich?» ist
 * genau die Frage, die man vor dem Klick hat. Dort steht deshalb eine Zahl.
 *
 * Der Unterschied ist der Punkt dieser Datei. Sie hält beides fest: dass der
 * Mechanismus existiert und die Tickets ihn nutzen - und dass Jail und Vote
 * Jail ihn nicht wiederbekommen.
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

describe('Nur die Tickets tragen eine Zahl', () => {
  it('lässt kein anderes Modul einen Zähler setzen', () => {
    for (const modul of listModuleDefinitions()) {
      for (const eintrag of modul.navigation) {
        if (eintrag.counter !== undefined) {
          // Genau ein Zähler im ganzen System, und er hat einen Namen.
          expect(`${modul.id}:${eintrag.counter}`).toBe('tickets:openTickets');
          continue;
        }
        for (const feld of ZAEHLER_FELDER) {
          expect(eintrag, `${modul.id} → ${eintrag.href} trägt «${feld}»`).not.toHaveProperty(feld);
        }
      }
    }
  });

  it('holt im Layout keine Jail-Statistik mehr', () => {
    // Die zweite Station: das Layout holte die Jail-Statistik und reichte sie
    // als `count` weiter. Die Ticket-Zahl steht jetzt dort - die Jail-Zahl
    // nicht mehr.
    const layout = quelle('apps/web/src/app/(app)/layout.tsx');
    expect(layout).not.toContain('activeJails');
    expect(layout).not.toContain('getJailStats');
    expect(layout).toContain('openTickets');
  });

  it('stellt keine Null und keine versteckte Hülle dar', () => {
    // Kein CSS-Trick: bei null gibt es schlicht kein Element.
    const nav = quelle('apps/web/src/components/layout/sidebar-nav.tsx');
    expect(nav).toContain('entry.count > 0');
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
