import {
  AUDIT_LOG_ACTIONS,
  discord as defaultDiscord,
  type AuditLogEntry,
  type DiscordGateway,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';

const log = createLogger('moderation:audit');

/**
 * Wer hat gehandelt, und warum?
 *
 * Ein Gateway-Ereignis sagt, **dass** jemand gebannt wurde. Wer den Bann
 * verhaengt hat und mit welcher Begruendung, steht ausschliesslich in Discords
 * Audit Log. Diese Datei ist die eine Stelle, an der SwissHub dort nachsieht.
 *
 * ## Warum nicht einfach der neueste Eintrag
 *
 * Weil das bei zwei Banns kurz hintereinander die Personen vertauscht. Ein
 * Eintrag zaehlt nur, wenn **Typ und Ziel stimmen** und er **im Zeitfenster**
 * liegt. Passt eine der drei Bedingungen nicht, ist die Antwort «nicht
 * gefunden» - nicht «vermutlich der da».
 *
 * ## Warum ueberhaupt Wiederholungen
 *
 * Discord schreibt das Audit Log nicht synchron zum Gateway. Meistens ist der
 * Eintrag sofort da, manchmal Sekundenbruchteile spaeter. Ein einziger
 * Versuch verliert deshalb gelegentlich den Handelnden - und damit das
 * Wertvollste an der ganzen Auskunft.
 *
 * Die Wiederholungen sind fest begrenzt: drei Versuche, danach ist Schluss.
 * Kein Warten in einer Schleife, bis irgendwann etwas erscheint.
 */

/**
 * Wie weit Audit-Eintrag und Gateway-Ereignis auseinanderliegen duerfen.
 *
 * Zehn Sekunden, und das ist bewusst grosszuegiger als die fuenf der
 * Analytics-Zuordnung: dort wird beim ersten Versuch entschieden, hier wird
 * bis zu drei Sekunden lang nachgefasst, und der Abstand waechst mit jedem
 * Versuch. Enger gefasst verloere der letzte Versuch genau den Eintrag, auf
 * den er gewartet hat.
 *
 * Nach oben ist das Fenster die Grenze gegen alte Vorgaenge: ein Bann von
 * gestern darf einem Ereignis von heute nie zugeordnet werden.
 */
export const AUDIT_FENSTER_MS = 10_000;

/**
 * Die Wartezeiten zwischen den Versuchen.
 *
 * Erst sofort, dann nach 700 ms, dann nach 2500 ms - zusammen gut drei
 * Sekunden. Danach wird nicht weiter gefragt: ein Eintrag, der bis dahin
 * nicht da ist, kommt in aller Regel gar nicht, und weiteres Fragen kostet
 * nur Anfragen an eine Schnittstelle mit Rate Limit.
 */
export const AUDIT_VERSUCHE_MS = [0, 700, 2_500] as const;

export interface AuditSuche {
  /** Discords numerischer Ereignistyp, z.B. `AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD`. */
  actionType: number;
  /** Wen es betraf. */
  targetId: string;
  /** Wann das Gateway-Ereignis eintraf. */
  occurredAt: Date;
}

export interface AuditOptions {
  gateway?: DiscordGateway;
  /** Zum Testen: haelt die Zeit an, statt wirklich zu warten. */
  warte?: (ms: number) => Promise<void>;
  /** Wie viele Versuche hoechstens. Ohne Angabe alle drei. */
  maxVersuche?: number;
}

export type AuditBefund =
  | { status: 'gefunden'; eintrag: AuditLogEntry; versuche: number }
  /** Abgefragt, aber nichts Passendes gefunden. */
  | { status: 'kein-treffer'; versuche: number }
  /** Gar nicht abfragbar - fehlendes Recht oder Discord-Stoerung. */
  | { status: 'nicht-abrufbar'; versuche: number };

const schlafe = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((fertig) => setTimeout(fertig, ms));

/** Passt dieser Eintrag zum Ereignis? Alle Bedingungen, oder keine Zuordnung. */
export function passt(eintrag: AuditLogEntry, suche: AuditSuche): boolean {
  if (eintrag.actionType !== suche.actionType) {
    return false;
  }
  if (eintrag.targetId !== suche.targetId) {
    return false;
  }
  const abstand = Math.abs(eintrag.createdAt.getTime() - suche.occurredAt.getTime());
  return abstand <= AUDIT_FENSTER_MS;
}

/**
 * Sucht den Audit-Eintrag zu einem Ereignis.
 *
 * Unterscheidet drei Ausgaenge, und der Unterschied zaehlt: «nichts gefunden»
 * heisst bei einem Austritt, dass niemand gekickt hat - also ein freiwilliges
 * Verlassen. «Nicht abrufbar» heisst dagegen, dass wir es schlicht nicht
 * wissen, und daraus darf nie ein Kick werden.
 */
export async function findeAuditEintrag(suche: AuditSuche, options: AuditOptions = {}): Promise<AuditBefund> {
  const gateway = options.gateway ?? defaultDiscord;
  const warte = options.warte ?? schlafe;
  const versucheGesamt = Math.min(
    Math.max(options.maxVersuche ?? AUDIT_VERSUCHE_MS.length, 1),
    AUDIT_VERSUCHE_MS.length,
  );

  let abrufbar = false;

  for (let versuch = 0; versuch < versucheGesamt; versuch += 1) {
    await warte(AUDIT_VERSUCHE_MS[versuch] ?? 0);

    let eintraege: AuditLogEntry[];
    try {
      // Gezielt: nur dieser Ereignistyp, nur wenige Eintraege. Kein Abzug des
      // ganzen Audit Logs, und schon gar keiner bei jedem Ereignis.
      eintraege = await gateway.guild.auditLog({ actionType: suche.actionType, limit: 10 });
      abrufbar = true;
    } catch (error) {
      // Fehlendes `VIEW_AUDIT_LOG` oder eine Stoerung bei Discord. Kein Grund
      // zum Abbruch des Bots - aber auch kein Grund, etwas zu behaupten.
      log.debug('moderation.discord.audit_retry', { versuch: versuch + 1, error });
      continue;
    }

    const treffer = eintraege.find((eintrag) => passt(eintrag, suche));
    if (treffer) {
      if (versuch > 0) {
        log.debug('moderation.discord.audit_matched', { versuch: versuch + 1, verspaetet: true });
      }
      return { status: 'gefunden', eintrag: treffer, versuche: versuch + 1 };
    }
  }

  return {
    status: abrufbar ? 'kein-treffer' : 'nicht-abrufbar',
    versuche: versucheGesamt,
  };
}

export { AUDIT_LOG_ACTIONS };
