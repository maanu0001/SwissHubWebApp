import { getAction, getCondition, getTrigger } from './registry';
import type { ConditionNode } from './conditions';
import type { StepNode } from './steps';

/**
 * Vorlagen (§11).
 *
 * Eine leere Automation ist eine leere Seite, und eine leere Seite ist der
 * Grund, weshalb ein gutes Werkzeug ungenutzt bleibt. Eine Vorlage ist ein
 * fertiger Entwurf, den jemand ansieht, anpasst und einschaltet - und dabei
 * nebenbei lernt, wie die Engine denkt.
 *
 * Eine Vorlage ist **kein** Sonderfall im Ausführer: sie erzeugt eine
 * gewöhnliche Automation, die anschliessend genauso geprüft, versioniert und
 * ausgeführt wird wie jede andere. Sonst gäbe es zwei Arten von Automationen,
 * und die zweite wäre die, die niemand versteht.
 *
 * Vorlagen werden - wie Trigger, Bedingungen und Aktionen - **angemeldet**.
 * Der Kern führt keine Liste; die Module bringen ihre eigenen mit.
 */

export interface AutomationVorlage {
  id: string;
  name: string;
  description: string;
  /** Gruppierung in der Auswahl: «Willkommen», «Moderation», «Turniere» … */
  gruppe: string;
  icon?: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions?: ConditionNode | null;
  steps: StepNode[];
  /**
   * Was noch ausgefüllt werden muss, ehe die Vorlage brauchbar ist.
   *
   * Eine Vorlage kann keine Kanal-ID mitbringen - die kennt nur der Server.
   * Diese Liste sagt der Oberfläche, worauf sie hinweisen soll.
   */
  auszufuellen?: Array<{ pfad: string; label: string }>;
}

const vorlagen = new Map<string, AutomationVorlage>();

export function registerTemplate(vorlage: AutomationVorlage): void {
  vorlagen.set(vorlage.id, vorlage);
}

export function getTemplate(id: string): AutomationVorlage | undefined {
  return vorlagen.get(id);
}

/**
 * Alle Vorlagen, deren Bausteine es tatsächlich gibt.
 *
 * Ist ein Modul abgeschaltet, sind seine Aktionen nicht angemeldet - und eine
 * Vorlage, die sie braucht, liesse sich nicht einschalten. Sie erst gar nicht
 * anzubieten ist ehrlicher, als sie anzubieten und beim Speichern zu
 * scheitern.
 */
export function listTemplates(): AutomationVorlage[] {
  return [...vorlagen.values()]
    .filter((vorlage) => vorlageVollstaendig(vorlage))
    .sort((a, b) => a.gruppe.localeCompare(b.gruppe) || a.name.localeCompare(b.name));
}

export function vorlageVollstaendig(vorlage: AutomationVorlage): boolean {
  if (!getTrigger(vorlage.triggerType)) {
    return false;
  }
  return schritteVerfuegbar(vorlage.steps) && bedingungenVerfuegbar(vorlage.conditions ?? null);
}

function schritteVerfuegbar(schritte: StepNode[]): boolean {
  return schritte.every((schritt) => {
    if (schritt.art === 'aktion') {
      return Boolean(getAction(schritt.typ));
    }
    if (schritt.art === 'wenn') {
      return (
        bedingungenVerfuegbar(schritt.bedingung) &&
        schritteVerfuegbar(schritt.dann) &&
        schritteVerfuegbar(schritt.sonst)
      );
    }
    return true;
  });
}

function bedingungenVerfuegbar(knoten: ConditionNode | null): boolean {
  if (!knoten) {
    return true;
  }
  return knoten.art === 'gruppe'
    ? knoten.kinder.every(bedingungenVerfuegbar)
    : Boolean(getCondition(knoten.typ));
}

/** Nur für Tests. */
export function clearTemplates(): void {
  vorlagen.clear();
}
