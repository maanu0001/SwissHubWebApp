import type { ActionResult } from '@swisshub/shared';

/**
 * Der Sende-Ablauf als eigene Funktion.
 *
 * Grund: Genau hier hing die Oberfläche. Der Aufruf stand ohne `try`/`catch`
 * im Klick-Handler, und `setPending(false)` kam erst danach. Lehnte die
 * Server Action ab - Netzwerkabbruch, Serverfehler, abgelaufene Sitzung,
 * neuer Programmstand nach einem Deployment -, wurde diese Zeile nie
 * erreicht: der Knopf blieb für immer deaktiviert und der Bestätigungsdialog
 * offen.
 *
 * Deshalb steht der Ablauf hier, ohne React und ohne DOM, und lässt sich als
 * solcher prüfen. Die Zusage ist einfach: `settle` läuft immer, egal was
 * passiert.
 */

export type SubmitOutcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; message: string; fieldErrors?: Record<string, string> }
  /** Die Anfrage kam nicht durch - Netz, Server oder Sitzung. */
  | { kind: 'transport'; message: string };

export interface SubmitHandlers<T> {
  /** Wird genau einmal aufgerufen - auch bei Fehlern. Setzt den Ladezustand zurück. */
  settle(): void;
  onSuccess(data: T): void;
  onError(outcome: Extract<SubmitOutcome<T>, { kind: 'error' | 'transport' }>): void;
}

const TRANSPORT_MESSAGE =
  'Die Anfrage konnte nicht abgeschlossen werden. Bitte prüfe deine Verbindung und versuche es erneut.';

/**
 * Führt eine Server Action aus und meldet das Ergebnis.
 *
 * Wirft nie. Was auch schiefgeht, landet als `transport` beim Aufrufer - und
 * `settle` läuft in jedem Fall.
 */
export async function runSubmit<T>(
  action: () => Promise<ActionResult<T>>,
  handlers: SubmitHandlers<T>,
): Promise<SubmitOutcome<T>> {
  let outcome: SubmitOutcome<T>;

  try {
    const response = await action();
    if (response.ok) {
      outcome = { kind: 'success', data: response.data };
    } else {
      const fieldErrors = response.error.details?.fieldErrors;
      outcome = {
        kind: 'error',
        message: response.error.message,
        fieldErrors:
          typeof fieldErrors === 'object' && fieldErrors !== null
            ? (fieldErrors as Record<string, string>)
            : undefined,
      };
    }
  } catch {
    // Die Server Action ist gar nicht bis zu einer Antwort gekommen. Für die
    // bedienende Person ist das dasselbe wie ein Fehler - nur ohne Text vom
    // Server, deshalb ein eigener.
    outcome = { kind: 'transport', message: TRANSPORT_MESSAGE };
  } finally {
    // Das `finally` ist der Kern dieser Funktion: der Ladezustand wird
    // zurückgesetzt, bevor irgendetwas anderes passiert.
    handlers.settle();
  }

  if (outcome.kind === 'success') {
    handlers.onSuccess(outcome.data);
  } else {
    handlers.onError(outcome);
  }
  return outcome;
}
