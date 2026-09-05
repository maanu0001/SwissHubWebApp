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
  /**
   * Jail als regulaere Massnahme.
   *
   * Haengt an der Berechtigung des Jail-Moduls, nicht an einer eigenen: es
   * ist derselbe Jail, nur ein anderer Weg dorthin.
   */
  jail: boolean;
  note: boolean;
  /** Mindestens eine Massnahme - sonst braucht es gar keine Maske. */
  any: boolean;
}
