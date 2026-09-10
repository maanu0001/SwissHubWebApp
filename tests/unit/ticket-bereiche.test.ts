import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  istEinrichtung,
  teileBereiche,
  type TicketSection,
} from '../../apps/web/src/modules/tickets/components/bereiche';

/**
 * Arbeit und Einrichtung im Ticket-Modul.
 *
 * Ein Mitglied der Verwaltung sah zwölf gleichwertige Reiter: «Offene
 * Tickets» so gross wie «Panels». Die Trennung schiebt die Einrichtung an
 * einen zweiten Platz in derselben Zeile - und darf dabei keinen Bereich
 * verlieren. Genau das steht hier zuerst.
 */

/** Die Kopfzeile, wie ein Mitglied der Verwaltung sie sieht. */
const ALLE: TicketSection[] = [
  { href: '/tickets', label: 'Übersicht' },
  { href: '/tickets/offen', label: 'Offene Tickets' },
  { href: '/tickets/meine', label: 'Meine Tickets' },
  { href: '/tickets/neu', label: 'Neues Ticket' },
  { href: '/tickets/archiv', label: 'Archiv' },
  { href: '/tickets/schlagwoerter', label: 'Schlagwörter' },
  { href: '/tickets/vorlagen', label: 'Vorlagen' },
  { href: '/tickets/kategorien', label: 'Kategorien' },
  { href: '/tickets/panels', label: 'Panels' },
  { href: '/tickets/sperren', label: 'Sperren' },
  { href: '/tickets/statistiken', label: 'Statistiken' },
  { href: '/modules/tickets', label: 'Einstellungen' },
];

describe('Kein Bereich geht verloren', () => {
  it('gibt jeden Bereich genau einmal zurück', () => {
    const { arbeit, einrichtung } = teileBereiche(ALLE);
    expect([...arbeit, ...einrichtung].map((s) => s.href).sort()).toEqual(ALLE.map((s) => s.href).sort());
  });

  it('legt keinen Bereich in beide Töpfe', () => {
    const { arbeit, einrichtung } = teileBereiche(ALLE);
    for (const section of arbeit) {
      expect(einrichtung).not.toContainEqual(section);
    }
  });

  it('erfindet keinen Bereich, den der Betrachter nicht hat', () => {
    // Ein gewöhnliches Mitglied sieht zwei Bereiche - und danach kein
    // Zahnrad, sondern gar keines.
    const mitglied: TicketSection[] = [
      { href: '/tickets', label: 'Meine Tickets' },
      { href: '/tickets/neu', label: 'Neues Ticket' },
    ];
    const { arbeit, einrichtung } = teileBereiche(mitglied);
    expect(arbeit).toEqual(mitglied);
    expect(einrichtung).toEqual([]);
  });

  it('kommt mit einer leeren Kopfzeile zurecht', () => {
    expect(teileBereiche([])).toEqual({ arbeit: [], einrichtung: [] });
  });
});

describe('Was hinter das Zahnrad gehört', () => {
  it('behält die tägliche Arbeit als Reiter', () => {
    expect(teileBereiche(ALLE).arbeit.map((s) => s.href)).toEqual([
      '/tickets',
      '/tickets/offen',
      '/tickets/meine',
      '/tickets/neu',
      '/tickets/archiv',
      '/tickets/statistiken',
    ]);
  });

  it('schiebt alles, was das Modul einstellt, hinter das Zahnrad', () => {
    expect(teileBereiche(ALLE).einrichtung.map((s) => s.href)).toEqual([
      '/tickets/schlagwoerter',
      '/tickets/vorlagen',
      '/tickets/kategorien',
      '/tickets/panels',
      '/tickets/sperren',
      '/modules/tickets',
    ]);
  });

  it('lässt die Statistiken vorne', () => {
    // Sie stellen nichts ein, sie berichten. Wer morgens nachsieht, wie das
    // Team dasteht, soll dafür kein Zahnrad öffnen müssen.
    expect(istEinrichtung('/tickets/statistiken')).toBe(false);
  });

  it('entscheidet nach Adresse, nicht nach Beschriftung', () => {
    // Sonst wechselte ein Bereich stillschweigend die Seite, sobald jemand
    // seinen Text ändert.
    expect(istEinrichtung('/tickets/panels')).toBe(true);
    expect(teileBereiche([{ href: '/tickets/panels', label: 'Offene Tickets' }]).einrichtung).toHaveLength(1);
  });

  it('behält in beiden Töpfen die Reihenfolge der Eingabe', () => {
    const gedreht = [...ALLE].reverse();
    const { arbeit } = teileBereiche(gedreht);
    expect(arbeit.map((s) => s.href)).toEqual(
      gedreht.filter((s) => !istEinrichtung(s.href)).map((s) => s.href),
    );
  });
});

describe('Die Kopfzeile hält sich daran', () => {
  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/tickets/components/section-nav.tsx'),
    'utf8',
  );

  it('teilt an einer Stelle', () => {
    expect(quelle).toContain('teileBereiche(sections)');
  });

  it('zeigt am Zahnrad, wenn man dahinter steht', () => {
    // Sonst stünde man auf einer Seite, die die Navigation nicht mehr
    // anzeigt - und wüsste nicht, wo man ist.
    expect(quelle).toContain('const inEinrichtung = einrichtung.some');
  });

  it('lässt das Zahnrad weg, wenn nichts dahinter liegt', () => {
    expect(quelle).toContain('einrichtung.length > 0');
  });

  it('behält für jeden Bereich einen echten Verweis', () => {
    // Ein Menüeintrag ohne `href` wäre eine Sackgasse; `asChild` sorgt
    // dafür, dass der Link der Eintrag ist und nicht in ihm steckt.
    expect(quelle).toContain('<DropdownMenuItem key={section.href} asChild>');
  });
});

describe('Die Bereiche kommen weiterhin aus den Berechtigungen', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/web/src/server/tickets.ts'), 'utf8');

  it('prüft jeden Bereich einzeln', () => {
    for (const permission of [
      'p.supportView',
      'p.create',
      'p.archiveView',
      'p.supportManageTags',
      'p.templatesManage',
      'p.categoriesManage',
      'p.panelsManage',
      'p.blockManage',
      'p.statsView',
      'p.settingsManage',
    ]) {
      expect(quelle, permission).toContain(permission);
    }
  });

  it('kennt die Aufteilung selbst nicht', () => {
    // Wer etwas sehen darf, entscheidet der Server; wo es steht, die
    // Kopfzeile. Zwei Fragen, zwei Orte.
    // Genannt werden darf die Aufteilung - im Kommentar steht, wo sie
    // stattfindet. Aufgerufen wird sie hier nicht.
    expect(quelle).not.toContain('teileBereiche(');
    expect(quelle).not.toContain('istEinrichtung(');
  });
});
