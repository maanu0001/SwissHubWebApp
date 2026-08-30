import type { AppealStatus } from '@swisshub/database';

/**
 * Der Statusautomat.
 *
 * Erlaubte Übergänge stehen hier als Tabelle und nicht verstreut in den
 * Diensten. Der Grund ist nicht Ordnungsliebe: ein Antrag, dessen Zustand sich
 * von überall her ändern lässt, hat am Ende Zustände, die niemand vorgesehen
 * hat - ein geschlossener Fall, der wieder «wird geprüft» ist, oder eine
 * zweite Entscheidung auf einer ersten.
 *
 * Zwei Regeln, die die Tabelle durchziehen:
 *
 * 1. **Aus einem Endzustand führt kein Weg zurück.** `APPROVED`, `REJECTED`,
 *    `WITHDRAWN`, `EXPIRED` und `RESOLVED_EXTERNALLY` gehen ausschliesslich
 *    nach `CLOSED`. Eine Entscheidung ist eine Entscheidung.
 * 2. **Der Antragsteller kann genau eines: zurückziehen.** Alles andere
 *    entscheidet das Team.
 */

/** Zustände, in denen der Antrag noch offen ist. */
export const OFFENE_STATUS: readonly AppealStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'WAITING_FOR_APPLICANT',
  'WAITING_FOR_STAFF',
  'ESCALATED',
  'DECISION_PENDING',
] as const;

/** Zustände, nach denen keine Entscheidung mehr fällt. */
export const ENDZUSTAENDE: readonly AppealStatus[] = [
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
  'RESOLVED_EXTERNALLY',
  'CLOSED',
] as const;

/**
 * Erlaubte Übergänge des Teams.
 *
 * `DRAFT -> SUBMITTED` fehlt hier bewusst: das Einreichen ist keine
 * Statusänderung des Teams, sondern der Vorgang, in dem der Antrag entsteht.
 * Er hat seinen eigenen Weg mit Momentaufnahme und Fallnummer.
 */
const UEBERGAENGE: Record<AppealStatus, readonly AppealStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'WAITING_FOR_APPLICANT', 'ESCALATED', 'WITHDRAWN', 'RESOLVED_EXTERNALLY'],
  UNDER_REVIEW: [
    'WAITING_FOR_APPLICANT',
    'ESCALATED',
    'DECISION_PENDING',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN',
    'RESOLVED_EXTERNALLY',
  ],
  WAITING_FOR_APPLICANT: [
    'WAITING_FOR_STAFF',
    'UNDER_REVIEW',
    'EXPIRED',
    'WITHDRAWN',
    'RESOLVED_EXTERNALLY',
  ],
  WAITING_FOR_STAFF: [
    'UNDER_REVIEW',
    'WAITING_FOR_APPLICANT',
    'ESCALATED',
    'DECISION_PENDING',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN',
    'RESOLVED_EXTERNALLY',
  ],
  ESCALATED: [
    'UNDER_REVIEW',
    'WAITING_FOR_APPLICANT',
    'DECISION_PENDING',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN',
    'RESOLVED_EXTERNALLY',
  ],
  // Aus dem Vier-Augen-Zustand führen genau drei Wege: bestätigen, ablehnen,
  // oder zurück in die Prüfung, wenn die zweite Person nicht mitgeht.
  DECISION_PENDING: ['APPROVED', 'REJECTED', 'UNDER_REVIEW', 'WITHDRAWN', 'RESOLVED_EXTERNALLY'],
  APPROVED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  WITHDRAWN: ['CLOSED'],
  EXPIRED: ['CLOSED'],
  RESOLVED_EXTERNALLY: ['CLOSED'],
  CLOSED: [],
};

/** Darf das Team von `von` nach `nach` wechseln? */
export function uebergangErlaubt(von: AppealStatus, nach: AppealStatus): boolean {
  return (UEBERGAENGE[von] ?? []).includes(nach);
}

/** Alle Zustände, in die aus `von` gewechselt werden darf. */
export function moeglicheUebergaenge(von: AppealStatus): readonly AppealStatus[] {
  return UEBERGAENGE[von] ?? [];
}

/**
 * Darf der Antragsteller jetzt zurückziehen? (§45)
 *
 * Solange keine Entscheidung gefallen ist. Nach einer Entscheidung wäre ein
 * Rückzug eine Möglichkeit, ein «Nein» aus der Akte verschwinden zu lassen.
 *
 * **Abgeleitet und nicht zweitgeschrieben.** Eine eigene Liste hier stand
 * genau einmal im Widerspruch zur Tabelle - der Rückzug galt als erlaubt und
 * scheiterte dann am Übergang. Eine zweite Wahrheit über dieselbe Frage
 * findet früher oder später jemand; besser, es gibt sie nicht.
 */
export function darfZurueckziehen(status: AppealStatus): boolean {
  return uebergangErlaubt(status, 'WITHDRAWN');
}

/** Ist der Antrag noch offen? */
export function istOffen(status: AppealStatus): boolean {
  return OFFENE_STATUS.includes(status);
}

/** Ist der Antrag abgeschlossen - egal wie? */
export function istAbgeschlossen(status: AppealStatus): boolean {
  return ENDZUSTAENDE.includes(status);
}

/** Beschriftungen für die Oberfläche. */
export const STATUS_LABEL: Record<AppealStatus, string> = {
  DRAFT: 'Entwurf',
  SUBMITTED: 'Eingereicht',
  UNDER_REVIEW: 'Wird geprüft',
  WAITING_FOR_APPLICANT: 'Wartet auf dich',
  WAITING_FOR_STAFF: 'Wartet auf das Team',
  ESCALATED: 'Eskaliert',
  DECISION_PENDING: 'Entscheidung wartet auf Bestätigung',
  APPROVED: 'Genehmigt',
  REJECTED: 'Abgelehnt',
  WITHDRAWN: 'Zurückgezogen',
  EXPIRED: 'Abgelaufen',
  RESOLVED_EXTERNALLY: 'Bann bereits aufgehoben',
  CLOSED: 'Abgeschlossen',
};

/**
 * Beschriftungen, wie sie der Antragsteller liest.
 *
 * Nicht überall dieselben: «Eskaliert» ist eine interne Einordnung, und
 * «Wartet auf das Team» sagt dem Antragsteller mehr als «Eskaliert». Was
 * intern vorgeht, geht ihn nichts an - was mit seinem Antrag geschieht,
 * schon.
 */
export const STATUS_LABEL_ANTRAGSTELLER: Record<AppealStatus, string> = {
  ...STATUS_LABEL,
  ESCALATED: 'Wird geprüft',
  DECISION_PENDING: 'Wird geprüft',
  WAITING_FOR_STAFF: 'Wartet auf das Team',
};
