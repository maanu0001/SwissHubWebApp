import {
  AUDIT_LOG_ACTIONS,
  discord as defaultDiscord,
  type AuditLogEntry,
  type DiscordGateway,
} from '@swisshub/discord';
import type { DiscordActorSource } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const log = createLogger('analytics:actor');

/**
 * Wer war es?
 *
 * Discord beantwortet diese Frage bei den meisten Gateway-Ereignissen nicht.
 * Eine geloeschte Nachricht kommt als blosse Kennung an - ob der Verfasser
 * sie selbst geloescht hat oder ein Moderator, steht nicht darin. Die einzige
 * weitere Quelle ist Discords Audit Log, und die ist aus drei Gruenden
 * unscharf:
 *
 * 1. **Selbstloeschungen erzeugen gar keinen Eintrag.** Wer seine eigene
 *    Nachricht loescht, taucht im Audit Log nie auf.
 * 2. **Discord verdichtet.** Loescht dieselbe Person mehrere Nachrichten
 *    desselben Verfassers im selben Kanal, zaehlt Discord einen bestehenden
 *    Eintrag hoch, statt einen neuen anzulegen. Der Zeitstempel bleibt dabei
 *    der des ersten Vorgangs.
 * 3. **Der Zeitstempel steckt nur in der Snowflake** und hat deshalb keinen
 *    Bezug zum Ereignis, das wir gerade sehen.
 *
 * Daraus folgt: eine Zuordnung ist hoechstens plausibel, nie sicher. Und
 * darum gilt hier die strengste moegliche Regel - **im Zweifel unbekannt**.
 * Ein Protokoll, das raet, ist schlimmer als eines, das schweigt: es sieht
 * aus wie ein Beweis.
 */

/**
 * Wie frisch ein Audit-Eintrag sein muss, um zum Ereignis zu gehoeren.
 *
 * Fuenf Sekunden. Discord schreibt den Eintrag praktisch gleichzeitig mit dem
 * Gateway-Ereignis; alles Aeltere ist ein anderer Vorgang oder ein
 * verdichteter Eintrag von vorhin.
 */
const FENSTER_MS = 5_000;

export interface Verursacher {
  discordId: string | null;
  username: string | null;
  source: DiscordActorSource;
  /** Grund aus dem Audit Log, falls einer angegeben wurde. */
  reason: string | null;
}

/** Niemand zugeordnet - der ehrliche Standardfall. */
export const UNBEKANNT: Verursacher = {
  discordId: null,
  username: null,
  source: 'UNKNOWN',
  reason: null,
};

export interface CorrelateInput {
  /** Discords numerischer Audit-Typ, z.B. `AUDIT_LOG_ACTIONS.MESSAGE_DELETE`. */
  actionType: number;
  /** Wen oder was das Ereignis betraf. */
  targetId: string;
  /** Wann das Gateway-Ereignis eintraf. */
  occurredAt: Date;
  /**
   * Kanal, in dem es geschah.
   *
   * Nur gesetzt, wo Discord ihn im Audit-Eintrag mitliefert (Nachrichten).
   * Passt er nicht, ist es ein anderer Vorgang.
   */
  channelId?: string | null;
}

/**
 * Sucht den Verursacher im Audit Log - und gibt auf, sobald etwas nicht passt.
 *
 * Zugeordnet wird nur, wenn **alle** Bedingungen erfuellt sind: derselbe
 * Ereignistyp, dasselbe Ziel, derselbe Kanal (wo bekannt) und ein Eintrag,
 * der innerhalb des Fensters entstanden ist. Faellt eine davon weg, ist die
 * Antwort `UNBEKANNT`.
 */
export async function correlateActor(
  input: CorrelateInput,
  options: { gateway?: DiscordGateway } = {},
): Promise<Verursacher> {
  const gateway = options.gateway ?? defaultDiscord;

  let eintraege: AuditLogEntry[];
  try {
    eintraege = await gateway.guild.auditLog({ actionType: input.actionType, limit: 10 });
  } catch (error) {
    // Fehlt dem Bot `VIEW_AUDIT_LOG` oder streikt Discord, wird nichts
    // zugeordnet. Das ist der richtige Ausgang - nicht ein Fehler, den
    // jemand behandeln muesste.
    log.debug('Audit Log nicht abrufbar - Verursacher bleibt unbekannt', { error });
    return UNBEKANNT;
  }

  const passend = eintraege.find((eintrag) => {
    if (eintrag.targetId !== input.targetId) {
      return false;
    }
    if (input.channelId && eintrag.channelId && eintrag.channelId !== input.channelId) {
      return false;
    }
    const abstand = Math.abs(eintrag.createdAt.getTime() - input.occurredAt.getTime());
    return abstand <= FENSTER_MS;
  });

  if (!passend?.userId) {
    return UNBEKANNT;
  }

  return {
    discordId: passend.userId,
    username: passend.username,
    source: 'AUDIT_LOG',
    reason: passend.reason,
  };
}

export { AUDIT_LOG_ACTIONS };
