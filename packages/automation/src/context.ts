import type { DiscordGateway } from '@swisshub/discord';
import { LIMITS } from './contract';

/**
 * Der Kontext eines Laufs.
 *
 * Alles, was Bedingungen und Aktionen zu sehen bekommen. Was hier nicht
 * steht, ist ihnen nicht zugänglich - das ist Absicht: eine Aktion soll ein
 * Discord-Ereignis auswerten können, aber nicht die Umgebungsvariablen des
 * Prozesses lesen und keine beliebige Tabelle abfragen (§44).
 */
export interface AutomationContext {
  runId: string;
  automationId: string;
  guildId: string;
  correlationId: string;
  depth: number;
  /** Probelauf: Aktionen beschreiben sich, statt zu wirken. */
  dryRun: boolean;
  /** Der Discord-Zugang. Im Probelauf lesend verwendet, nie schreibend. */
  gateway: DiscordGateway;
  event: {
    id: string | null;
    type: string | null;
    actorId: string | null;
    subjectId: string | null;
    entityId: string | null;
    occurredAt: Date;
  };
  /** Die Nutzdaten des Ereignisses - schemageprüft veröffentlicht. */
  payload: Record<string, unknown>;
  /** Ergebnisse vorangegangener Schritte, unter ihrer Stellung. */
  steps: Record<string, unknown>;
  /** Zeitpunkt des Laufs. Für Zeitbedingungen und `{{now}}`. */
  now: Date;
  /**
   * Ereignisse, die dieser Lauf ausgelöst hat.
   *
   * Der Executor zählt mit; über `LIMITS.maxEmittedEvents` hinaus wird
   * abgebrochen (§16).
   */
  emitted: number;
}

// --- Variablenauflösung -----------------------------------------------------

/**
 * Was ein Pfad in `{{...}}` erreichen darf.
 *
 * Eine Freigabeliste und keine Sperrliste: was hier nicht steht, gibt es
 * nicht. Eine Sperrliste müsste jede künftige Gefahr vorwegnehmen; eine
 * Freigabeliste muss nur das Erlaubte kennen.
 */
const ERLAUBTE_WURZELN = new Set(['payload', 'event', 'steps', 'guildId', 'now', 'runId']);

/**
 * Ein Pfad besteht aus Namen und Zahlen, getrennt durch Punkte.
 *
 * Kein `[`, kein `(`, kein Leerzeichen: damit lässt sich weder ein
 * Funktionsaufruf noch ein Indexzugriff auf etwas anderes als ein Feld
 * schreiben.
 */
const PFAD_MUSTER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/u;

/** Namen, die auf dem Prototyp liegen und niemals gelesen werden dürfen. */
const VERBOTEN = new Set(['__proto__', 'constructor', 'prototype']);

export function istErlaubterPfad(pfad: string): boolean {
  if (!PFAD_MUSTER.test(pfad)) {
    return false;
  }
  const teile = pfad.split('.');
  if (!ERLAUBTE_WURZELN.has(teile[0]!)) {
    return false;
  }
  return !teile.some((teil) => VERBOTEN.has(teil));
}

/**
 * Einen Wert aus dem Kontext lesen.
 *
 * Gibt `undefined` zurück, wenn der Pfad nicht erlaubt ist oder ins Leere
 * zeigt. Wirft nie - eine fehlende Variable ist ein Anzeigeproblem, kein
 * Grund, einen Lauf abzubrechen.
 */
export function leseWert(context: AutomationContext, pfad: string): unknown {
  if (!istErlaubterPfad(pfad)) {
    return undefined;
  }
  const teile = pfad.split('.');
  let aktuell: unknown = {
    payload: context.payload,
    event: context.event,
    steps: context.steps,
    guildId: context.guildId,
    runId: context.runId,
    now: context.now,
  };

  for (const teil of teile) {
    if (aktuell === null || aktuell === undefined) {
      return undefined;
    }
    if (typeof aktuell !== 'object') {
      return undefined;
    }
    // `Object.hasOwn` statt `in`: sonst käme man an Geerbtes heran.
    if (!Object.hasOwn(aktuell as object, teil)) {
      return undefined;
    }
    aktuell = (aktuell as Record<string, unknown>)[teil];
  }
  return aktuell;
}

/** Wie ein Wert in einem Text erscheint. */
function alsText(wert: unknown): string {
  if (wert === null || wert === undefined) {
    return '';
  }
  if (wert instanceof Date) {
    return wert.toISOString();
  }
  if (typeof wert === 'string') {
    return wert;
  }
  if (typeof wert === 'number' || typeof wert === 'boolean' || typeof wert === 'bigint') {
    return String(wert);
  }
  // Objekte und Listen werden nicht ausgeschrieben: `[object Object]` in
  // einer Discord-Nachricht hilft niemandem, und ein ganzes JSON darin wäre
  // eine unfreiwillige Datenausgabe.
  return '';
}

export interface RenderErgebnis {
  text: string;
  /** Pfade, die ins Leere zeigten. Der Builder zeigt sie als Warnung. */
  fehlend: string[];
}

/**
 * Einen Text mit `{{pfad}}` auflösen.
 *
 * **Kein `eval`, keine Ausdrücke, keine Funktionsaufrufe.** Ein Platzhalter
 * ist ein Pfad in eine Freigabeliste und sonst nichts. Damit ist die
 * Automation Engine keine Plattform, auf der sich Code ausführen lässt (§44) -
 * auch dann nicht, wenn jemand mit Schreibrecht auf Automationen es versucht.
 *
 * Ein unbekannter Pfad wird zur leeren Zeichenkette und gemeldet, nicht zum
 * Fehler: eine Nachricht ohne den Anzeigenamen ist besser als keine
 * Nachricht.
 */
export function render(vorlage: string, context: AutomationContext): RenderErgebnis {
  const fehlend: string[] = [];
  const text = vorlage.replace(/\{\{\s*([^}]{1,120}?)\s*\}\}/gu, (_treffer, roh: string) => {
    const pfad = roh.trim();
    if (!istErlaubterPfad(pfad)) {
      fehlend.push(pfad);
      return '';
    }
    const wert = leseWert(context, pfad);
    if (wert === undefined) {
      fehlend.push(pfad);
      return '';
    }
    return alsText(wert);
  });

  return {
    text: text.length > LIMITS.maxRenderedChars ? text.slice(0, LIMITS.maxRenderedChars) : text,
    fehlend,
  };
}

/** Welche Platzhalter in einem Text stehen - für die Prüfung vor dem Einschalten. */
export function findePlatzhalter(vorlage: string): string[] {
  const treffer = [...vorlage.matchAll(/\{\{\s*([^}]{1,120}?)\s*\}\}/gu)];
  return [...new Set(treffer.map((eintrag) => (eintrag[1] ?? '').trim()))];
}

/**
 * Alle Textfelder einer Konfiguration auflösen.
 *
 * Rekursiv über Objekte und Listen, aber begrenzt in der Tiefe: eine
 * Konfiguration ist ein flaches Gebilde, und eine unbegrenzte Rekursion wäre
 * eine Einladung.
 */
export function renderConfig<T>(config: T, context: AutomationContext, tiefe = 0): T {
  if (tiefe > 6) {
    return config;
  }
  if (typeof config === 'string') {
    return render(config, context).text as unknown as T;
  }
  if (Array.isArray(config)) {
    return config.map((eintrag) => renderConfig(eintrag, context, tiefe + 1)) as unknown as T;
  }
  if (config && typeof config === 'object') {
    const ergebnis: Record<string, unknown> = {};
    for (const [schluessel, wert] of Object.entries(config as Record<string, unknown>)) {
      if (VERBOTEN.has(schluessel)) {
        continue;
      }
      ergebnis[schluessel] = renderConfig(wert, context, tiefe + 1);
    }
    return ergebnis as unknown as T;
  }
  return config;
}
