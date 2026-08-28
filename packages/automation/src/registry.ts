import type { z } from 'zod';
import type { DiscordGateway } from '@swisshub/discord';
import type { AutomationContext } from './context';

/**
 * Die drei Registries: Trigger, Bedingungen, Aktionen.
 *
 * Der Kern kennt kein Modul. Was eine Automation auslösen, prüfen und tun
 * kann, tragen die Module selbst ein - genau so, wie sie sich über
 * `registerModule()` schon heute selbst beschreiben. Ein neues Modul braucht
 * daher keine Änderung an dieser Datei und an keiner anderen im Kern.
 *
 * Das ist der Grund, weshalb hier nirgends ein `switch` über Modulnamen
 * steht: der wäre die eine Stelle, die bei jedem neuen Modul angefasst werden
 * müsste, und genau die soll es nicht geben.
 */

// --- Felder ----------------------------------------------------------------

/**
 * Ein Eingabefeld einer Trigger-, Bedingungs- oder Aktionskonfiguration.
 *
 * Dieselbe Formensprache wie bei den Moduleinstellungen (`SettingsField`) -
 * die Oberfläche kennt sie bereits, und eine zweite Feldsprache wäre eine
 * zweite Sprache zu pflegen.
 */
export interface AutomationField {
  key: string;
  label: string;
  description?: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'boolean'
    | 'select'
    | 'duration'
    | 'discord-role'
    | 'discord-channel'
    | 'discord-user'
    | 'time'
    | 'weekdays';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** Vorgabewert im Builder. */
  default?: string | number | boolean | string[];
  /** Darf hier `{{...}}` stehen? Nur bei Texten sinnvoll. */
  supportsTemplate?: boolean;
}

// --- Trigger ---------------------------------------------------------------

export interface TriggerDefinition {
  /** Kennung, z.B. `event`, `schedule`, `relative`, `manual`. */
  id: string;
  label: string;
  description: string;
  icon?: string;
  configSchema: z.ZodTypeAny;
  fields: AutomationField[];
  /**
   * Nächster Fälligkeitszeitpunkt, wenn es ein zeitgesteuerter Trigger ist.
   *
   * Gibt `null` zurück, wenn der Trigger nicht zeitgesteuert ist oder nichts
   * mehr ansteht. Der Zeitplaner fragt ausschliesslich hier - er kennt weder
   * Cron noch Wochentage, das ist Sache des Triggers.
   */
  nextRunAt?(config: unknown, von: Date): Date | null;
  /**
   * Passt dieses Ereignis zu dieser Trigger-Konfiguration?
   *
   * Nur bei ereignisgesteuerten Triggern. Der Verteiler ruft es für jede
   * infrage kommende Automation auf.
   */
  matches?(config: unknown, context: AutomationContext): boolean;
  /** Prüfungen vor dem Einschalten (§22). */
  validate?(config: unknown, umgebung: ValidationEnvironment): Promise<ValidationIssue[]>;
}

// --- Bedingungen -----------------------------------------------------------

export interface ConditionDefinition {
  id: string;
  label: string;
  description: string;
  /** Gruppierung im Builder: «Mitglied», «Zeit», «Ereignis» ... */
  group: string;
  configSchema: z.ZodTypeAny;
  fields: AutomationField[];
  /**
   * Die Prüfung selbst.
   *
   * Darf lesen, aber nichts verändern. Eine Bedingung, die etwas bewirkt,
   * wäre im Probelauf (§23) nicht mehr nebenwirkungsfrei - und der Probelauf
   * ist die einzige Möglichkeit, eine Automation gefahrlos anzusehen.
   */
  evaluate(config: unknown, context: AutomationContext): Promise<boolean>;
  validate?(config: unknown, umgebung: ValidationEnvironment): Promise<ValidationIssue[]>;
}

// --- Aktionen --------------------------------------------------------------

export interface ActionResult {
  /**
   * `NO_OP`, wenn die Wirkung bereits bestand (§14).
   *
   * Eine Rolle, die schon vergeben ist, ist kein Fehler - sie ist der
   * gewünschte Zustand. Ein Fehler daraus zu machen hiesse, dass jede
   * Wiederholung scheitert, obwohl alles stimmt.
   */
  status: 'SUCCESS' | 'NO_OP';
  /** Kurze, bereinigte Auskunft für den Verlauf. Niemals ein Geheimnis. */
  detail?: string;
  /**
   * Werte, die spätere Schritte verwenden dürfen.
   *
   * Landen unter `steps.<index>` im Kontext.
   */
  output?: Record<string, unknown>;
}

export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  group: string;
  icon?: string;
  configSchema: z.ZodTypeAny;
  fields: AutomationField[];
  /**
   * Berechtigung, die zusätzlich nötig ist, um diese Aktion zu verwenden.
   *
   * Nicht jede Aktion darf jeder anlegen, der Automationen anlegen darf. Wer
   * XP vergeben kann, greift in den Punktestand ein; das soll dieselbe
   * Berechtigung verlangen wie der Griff von Hand.
   */
  requiredPermission?: string;
  /**
   * Braucht diese Aktion eine menschliche Freigabe, ehe sie wirkt?
   *
   * Für alles, was sich nicht zurücknehmen lässt. Die Engine hält den Lauf
   * dann an und legt eine Freigabe an (§32).
   */
  requiresApproval?: boolean;
  /**
   * Ausführen. Im Probelauf wird sie **nicht** aufgerufen (§23).
   */
  execute(config: unknown, context: AutomationContext): Promise<ActionResult>;
  /**
   * Was im Probelauf angezeigt wird, statt zu handeln.
   *
   * Ohne diese Beschreibung stünde dort nur der Name der Aktion, und der
   * Probelauf beantwortete die eigentliche Frage nicht: *was genau* würde
   * geschehen.
   */
  preview?(config: unknown, context: AutomationContext): Promise<string>;
  validate?(config: unknown, umgebung: ValidationEnvironment): Promise<ValidationIssue[]>;
}

// --- Validierung -----------------------------------------------------------

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  /** Worauf sich das bezieht: `trigger`, `condition.2`, `step.0`. */
  path?: string;
}

/**
 * Was einer Prüfung zur Verfügung steht.
 *
 * Bewusst eingeschränkt: die Prüfung soll Rollen und Kanäle nachschlagen
 * können, aber nichts verändern.
 */
export interface ValidationEnvironment {
  guildId: string;
  gateway: DiscordGateway;
  rollenIds: ReadonlySet<string>;
  kanalIds: ReadonlySet<string>;
}

// --- Die Registries selbst --------------------------------------------------

const triggers = new Map<string, TriggerDefinition>();
const conditions = new Map<string, ConditionDefinition>();
const actions = new Map<string, ActionDefinition>();

export function registerTrigger(definition: TriggerDefinition): void {
  triggers.set(definition.id, definition);
}

export function registerCondition(definition: ConditionDefinition): void {
  conditions.set(definition.id, definition);
}

export function registerAction(definition: ActionDefinition): void {
  actions.set(definition.id, definition);
}

export const getTrigger = (id: string): TriggerDefinition | undefined => triggers.get(id);
export const getCondition = (id: string): ConditionDefinition | undefined => conditions.get(id);
export const getAction = (id: string): ActionDefinition | undefined => actions.get(id);

export const listTriggers = (): TriggerDefinition[] =>
  [...triggers.values()].sort((a, b) => a.label.localeCompare(b.label));
export const listConditions = (): ConditionDefinition[] =>
  [...conditions.values()].sort((a, b) => a.label.localeCompare(b.label));
export const listActions = (): ActionDefinition[] =>
  [...actions.values()].sort((a, b) => a.label.localeCompare(b.label));

/** Nur für Tests. */
export function clearRegistries(): void {
  triggers.clear();
  conditions.clear();
  actions.clear();
}
