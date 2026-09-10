import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FILTER,
  gruppiere,
  passtZuFilter,
  passtZurSuche,
  zaehleFilter,
  type Eintrag,
  type FilterId,
  type Herkunft,
} from '../../apps/web/src/modules/configuration/components/berechtigungs-filter';

/**
 * Suchen und filtern in der Berechtigungsmatrix.
 *
 * Ein Filter, der etwas ausblendet, ist gefaehrlicher als er aussieht: was
 * man nicht sieht, haelt man leicht fuer nicht gesetzt. Deshalb steht hier
 * zuerst die Zusicherung, dass ueber die vier Filter zusammen jede
 * Berechtigung erreichbar bleibt - und dass «Alle» wirklich alle heisst,
 * auch die, die noch niemand hat.
 */

const HERKUENFTE: Herkunft[] = ['EXPLICIT_ALLOW', 'EXPLICIT_DENY', 'FULL_ACCESS', 'WILDCARD', 'NOT_GRANTED'];

function eintrag(key: string, extra: Partial<Eintrag> = {}): Eintrag {
  return {
    key,
    label: extra.label ?? key,
    description: extra.description ?? '',
    module: extra.module ?? key.split('.')[0]!,
  };
}

const BERECHTIGUNGEN: Eintrag[] = [
  eintrag('tickets.module.view', { label: 'Modul sehen', description: 'Tickets im Menü' }),
  eintrag('tickets.close', { label: 'Ticket schliessen', description: 'Schliesst ein Anliegen' }),
  eintrag('tickets.create', { label: 'Ticket erstellen', description: 'Neues Anliegen' }),
  eintrag('jail.create', { label: 'Jail erstellen', description: 'Sperrt ein Mitglied' }),
  eintrag('music.view', { label: 'Musik sehen', description: 'Player öffnen' }),
];

describe('Jede Berechtigung bleibt erreichbar', () => {
  it.each(HERKUENFTE)('zeigt eine Berechtigung mit Herkunft %s unter mindestens einem Filter', (herkunft) => {
    const treffer = FILTER.filter((eintragFilter) => passtZuFilter(herkunft, eintragFilter.id));
    expect(treffer.length).toBeGreaterThan(0);
  });

  it('zeigt jede Herkunft unter «Alle»', () => {
    // Ohne diesen Fall wäre eine noch nie erteilte Berechtigung über keinen
    // Filter zu finden - und damit nicht zu erteilen.
    for (const herkunft of HERKUENFTE) {
      expect(passtZuFilter(herkunft, 'alle'), herkunft).toBe(true);
    }
  });

  it('ordnet jede Herkunft genau einem Sachfilter zu', () => {
    // «Alle» zählt nicht mit: die drei Sachfilter sollen sich nicht
    // überlappen, sonst stünde dieselbe Zeile unter zwei Antworten.
    const sachfilter: FilterId[] = ['erlaubt', 'verweigert', 'geerbt'];
    for (const herkunft of HERKUENFTE) {
      const treffer = sachfilter.filter((id) => passtZuFilter(herkunft, id));
      expect(treffer.length, herkunft).toBeLessThanOrEqual(1);
    }
  });

  it('trennt ausdrücklich erteilt von geerbt', () => {
    // Nur das ausdrücklich Erteilte lässt sich zurücknehmen; das Geerbte
    // wird zur Ausnahme. Wer aufräumt, sucht das eine, wer versteht, das
    // andere.
    expect(passtZuFilter('EXPLICIT_ALLOW', 'erlaubt')).toBe(true);
    expect(passtZuFilter('FULL_ACCESS', 'erlaubt')).toBe(false);
    expect(passtZuFilter('WILDCARD', 'erlaubt')).toBe(false);
    expect(passtZuFilter('FULL_ACCESS', 'geerbt')).toBe(true);
    expect(passtZuFilter('WILDCARD', 'geerbt')).toBe(true);
  });

  it('lässt eine nie erteilte Berechtigung unter keinem Sachfilter erscheinen', () => {
    expect(passtZuFilter('NOT_GRANTED', 'erlaubt')).toBe(false);
    expect(passtZuFilter('NOT_GRANTED', 'verweigert')).toBe(false);
    expect(passtZuFilter('NOT_GRANTED', 'geerbt')).toBe(false);
  });
});

describe('Suche', () => {
  it('findet über die Beschriftung', () => {
    expect(passtZurSuche(BERECHTIGUNGEN[1]!, 'schliessen')).toBe(true);
  });

  it('findet über den Schlüssel', () => {
    // In einem Fehlerprotokoll steht `tickets.close`, nicht «Ticket
    // schliessen» - danach sucht man dann auch.
    expect(passtZurSuche(BERECHTIGUNGEN[1]!, 'tickets.close')).toBe(true);
  });

  it('findet über die Beschreibung', () => {
    expect(passtZurSuche(BERECHTIGUNGEN[3]!, 'sperrt')).toBe(true);
  });

  it('achtet nicht auf Gross- und Kleinschreibung', () => {
    expect(passtZurSuche(BERECHTIGUNGEN[1]!, 'TICKET')).toBe(true);
  });

  it('lässt bei leerer Suche alles durch', () => {
    for (const berechtigung of BERECHTIGUNGEN) {
      expect(passtZurSuche(berechtigung, '')).toBe(true);
      expect(passtZurSuche(berechtigung, '   ')).toBe(true);
    }
  });

  it('lässt nichts durch, was nicht passt', () => {
    expect(passtZurSuche(BERECHTIGUNGEN[4]!, 'kalender')).toBe(false);
  });
});

describe('Gruppierung', () => {
  const alleErlaubt = (): Herkunft => 'EXPLICIT_ALLOW';

  it('gruppiert nach Modul', () => {
    const gruppen = gruppiere(BERECHTIGUNGEN, '', 'alle', alleErlaubt);
    expect(gruppen.map(([modul]) => modul)).toEqual(['tickets', 'jail', 'music']);
  });

  it('verliert keine Berechtigung', () => {
    const gruppen = gruppiere(BERECHTIGUNGEN, '', 'alle', alleErlaubt);
    expect(
      gruppen
        .flatMap(([, liste]) => liste)
        .map((e) => e.key)
        .sort(),
    ).toEqual(BERECHTIGUNGEN.map((e) => e.key).sort());
  });

  it('stellt «Modul sehen» in seiner Gruppe zuoberst', () => {
    // Alphabetisch landete es in der Mitte - dabei nützt ohne diese
    // Berechtigung keine andere derselben Gruppe etwas.
    const [, tickets] = gruppiere(BERECHTIGUNGEN, '', 'alle', alleErlaubt)[0]!;
    expect(tickets[0]!.key).toBe('tickets.module.view');
  });

  it('lässt leer gewordene Gruppen weg', () => {
    // Eine Überschrift ohne Zeilen darunter ist eine Zeile mehr zu lesen und
    // keine Auskunft.
    const gruppen = gruppiere(BERECHTIGUNGEN, 'jail', 'alle', alleErlaubt);
    expect(gruppen.map(([modul]) => modul)).toEqual(['jail']);
  });

  it('wendet Suche und Filter gemeinsam an', () => {
    const herkunft = (e: Eintrag): Herkunft =>
      e.key === 'tickets.close' ? 'EXPLICIT_DENY' : 'EXPLICIT_ALLOW';
    const gruppen = gruppiere(BERECHTIGUNGEN, 'ticket', 'verweigert', herkunft);
    expect(gruppen.flatMap(([, liste]) => liste).map((e) => e.key)).toEqual(['tickets.close']);
  });

  it('gibt bei leerem Ergebnis eine leere Liste statt einer leeren Gruppe', () => {
    expect(gruppiere(BERECHTIGUNGEN, 'gibtesnicht', 'alle', alleErlaubt)).toEqual([]);
  });

  it('behält die Reihenfolge der Module über Tastendrücke hinweg', () => {
    // Sonst sortierte sich die Matrix bei jedem Buchstaben um.
    const ohne = gruppiere(BERECHTIGUNGEN, '', 'alle', alleErlaubt).map(([modul]) => modul);
    const mit = gruppiere(BERECHTIGUNGEN, 'e', 'alle', alleErlaubt).map(([modul]) => modul);
    expect(mit).toEqual(ohne.filter((modul) => mit.includes(modul)));
  });
});

describe('Zählung an den Filtern', () => {
  const herkunft = (e: Eintrag): Herkunft => {
    if (e.key === 'tickets.close') return 'EXPLICIT_DENY';
    if (e.key === 'jail.create') return 'FULL_ACCESS';
    if (e.key === 'music.view') return 'NOT_GRANTED';
    return 'EXPLICIT_ALLOW';
  };

  it('zählt jede Berechtigung unter «Alle»', () => {
    expect(zaehleFilter(BERECHTIGUNGEN, '', herkunft).alle).toBe(BERECHTIGUNGEN.length);
  });

  it('zählt die Sachfilter getrennt', () => {
    const zahlen = zaehleFilter(BERECHTIGUNGEN, '', herkunft);
    expect(zahlen.erlaubt).toBe(2);
    expect(zahlen.verweigert).toBe(1);
    expect(zahlen.geerbt).toBe(1);
  });

  it('summiert die Sachfilter auf höchstens «Alle»', () => {
    const zahlen = zaehleFilter(BERECHTIGUNGEN, '', herkunft);
    expect(zahlen.erlaubt + zahlen.verweigert + zahlen.geerbt).toBeLessThanOrEqual(zahlen.alle);
  });

  it('zählt die laufende Suche mit', () => {
    // Genau während des Suchens stellt sich die Frage «gibt es hier
    // Ausnahmen?» - eine Zahl über den ganzen Bestand hülfe da nicht.
    const zahlen = zaehleFilter(BERECHTIGUNGEN, 'jail', herkunft);
    expect(zahlen.alle).toBe(1);
    expect(zahlen.geerbt).toBe(1);
    expect(zahlen.erlaubt).toBe(0);
  });
});

describe('Die Matrix hält sich daran', () => {
  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/configuration/components/permission-matrix.tsx'),
    'utf8',
  );

  it('bewertet den Zustand weiterhin über die Engine', () => {
    // Eine zweite Regel im Browser liefe irgendwann auseinander - dann zeigte
    // die Oberfläche etwas anderes an, als beim Speichern gilt.
    expect(quelle).toContain('explainPermission(');
    expect(quelle).toContain("erklaerungen.get(permission.key)?.source ?? 'NOT_GRANTED'");
  });

  it('filtert nur die Darstellung, nicht den Entwurf', () => {
    // Die Vorschau zählt weiterhin über `permissions`, nicht über das
    // gefilterte Ergebnis: ein ausgeblendetes Recht bleibt gesetzt.
    expect(quelle).toContain('const effective = useMemo(');
    expect(quelle).not.toContain('grouped.flatMap');
  });

  it('klappt Module über denselben Mechanismus wie die Seitenleiste', () => {
    expect(quelle).toContain('useZugeklappt(SPEICHER_ZUGEKLAPPT)');
    expect(quelle).toContain("'swisshub:berechtigungen:zu'");
  });

  it('hält während einer Suche alle Module offen', () => {
    // Sonst suchte man etwas, fände es, und sähe trotzdem nur eine
    // zugeklappte Überschrift.
    expect(quelle).toContain('const offen = sucht || !zugeklappt.has(module)');
  });

  it('lässt jeden Klick weiterhin durch dieselbe Umschaltung laufen', () => {
    expect(quelle).toContain('onClick={() => toggle(permission.key)}');
  });
});

describe('Die Seitenleiste teilt sich den Mechanismus', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/sidebar-nav.tsx'), 'utf8');

  it('hält keine zweite Fassung des Zuklappens vor', () => {
    expect(quelle).toContain("import { useZugeklappt } from '@/lib/use-zugeklappt'");
    expect(quelle).not.toContain('function useZugeklappt');
  });

  it('behält ihren eigenen Speicherort', () => {
    expect(quelle).toContain("'swisshub:sidebar:zu'");
  });
});
