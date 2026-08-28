import { z } from 'zod';

/**
 * Der Ereignisvertrag der Automation Engine.
 *
 * Ein Ereignis ist die kleinste Einheit, über die Module miteinander reden.
 * Damit das langfristig trägt, sind drei Dinge festgeschrieben:
 *
 * 1. **Der Name ist stabil und versioniert.** `verification.completed` heisst
 *    heute und in zwei Jahren dasselbe. Ändert sich die Bedeutung der
 *    Nutzdaten, steigt `schemaVersion` - der alte Name wird nicht
 *    umgedeutet. Eine Automation, die auf einen Namen zeigt, soll nicht
 *    stillschweigend etwas anderes tun als beim Anlegen.
 * 2. **Die Nutzdaten sind schemageprüft.** Wer ein Ereignis veröffentlicht,
 *    gibt ein Zod-Schema mit; was nicht dagegen passt, wird abgewiesen statt
 *    weitergereicht. Eine Bedingung, die auf `payload.level` prüft, soll sich
 *    darauf verlassen können, dass dort eine Zahl steht.
 * 3. **Die Herkunft wird mitgeführt.** `correlationId`, `causationId` und
 *    `depth` klammern eine ganze Ursachenkette. Ohne sie liesse sich nicht
 *    erkennen, dass Automation A Automation B auslöst, die wieder A auslöst -
 *    und genau das ist die Schleife, die es zu verhindern gilt.
 *
 * Der Kern kennt **kein** Modul. Welche Ereignisse es gibt, sagen die Module
 * selbst, indem sie sie registrieren.
 */

/** Ein Ereignisname: `<modul>.<sache>[.<sache>]`, klein, mit Punkten. */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,3}$/u;

export const eventTypeSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(EVENT_TYPE_PATTERN, 'muss die Form modul.sache haben, z.B. verification.completed');

/**
 * Beschreibung eines Ereignisses für Registry und Oberfläche.
 *
 * `payloadSchema` ist die Wahrheit über die Nutzdaten - daraus entstehen die
 * Prüfung beim Veröffentlichen und die Variablenliste im Builder.
 */
export interface EventDefinition<TPayload = unknown> {
  type: string;
  /** Was im Builder steht: «Mitglied wurde verifiziert». */
  label: string;
  description: string;
  /** Modul, das es veröffentlicht. Für Gruppierung und Abschaltung. */
  module: string;
  schemaVersion?: number;
  payloadSchema: z.ZodType<TPayload>;
  /**
   * Welche Variablen aus diesem Ereignis im Builder angeboten werden.
   *
   * Bewusst eine ausdrückliche Liste und keine Ableitung aus dem Schema: was
   * hier steht, ist die zugesagte Oberfläche. Ein Feld, das nur zufällig in
   * den Nutzdaten liegt, soll nicht zur Vertragsfläche werden.
   */
  variables?: EventVariable[];
  /** Beispieldaten für den Probelauf. */
  sample?: TPayload;
}

export interface EventVariable {
  /** Pfad im Kontext, z.B. `payload.member.displayName`. */
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  example?: string;
}

/** Die Kopfdaten, die jedes Ereignis trägt. */
export interface EventEnvelope<TPayload = unknown> {
  eventId: string;
  type: string;
  schemaVersion: number;
  guildId: string;
  sourceModule: string;
  actorId: string | null;
  subjectId: string | null;
  entityId: string | null;
  correlationId: string;
  causationId: string | null;
  depth: number;
  payload: TPayload;
  occurredAt: Date;
}

/** Was eine Aufrufstelle beim Veröffentlichen angibt. */
export interface PublishInput<TPayload = unknown> {
  type: string;
  guildId: string;
  payload: TPayload;
  /** Wer es ausgelöst hat - ein Mensch, ein Bot oder `system`. */
  actorId?: string | null;
  /** Auf wen es sich bezieht (meist eine Discord-Kennung). */
  subjectId?: string | null;
  /** Der betroffene Datensatz (Ticket, Turnier, Event ...). */
  entityId?: string | null;
  occurredAt?: Date;
  /**
   * Herkunft, wenn dieses Ereignis aus einem anderen hervorgeht.
   *
   * Wird von einer Aktion gesetzt, die selbst ein Ereignis auslöst. Ohne sie
   * begänne jede Kette bei Tiefe 0, und eine Schleife wäre nicht erkennbar.
   */
  causation?: { correlationId: string; causationId: string; depth: number } | null;
}

// --- Registry ---------------------------------------------------------------

const events = new Map<string, EventDefinition>();

/**
 * Ein Ereignis anmelden.
 *
 * Idempotent, weil Module über Seiteneffekt-Importe geladen werden und eine
 * Datei in Tests mehrfach geladen werden kann. Ein zweiter Aufruf mit
 * demselben Namen überschreibt - so gewinnt die zuletzt geladene Definition
 * statt zu scheitern.
 */
export function registerEvent<TPayload>(definition: EventDefinition<TPayload>): void {
  const geprueft = eventTypeSchema.safeParse(definition.type);
  if (!geprueft.success) {
    throw new Error(
      `Ereignisname «${definition.type}» ist ungültig: ${geprueft.error.issues[0]?.message ?? 'unbekannt'}`,
    );
  }
  events.set(definition.type, definition as EventDefinition);
}

export function getEventDefinition(type: string): EventDefinition | undefined {
  return events.get(type);
}

export function listEventDefinitions(): EventDefinition[] {
  return [...events.values()].sort((a, b) => a.type.localeCompare(b.type));
}

/** Nur für Tests. */
export function clearEventDefinitions(): void {
  events.clear();
}

// --- Grenzen ----------------------------------------------------------------

/**
 * Harte Obergrenzen des Kerns.
 *
 * Sie stehen hier und nicht in den Einstellungen, weil sie keine Vorlieben
 * sind, sondern Schutzmauern. Eine Automation, die sie erreicht, hat einen
 * Fehler - keine besonders anspruchsvolle Aufgabe.
 */
export const LIMITS = {
  /** Wie tief eine Ursachenkette werden darf, ehe sie als Schleife gilt. */
  maxDepth: 5,
  /** Wie viele Schritte eine einzelne Automation haben darf. */
  maxSteps: 25,
  /** Wie viele Ereignisse ein einzelner Lauf auslösen darf. */
  maxEmittedEvents: 5,
  /** Wie viele Läufe je Ereignisverteilung höchstens entstehen. */
  maxRunsPerDispatch: 50,
  /** Grösse der Nutzdaten eines Ereignisses in Zeichen (JSON). */
  maxPayloadChars: 8_000,
  /** Längster Wait-Schritt. Ein Jahr ist mehr, als je gebraucht wird. */
  maxWaitSeconds: 365 * 24 * 3600,
  /** Wie viele Versuche ein Schritt höchstens bekommt. */
  maxAttempts: 5,
  /** Länge eines aufgelösten Textes, ehe er gekürzt wird. */
  maxRenderedChars: 4_000,
} as const;
