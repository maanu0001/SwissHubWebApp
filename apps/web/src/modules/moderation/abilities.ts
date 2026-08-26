/**
 * Was ein Betrachter im Moderation Center tun darf - als reine Daten.
 *
 * Neutral gehalten (kein `server-only`, kein JSX), damit die Maske im Browser
 * denselben Typ verwendet, den der Server befuellt. Der Inhalt entsteht
 * ausschliesslich serverseitig in `@/server/moderation`; hier steht nur die
 * Form.
 */
export interface ModerationAbilities {
  ban: boolean;
  unban: boolean;
  kick: boolean;
  timeout: boolean;
  timeoutRemove: boolean;
  note: boolean;
  /** Mindestens eine Massnahme - sonst braucht es gar keine Maske. */
  any: boolean;
}
