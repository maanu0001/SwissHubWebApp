import { z } from 'zod';
import { createLogger } from '@swisshub/logger';
import type { AutomationContext } from './context';
import { getCondition } from './registry';

const logger = createLogger('automation:conditions');

/**
 * Der Bedingungsbaum.
 *
 * Eine Automation prüft nicht eine Bedingung, sondern eine Aussage - und die
 * kann verschachtelt sein:
 *
 *   Mitglied verifiziert
 *   UND ( Rolle = Premium ODER Level >= 20 )
 *   UND NICHT Rolle = Gesperrt
 *
 * Deshalb ein Baum aus Gruppen und Blättern statt einer Liste. Eine Liste
 * könnte nur «alles muss zutreffen», und die Klammer oben wäre nicht
 * ausdrückbar.
 *
 * **Auswertung ist immer lesend.** Eine Bedingung, die etwas bewirkt, würde
 * den Probelauf unbrauchbar machen: dort werden Bedingungen echt geprüft,
 * damit die Antwort stimmt, und nur die Aktionen bleiben aus.
 */

export const VERGLEICHS_OPERATOREN = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'exists',
  'notExists',
  'in',
  'notIn',
] as const;

export type Vergleichsoperator = (typeof VERGLEICHS_OPERATOREN)[number];

export const OPERATOR_LABEL: Record<Vergleichsoperator, string> = {
  eq: 'ist gleich',
  neq: 'ist nicht gleich',
  gt: 'ist grösser als',
  gte: 'ist grösser oder gleich',
  lt: 'ist kleiner als',
  lte: 'ist kleiner oder gleich',
  contains: 'enthält',
  notContains: 'enthält nicht',
  startsWith: 'beginnt mit',
  endsWith: 'endet mit',
  exists: 'ist vorhanden',
  notExists: 'ist nicht vorhanden',
  in: 'ist eines von',
  notIn: 'ist keines von',
};

/**
 * Ein einzelner Vergleich.
 *
 * Bewusst getrennt typisiert statt `any` zu vergleichen: `'10' > '9'` ist in
 * JavaScript falsch, und genau solche stillen Fehler soll eine Bedingung
 * nicht haben. Zahlen werden als Zahlen verglichen, Texte als Texte.
 */
export function vergleiche(
  links: unknown,
  operator: Vergleichsoperator,
  rechts: unknown,
): boolean {
  switch (operator) {
    case 'exists':
      return links !== undefined && links !== null && links !== '';
    case 'notExists':
      return links === undefined || links === null || links === '';
    case 'in':
    case 'notIn': {
      const liste = alsListe(rechts);
      const enthalten = liste.some((eintrag) => gleich(links, eintrag));
      return operator === 'in' ? enthalten : !enthalten;
    }
    case 'eq':
      return gleich(links, rechts);
    case 'neq':
      return !gleich(links, rechts);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = alsZahl(links);
      const b = alsZahl(rechts);
      if (a === null || b === null) {
        // Ein Grössenvergleich auf etwas, das keine Zahl ist, ist keine
        // Aussage. Er gilt als nicht erfüllt, statt zufällig zu entscheiden.
        return false;
      }
      if (operator === 'gt') return a > b;
      if (operator === 'gte') return a >= b;
      if (operator === 'lt') return a < b;
      return a <= b;
    }
    case 'contains':
    case 'notContains': {
      // Eine Liste enthält ein Element; ein Text enthält eine Zeichenkette.
      const enthalten = Array.isArray(links)
        ? links.some((eintrag) => gleich(eintrag, rechts))
        : String(links ?? '').includes(String(rechts ?? ''));
      return operator === 'contains' ? enthalten : !enthalten;
    }
    case 'startsWith':
      return String(links ?? '').startsWith(String(rechts ?? ''));
    case 'endsWith':
      return String(links ?? '').endsWith(String(rechts ?? ''));
    default: {
      // Erschöpfend: ein neuer Operator ohne Zweig fällt beim Typecheck auf.
      const niemals: never = operator;
      return Boolean(niemals);
    }
  }
}

function gleich(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  const zahlA = alsZahl(a);
  const zahlB = alsZahl(b);
  if (zahlA !== null && zahlB !== null) {
    return zahlA === zahlB;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return alsWahrheit(a) === alsWahrheit(b);
  }
  return String(a ?? '') === String(b ?? '');
}

function alsZahl(wert: unknown): number | null {
  if (typeof wert === 'number') {
    return Number.isFinite(wert) ? wert : null;
  }
  if (wert instanceof Date) {
    return wert.getTime();
  }
  if (typeof wert === 'string' && wert.trim() !== '') {
    const zahl = Number(wert);
    return Number.isFinite(zahl) ? zahl : null;
  }
  return null;
}

function alsWahrheit(wert: unknown): boolean {
  if (typeof wert === 'boolean') {
    return wert;
  }
  if (typeof wert === 'string') {
    return wert === 'true' || wert === '1' || wert === 'ja';
  }
  return Boolean(wert);
}

function alsListe(wert: unknown): unknown[] {
  if (Array.isArray(wert)) {
    return wert;
  }
  if (typeof wert === 'string') {
    return wert
      .split(',')
      .map((eintrag) => eintrag.trim())
      .filter((eintrag) => eintrag !== '');
  }
  return wert === undefined || wert === null ? [] : [wert];
}

// --- Der Baum ---------------------------------------------------------------

export type ConditionNode =
  | { art: 'gruppe'; verknuepfung: 'UND' | 'ODER'; negiert?: boolean; kinder: ConditionNode[] }
  | { art: 'bedingung'; typ: string; negiert?: boolean; config: Record<string, unknown> };

export const conditionNodeSchema: z.ZodType<ConditionNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.object({
      art: z.literal('gruppe'),
      verknuepfung: z.enum(['UND', 'ODER']),
      negiert: z.boolean().optional(),
      // Tiefe und Breite begrenzt: ein Baum mit tausend Blättern wäre bei
      // jedem Ereignis tausend Abfragen.
      kinder: z.array(conditionNodeSchema).max(20),
    }),
    z.object({
      art: z.literal('bedingung'),
      typ: z.string().min(1).max(64),
      negiert: z.boolean().optional(),
      config: z.record(z.unknown()),
    }),
  ]),
);

export interface AuswertungsSchritt {
  pfad: string;
  label: string;
  erfuellt: boolean;
  /** Gesetzt, wenn die Bedingung selbst gescheitert ist. */
  fehler?: string;
}

export interface AuswertungsErgebnis {
  erfuellt: boolean;
  schritte: AuswertungsSchritt[];
}

const MAX_TIEFE = 6;

/**
 * Den Baum auswerten und dabei mitschreiben.
 *
 * Der Mitschrieb ist der Grund, weshalb das hier nicht einfach `&&` ist: der
 * Probelauf soll zeigen, *welche* Bedingung nicht zutraf, nicht nur, dass
 * eine nicht zutraf.
 *
 * Deshalb wird auch **nicht** kurzgeschlossen: bei `UND` werden alle Zweige
 * geprüft, damit im Bericht jeder Zweig ein Ergebnis hat. Bedingungen sind
 * lesend und wenige - der Preis ist gering, der Gewinn an Verständlichkeit
 * gross.
 */
export async function werteBaumAus(
  knoten: ConditionNode | null | undefined,
  context: AutomationContext,
  pfad = 'bedingungen',
  tiefe = 0,
): Promise<AuswertungsErgebnis> {
  if (!knoten) {
    return { erfuellt: true, schritte: [] };
  }
  if (tiefe > MAX_TIEFE) {
    return {
      erfuellt: false,
      schritte: [{ pfad, label: 'Zu tief verschachtelt', erfuellt: false, fehler: 'Zu tief' }],
    };
  }

  if (knoten.art === 'gruppe') {
    const schritte: AuswertungsSchritt[] = [];
    const ergebnisse: boolean[] = [];
    for (const [index, kind] of knoten.kinder.entries()) {
      const teil = await werteBaumAus(kind, context, `${pfad}.${index}`, tiefe + 1);
      ergebnisse.push(teil.erfuellt);
      schritte.push(...teil.schritte);
    }
    // Eine leere Gruppe ist keine Einschränkung.
    const roh =
      ergebnisse.length === 0
        ? true
        : knoten.verknuepfung === 'UND'
          ? ergebnisse.every(Boolean)
          : ergebnisse.some(Boolean);
    return { erfuellt: knoten.negiert ? !roh : roh, schritte };
  }

  const definition = getCondition(knoten.typ);
  if (!definition) {
    // Eine Bedingung, die es nicht mehr gibt - etwa weil ein Modul
    // abgeschaltet wurde. Sie gilt als nicht erfüllt: die Automation soll im
    // Zweifel nicht handeln, statt ohne die Prüfung zu handeln.
    return {
      erfuellt: false,
      schritte: [
        {
          pfad,
          label: knoten.typ,
          erfuellt: false,
          fehler: `Bedingung «${knoten.typ}» ist nicht mehr verfügbar.`,
        },
      ],
    };
  }

  let roh = false;
  let fehler: string | undefined;
  try {
    const geprueft = definition.configSchema.safeParse(knoten.config);
    if (!geprueft.success) {
      fehler = 'Die Konfiguration dieser Bedingung ist ungültig.';
    } else {
      roh = await definition.evaluate(geprueft.data, context);
    }
  } catch (error) {
    // Eine gescheiterte Bedingung gilt als nicht erfüllt. Andersherum würde
    // ein Datenbankausfall dazu führen, dass Automationen handeln, obwohl
    // niemand geprüft hat, ob sie dürfen.
    logger.warn('Bedingung konnte nicht ausgewertet werden', { typ: knoten.typ, error });
    fehler = 'Die Bedingung konnte nicht geprüft werden.';
  }

  const erfuellt = knoten.negiert ? !roh : roh;
  return {
    erfuellt: fehler ? false : erfuellt,
    schritte: [
      {
        pfad,
        label: `${knoten.negiert ? 'NICHT ' : ''}${definition.label}`,
        erfuellt: fehler ? false : erfuellt,
        ...(fehler ? { fehler } : {}),
      },
    ],
  };
}

/** Alle Bedingungstypen, die in einem Baum vorkommen - für die Prüfung. */
export function sammleTypen(knoten: ConditionNode | null | undefined): string[] {
  if (!knoten) {
    return [];
  }
  if (knoten.art === 'bedingung') {
    return [knoten.typ];
  }
  return knoten.kinder.flatMap(sammleTypen);
}
