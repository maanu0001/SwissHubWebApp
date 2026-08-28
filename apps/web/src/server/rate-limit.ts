import { consumeRateLimit, type RateLimitRule } from '@swisshub/database';
import { AppError } from '@swisshub/shared';

/**
 * Serverseitige Rate Limits.
 *
 * Die Limits sind bewusst grosszügig genug für echte Moderationsarbeit, aber
 * eng genug, um Automatisierung und Missbrauch zu bremsen.
 */
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 10 * 60 * 1000 },
  oauthCallback: { limit: 20, windowMs: 10 * 60 * 1000 },
  memberSearch: { limit: 40, windowMs: 60 * 1000 },
  memberCenter: { limit: 60, windowMs: 5 * 60 * 1000 },
  moderationWrite: { limit: 30, windowMs: 5 * 60 * 1000 },
  // Der Abruf einer Archivdatei ist einzeln billig, in Serie aber ein
  // Abzug des ganzen Archivs.
  analyticsDownload: { limit: 60, windowMs: 5 * 60 * 1000 },
  // Ein Export zieht bis zu 5000 Zeilen - selten und teuer.
  analyticsExport: { limit: 5, windowMs: 10 * 60 * 1000 },
  jailCreate: { limit: 10, windowMs: 5 * 60 * 1000 },
  jailRelease: { limit: 20, windowMs: 5 * 60 * 1000 },
  settingsWrite: { limit: 30, windowMs: 5 * 60 * 1000 },
  discordAction: { limit: 60, windowMs: 5 * 60 * 1000 },
  reconciliation: { limit: 5, windowMs: 15 * 60 * 1000 },
  discordSync: { limit: 10, windowMs: 5 * 60 * 1000 },
  setupWrite: { limit: 20, windowMs: 15 * 60 * 1000 },
  voteJailStart: { limit: 10, windowMs: 10 * 60 * 1000 },
  communicationSend: { limit: 15, windowMs: 10 * 60 * 1000 },
  brandingUpload: { limit: 10, windowMs: 30 * 60 * 1000 },
  jailImport: { limit: 10, windowMs: 30 * 60 * 1000 },
  spielersucheCreate: { limit: 10, windowMs: 10 * 60 * 1000 },
  spielersucheWrite: { limit: 40, windowMs: 5 * 60 * 1000 },
  levelWrite: { limit: 40, windowMs: 5 * 60 * 1000 },
  /**
   * Teilnahme an einer Verlosung.
   *
   * Knapp bemessen: eine Person nimmt pro Verlosung genau einmal teil, mehr
   * als eine Handvoll Versuche gibt es also nicht zu tun. Gegen den
   * Doppelklick wirkt ohnehin schon der eindeutige Schlüssel.
   */
  raffleEnter: { limit: 10, windowMs: 5 * 60 * 1000 },
  raffleManage: { limit: 40, windowMs: 5 * 60 * 1000 },
  /** Ziehen und neu ziehen - selten und folgenreich. */
  raffleDraw: { limit: 10, windowMs: 10 * 60 * 1000 },
  /**
   * Wiedergabesteuerung.
   *
   * Grosszuegig: wer Musik hoert, drueckt oft auf Skip, und ein zu enges
   * Limit macht den Player unbenutzbar. Es bremst nur Automatisierung.
   */
  musicControl: { limit: 120, windowMs: 5 * 60 * 1000 },
  /**
   * Suche.
   *
   * Enger, weil jede Anfrage eine fremde Quelle belastet - der Legacy-Bot
   * hatte hier gar keinen Schutz.
   */
  musicSearch: { limit: 40, windowMs: 60 * 1000 },
  /** Eine Session starten oder beenden - selten und folgenreich. */
  musicSession: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Antworten, Notizen, Statusaenderungen - Support arbeitet zuegig. */
  ticketWrite: { limit: 120, windowMs: 5 * 60 * 1000 },
  /** Neue Tickets - eng, damit das Panel nicht als Spamknopf dient. */
  ticketCreate: { limit: 3, windowMs: 10 * 60 * 1000 },
  /** Kategorien und Panels pflegen - Verwaltung, nicht Alltag. */
  ticketAdmin: { limit: 40, windowMs: 10 * 60 * 1000 },
  /** Anmelden, Team gruenden, einchecken - selten und folgenreich. */
  tournamentParticipate: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Einladungen: eng, damit die Teamsuche nicht zum Rundmail wird. */
  tournamentInvite: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** Resultate melden und bestaetigen - waehrend eines Turniers zuegig. */
  tournamentResult: { limit: 60, windowMs: 5 * 60 * 1000 },
  /** Turnierverwaltung: Bracket, Matches, Preise, Leitung. */
  tournamentAdmin: { limit: 120, windowMs: 10 * 60 * 1000 },
  /**
   * Den eigenen Talk verwalten.
   *
   * Grosszuegig: waehrend eines Abends wird schon mal gesperrt, geoeffnet und
   * jemand hereingelassen. Die eigentliche Bremse beim Umbenennen ist die
   * Abkuehlzeit im Dienst - sie schuetzt vor dem Discord-Rate-Limit, das
   * dieses Fenster nicht kennt.
   */
  voiceOwn: { limit: 60, windowMs: 5 * 60 * 1000 },
  /** Hubs, Presets und fremde Talks - Verwaltung, nicht Alltag. */
  voiceAdmin: { limit: 60, windowMs: 10 * 60 * 1000 },
  /**
   * An- und Abmelden zu einem Event.
   *
   * Knapp: eine Person meldet sich je Event einmal an. Gegen den Doppelklick
   * wirkt ohnehin schon der eindeutige Schluessel.
   */
  calendarParticipate: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Events anlegen, bearbeiten, ankuendigen - Verwaltung, nicht Alltag. */
  calendarAdmin: { limit: 80, windowMs: 10 * 60 * 1000 },
  /**
   * Verifikationen entscheiden.
   *
   * Grosszuegig: nach einer Spamwelle arbeitet die Moderation eine lange
   * Warteschlange ab, und ein enges Fenster machte genau dann die Arbeit
   * unmoeglich, wenn sie noetig ist.
   */
  verificationReview: { limit: 120, windowMs: 5 * 60 * 1000 },

  /**
   * Zugangsdaten ändern.
   *
   * Eng: es gibt keinen Grund, in fünf Minuten zwanzig Mal ein Token zu
   * setzen. Wer es doch versucht, hat entweder ein Problem oder ist nicht der,
   * für den er sich ausgibt.
   */
  integrationWrite: { limit: 20, windowMs: 5 * 60 * 1000 },

  /**
   * «Verbindung testen».
   *
   * Jeder Test kostet eine echte Anfrage beim Anbieter und bei der AI auch
   * Geld (§48). Zehn in fünf Minuten reichen zum Einrichten und verhindern,
   * dass ein festgehaltener Knopf hundert Anfragen auslöst.
   */
  integrationTest: { limit: 10, windowMs: 5 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Verbraucht ein Kontingent und wirft bei Überschreitung `RATE_LIMITED`. */
export async function enforceRateLimit(name: RateLimitName, identity: string): Promise<void> {
  const rule = RATE_LIMITS[name];
  const result = await consumeRateLimit(`${name}:${identity}`, rule);
  if (!result.allowed) {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    throw new AppError('RATE_LIMITED', {
      userMessage: `Zu viele Anfragen. Bitte in ${seconds} Sekunden erneut versuchen.`,
      details: { retryAfterSeconds: seconds },
    });
  }
}
