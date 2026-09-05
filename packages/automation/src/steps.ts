import { z } from 'zod';
import { conditionNodeSchema } from './conditions';
import { LIMITS } from './contract';

/**
 * Die Schrittfolge einer Automation.
 *
 * Drei Arten, mehr nicht - und das ist eine Entscheidung, keine
 * Unvollständigkeit (§53). SwissHub braucht zuerst eine Engine, die man
 * versteht und der man traut; ein vollständiger Graph-Editor käme mit
 * Zyklen, unerreichbaren Zweigen und Zusammenführungen, die jede
 * Fehlersuche zur Archäologie machen.
 *
 * - `aktion`  tut etwas über die Action-Registry
 * - `warten`  hält den Lauf persistent an
 * - `wenn`    verzweigt in zwei Schrittfolgen
 *
 * Verzweigungen tragen ihre Zweige in sich, statt auf Stellungen zu zeigen.
 * Damit ist die Folge ein Baum und kann keinen Zyklus enthalten - eine
 * Schleife innerhalb einer Automation ist so gar nicht erst formulierbar.
 */

/** Was geschieht, wenn ein Schritt endgültig scheitert? */
export const FEHLERVERHALTEN = ['ABBRECHEN', 'WEITER'] as const;
export type Fehlerverhalten = (typeof FEHLERVERHALTEN)[number];

const basis = {
  /** Beschriftung im Builder und im Verlauf. Frei wählbar. */
  label: z.string().trim().max(80).optional(),
};

const retrySchema = z
  .object({
    /** Wie oft wiederholt wird, ehe der Schritt als gescheitert gilt. */
    versuche: z.number().int().min(1).max(LIMITS.maxAttempts).default(1),
    /** Erste Wartezeit; sie verdoppelt sich je Versuch. */
    basisSekunden: z.number().int().min(1).max(3600).default(30),
  })
  .default({ versuche: 1, basisSekunden: 30 });

export type StepNode =
  | {
      art: 'aktion';
      label?: string;
      typ: string;
      config: Record<string, unknown>;
      beiFehler?: Fehlerverhalten;
      retry?: { versuche: number; basisSekunden: number };
    }
  | { art: 'warten'; label?: string; sekunden: number }
  | {
      art: 'wenn';
      label?: string;
      bedingung: z.infer<typeof conditionNodeSchema>;
      dann: StepNode[];
      sonst: StepNode[];
    };

export const stepNodeSchema: z.ZodType<StepNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.object({
      art: z.literal('aktion'),
      ...basis,
      typ: z.string().min(1).max(64),
      config: z.record(z.unknown()),
      beiFehler: z.enum(FEHLERVERHALTEN).default('ABBRECHEN'),
      retry: retrySchema,
    }),
    z.object({
      art: z.literal('warten'),
      ...basis,
      sekunden: z.number().int().min(1).max(LIMITS.maxWaitSeconds),
    }),
    z.object({
      art: z.literal('wenn'),
      ...basis,
      bedingung: conditionNodeSchema,
      dann: z.array(stepNodeSchema).max(10),
      sonst: z.array(stepNodeSchema).max(10),
    }),
  ]),
);

export const stepsSchema = z.array(stepNodeSchema).max(LIMITS.maxSteps);

/**
 * Die Folge flach machen.
 *
 * Der Ausführer arbeitet eine flache Liste ab und merkt sich seine Stellung
 * darin. Das ist der Grund, weshalb ein Lauf nach Tagen Wartezeit oder nach
 * einem Neustart genau dort weitermacht, wo er stand: die Stellung ist eine
 * Zahl in der Datenbank und kein Zustand im Arbeitsspeicher.
 *
 * Eine Verzweigung wird dabei zu einem eigenen Schritt, der zur Laufzeit
 * entscheidet, welcher Zweig als Nächstes ansteht - deshalb bekommt sie
 * beide Zweige mitsamt ihrer flachen Stellungen.
 */
export interface FlacherSchritt {
  index: number;
  knoten: StepNode;
  /** Nur bei `wenn`: die Stellungen der beiden Zweige. */
  dann?: number[];
  sonst?: number[];
  /** Wohin es nach diesem Schritt weitergeht. `null` = Ende. */
  weiter: number | null;
}

/**
 * Aus dem Baum eine flache Liste mit Sprungzielen machen.
 *
 * Nach einem Zweig geht es dort weiter, wo die Verzweigung aufgehört hat -
 * nicht am Ende der Automation. Ohne dieses Sprungziel würde ein
 * Dann-Zweig den Rest der Automation verschlucken.
 */
export function flache(knoten: StepNode[]): FlacherSchritt[] {
  const liste: FlacherSchritt[] = [];

  const gehe = (folge: StepNode[], danach: number | null): number | null => {
    // Rückwärts, damit jeder Schritt sein Sprungziel schon kennt.
    let naechster = danach;
    for (let i = folge.length - 1; i >= 0; i -= 1) {
      const eintrag = folge[i]!;
      const index = liste.length;
      const schritt: FlacherSchritt = { index, knoten: eintrag, weiter: naechster };
      liste.push(schritt);

      if (eintrag.art === 'wenn') {
        schritt.dann = zweig(eintrag.dann, naechster);
        schritt.sonst = zweig(eintrag.sonst, naechster);
      }
      naechster = index;
    }
    return naechster;
  };

  const zweig = (folge: StepNode[], danach: number | null): number[] => {
    const vorher = liste.length;
    const einstieg = gehe(folge, danach);
    void vorher;
    return einstieg === null ? [] : [einstieg];
  };

  gehe(knoten, null);

  // `gehe` fügt rückwärts an; für Anzeige und Verlauf soll die Reihenfolge
  // der Stellungen der Ausführungsreihenfolge folgen.
  const nachIndex = new Map(liste.map((eintrag) => [eintrag.index, eintrag]));
  return [...nachIndex.values()].sort((a, b) => a.index - b.index);
}

/** Der erste Schritt einer Folge, in der flachen Liste. */
export function einstieg(flach: FlacherSchritt[], knoten: StepNode[]): number | null {
  if (knoten.length === 0) {
    return null;
  }
  const gesucht = knoten[0]!;
  return flach.find((eintrag) => eintrag.knoten === gesucht)?.index ?? null;
}

/** Alle Aktionstypen, die in einer Folge vorkommen - für die Prüfung. */
export function sammleAktionen(knoten: StepNode[]): string[] {
  const treffer: string[] = [];
  for (const eintrag of knoten) {
    if (eintrag.art === 'aktion') {
      treffer.push(eintrag.typ);
    } else if (eintrag.art === 'wenn') {
      treffer.push(...sammleAktionen(eintrag.dann), ...sammleAktionen(eintrag.sonst));
    }
  }
  return treffer;
}

/** Wie viele Schritte eine Folge insgesamt hat, Zweige eingerechnet. */
export function zaehleSchritte(knoten: StepNode[]): number {
  return knoten.reduce(
    (summe, eintrag) =>
      summe + 1 + (eintrag.art === 'wenn' ? zaehleSchritte(eintrag.dann) + zaehleSchritte(eintrag.sonst) : 0),
    0,
  );
}
