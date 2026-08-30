import type { DiscordEventCategory, DiscordLogCategory } from '@swisshub/database';
import { EVENT_TYPES } from '../analytics/event-types';

/**
 * Welche Log-Kategorien es gibt und woher sie gespeist werden.
 *
 * Die Liste ist bewusst kurz: **jede Kategorie hier hat eine tatsaechliche
 * Quelle im System.** Eine Kategorie ohne Quelle waere ein Auswahlfeld im
 * Dashboard, das nie etwas sendet - schlimmer als ein fehlendes Feld, weil
 * jemand darauf vertraut.
 *
 * ## Zwei Quellen, nicht zehn
 *
 * ```
 * ModerationAction  → MODERATION
 * DiscordEvent      → MESSAGES | VOICE | MEMBERS | ADMIN
 * ```
 *
 * Mehr gibt es heute nicht, und deshalb steht hier auch nicht mehr.
 * Verifikation und Tickets erzeugen ihre Spuren im Audit Log und - wenn die
 * Automation Engine laeuft - als Automationsereignis; einen von der
 * Modulaktivierung unabhaengigen zentralen Punkt haben sie nicht. Ihn zu
 * erfinden hiesse, ein zweites Logsystem zu bauen. Wie eine Kategorie
 * nachgeruestet wird, steht in `docs/DISCORD-LOG-KANAELE.md`.
 *
 * ## Warum Banns nicht in MEMBERS stehen
 *
 * Ein Bann erzeugt beides: einen Eintrag in der Moderationsakte und ein
 * Ereignis im Statistikprotokoll. Beides zu senden hiesse, dieselbe Sache
 * zweimal zu melden. Die Akte gewinnt - sie kennt Grund, Quelle und
 * Handelnden. Die entsprechenden Ereignistypen stehen deshalb in
 * `AUS_DER_AKTE` und werden vom Statistikpfad uebersprungen.
 */

export interface LogKategorieDefinition {
  id: DiscordLogCategory;
  label: string;
  beschreibung: string;
  /** Kurz und ohne Fachchinesisch - steht unter dem Auswahlfeld. */
  beispiel: string;
}

export const LOG_KATEGORIEN: readonly LogKategorieDefinition[] = [
  {
    id: 'MODERATION',
    label: 'Moderation',
    beschreibung:
      'Banns, Kicks, Timeouts und Aufhebungen - unabhängig davon, ob über das Dashboard, den Bot oder direkt in Discord ausgelöst. Jail-Vorgänge nutzen weiterhin den Kanal aus den Jail-Einstellungen.',
    beispiel: 'Mitglied gebannt · Timeout gesetzt · Bann aufgehoben',
  },
  {
    id: 'MESSAGES',
    label: 'Nachrichten',
    beschreibung: 'Gelöschte und bearbeitete Nachrichten.',
    beispiel: 'Nachricht gelöscht · Nachricht bearbeitet',
  },
  {
    id: 'VOICE',
    label: 'Sprachkanäle',
    beschreibung: 'Beitritt, Verlassen und Wechsel in Sprachkanälen.',
    beispiel: 'Voice beigetreten · Voice verschoben',
  },
  {
    id: 'MEMBERS',
    label: 'Mitglieder',
    beschreibung: 'Beitritte, Austritte, Rollenänderungen und Spitznamen.',
    beispiel: 'Mitglied beigetreten · Rolle vergeben · Spitzname geändert',
  },
  {
    id: 'ADMIN',
    label: 'Server & Verwaltung',
    beschreibung: 'Rollen, Kanäle und Serveränderungen.',
    beispiel: 'Kanal gelöscht · Rolle bearbeitet',
  },
] as const;

export const LOG_KATEGORIE_IDS = LOG_KATEGORIEN.map((eintrag) => eintrag.id);

const NACH_ID = new Map(LOG_KATEGORIEN.map((eintrag) => [eintrag.id, eintrag]));

export function kategorie(id: DiscordLogCategory): LogKategorieDefinition {
  const gefunden = NACH_ID.get(id);
  if (!gefunden) {
    // Kann nur passieren, wenn dem Enum ein Wert hinzugefuegt und diese Liste
    // vergessen wurde. Ein Test haelt genau das fest.
    throw new Error(`Unbekannte Log-Kategorie: ${id}`);
  }
  return gefunden;
}

/**
 * Ereignistypen, die aus der Moderationsakte gemeldet werden.
 *
 * Der Statistikpfad ueberspringt sie - sonst stuende jeder Bann zweimal in
 * Discord. Ein Austritt steht bewusst **nicht** hier: er ist auch dann eine
 * Mitgliederbewegung, wenn er ein Kick war, und beides sind verschiedene
 * Aussagen ueber denselben Moment.
 */
export const AUS_DER_AKTE: ReadonlySet<string> = new Set<string>([
  EVENT_TYPES.MEMBER_BAN,
  EVENT_TYPES.MEMBER_UNBAN,
  EVENT_TYPES.MEMBER_TIMEOUT,
  EVENT_TYPES.MEMBER_TIMEOUT_END,
]);

/**
 * Massnahmen, die **nicht** über die Discord-Log-Kanaele hinausgehen.
 *
 * `NOTE` ist eine interne Notiz zur Akte. Sie steht ausdruecklich nicht in
 * einem Kanal, den das halbe Team liest - das ist keine Einstellung, sondern
 * der Zweck einer internen Notiz.
 *
 * `JAIL_*` fehlt hier nicht aus Nachlaessigkeit: das Jail-Modul postet
 * bereits selbst in den Kanal aus seinen eigenen Einstellungen, mit einer
 * eigenen, ausfuehrlicheren Darstellung. Beides zu senden hiesse, dieselbe
 * Sache zweimal in Discord zu schreiben; das bestehende Verhalten dafuer
 * abzuschalten waere eine Aenderung an einem funktionierenden Modul und
 * gehoert nicht in diese Erweiterung. Wie beides spaeter zusammengefuehrt
 * werden kann, steht in `docs/DISCORD-LOG-KANAELE.md`.
 */
export const NICHT_NACH_DISCORD: ReadonlySet<string> = new Set<string>([
  'NOTE',
  'JAIL_CREATE',
  'JAIL_RELEASE',
  'JAIL_EXTEND',
]);

/** Welche Statistik-Kategorie in welche Log-Kategorie faellt. */
const AUS_EREIGNIS: Record<DiscordEventCategory, DiscordLogCategory> = {
  MESSAGE: 'MESSAGES',
  VOICE: 'VOICE',
  MEMBER: 'MEMBERS',
  ROLE: 'ADMIN',
  CHANNEL: 'ADMIN',
  SERVER: 'ADMIN',
};

/**
 * Die Kategorie eines Statistikereignisses - oder keine.
 *
 * `null` heisst: dieses Ereignis wird nicht ueber den Statistikpfad
 * ausgegeben. Entweder weil die Akte es bereits meldet, oder weil es zu einer
 * Massnahme dieses Dashboards gehoert und dort schon gezaehlt wurde.
 */
export function kategorieFuerEreignis(input: {
  category: DiscordEventCategory;
  type: string;
  /** Gesetzt, wenn das Ereignis zu einer Massnahme dieses Systems gehoert. */
  moderationActionId?: string | null;
}): DiscordLogCategory | null {
  if (input.moderationActionId) {
    return null;
  }
  if (AUS_DER_AKTE.has(input.type)) {
    return null;
  }
  return AUS_EREIGNIS[input.category] ?? null;
}
