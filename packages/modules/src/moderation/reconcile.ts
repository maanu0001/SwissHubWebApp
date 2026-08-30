import { prisma } from '@swisshub/database';
import {
  discord as defaultDiscord,
  type AuditLogEntry,
  type DiscordGateway,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AUDIT_LOG_ACTIONS } from './audit-lookup';
import { erfasseAusAuditEintrag, type ExternerVorgang } from './extern';

const log = createLogger('moderation:reconcile');

/**
 * Nachlesen, was der Bot verpasst hat.
 *
 * Gateway-Ereignisse kommen zuverlaessig - solange die Verbindung steht.
 * Waehrend eines Neustarts oder einer Trennung kommen sie nicht, und Discord
 * liefert sie danach nicht nach. Ein Bann, der in diesen Minuten faellt,
 * bliebe der Akte fuer immer unbekannt.
 *
 * Dieser Lauf liest deshalb regelmaessig die neuen Audit-Eintraege und
 * verarbeitet sie durch dieselbe Kette wie ein Gateway-Ereignis. Doppelt
 * erfasst wird dabei nichts: die Eindeutigkeit von `discordAuditLogEntryId`
 * weist jeden schon verarbeiteten Eintrag ab - in der Datenbank, nicht im
 * Anwendungscode.
 *
 * ## Was er bewusst nicht tut
 *
 * **Kein Vollscan.** Gelesen wird ab der zuletzt verarbeiteten Kennung
 * (`after`), nicht von vorn. Beim allerersten Lauf - und nach dem Verlust des
 * Zeigers - wird gar nichts nachgetragen, sondern nur der Zeiger gesetzt: die
 * gesamte Vergangenheit eines Servers nachtraeglich in die Akte zu schreiben
 * waere etwas anderes als das Schliessen einer Luecke.
 *
 * **Keine Timeouts.** Discord fuehrt einen Timeout als `MEMBER_UPDATE`, und
 * dieser Typ deckt auch Spitznamen und anderes ab. Welche Aenderung es war,
 * steht in einem Feld, das SwissHub aus dem Audit Log nicht ausliest. Ohne
 * das waere jede Zuordnung geraten - und Raten ist genau das, was dieses
 * Modul nicht tun darf. Timeouts erkennt deshalb nur das Gateway-Ereignis,
 * das die alte und die neue Frist mitbringt.
 */

/** Welche Audit-Typen sich allein aus ihrem Typ eindeutig deuten lassen. */
const EINDEUTIGE_TYPEN: ReadonlyArray<{ actionType: number; vorgang: ExternerVorgang }> = [
  { actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD, vorgang: { art: 'BAN' } },
  { actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_REMOVE, vorgang: { art: 'UNBAN' } },
  { actionType: AUDIT_LOG_ACTIONS.MEMBER_KICK, vorgang: { art: 'KICK' } },
];

/** Hoechstens so viele Eintraege je Typ und Lauf. */
const LIMIT = 25;

export interface AbgleichErgebnis {
  gelesen: number;
  erfasst: number;
  abgeglichen: number;
  uebersprungen: number;
  /** Der neue Zeiger, oder `null`, wenn er unveraendert bleibt. */
  zeiger: string | null;
}

const LEER: AbgleichErgebnis = {
  gelesen: 0,
  erfasst: 0,
  abgeglichen: 0,
  uebersprungen: 0,
  zeiger: null,
};

/** Snowflakes sind aufsteigend - die groessere Kennung ist die juengere. */
function groessere(a: string | null, b: string): string {
  if (!a) {
    return b;
  }
  return BigInt(b) > BigInt(a) ? b : a;
}

/**
 * Liest die neuen Audit-Eintraege und traegt nach, was fehlt.
 *
 * Beim ersten Lauf wird nur der Zeiger gesetzt. Das ist Absicht: ohne ihn
 * waere die einzige Alternative, die gesamte erreichbare Vergangenheit
 * einzulesen, und die gehoert nicht in eine Akte, die bisher bei null anfing.
 */
export async function gleicheAuditLogAb(
  options: { gateway?: DiscordGateway; eigeneBotId?: string | null } = {},
): Promise<AbgleichErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;

  const status = await prisma.botStatus.findUnique({
    where: { id: 'singleton' },
    select: { lastAuditEntryId: true, botUserId: true },
  });
  const zeigerVorher = status?.lastAuditEntryId ?? null;
  const eigeneBotId = options.eigeneBotId ?? status?.botUserId ?? null;

  let gelesen = 0;
  let erfasst = 0;
  let abgeglichen = 0;
  let uebersprungen = 0;
  let neuerZeiger = zeigerVorher;

  for (const { actionType, vorgang } of EINDEUTIGE_TYPEN) {
    let eintraege: AuditLogEntry[];
    try {
      eintraege = await gateway.guild.auditLog({
        actionType,
        limit: LIMIT,
        ...(zeigerVorher ? { after: zeigerVorher } : {}),
      });
    } catch (error) {
      // Fehlendes Recht oder Stoerung. Der Zeiger bleibt, wo er ist - der
      // naechste Lauf holt dieselben Eintraege nach.
      log.debug('Abgleich nicht moeglich', { actionType, error });
      return LEER;
    }

    gelesen += eintraege.length;

    for (const eintrag of eintraege) {
      neuerZeiger = groessere(neuerZeiger, eintrag.id);

      // Beim ersten Lauf nur den Zeiger setzen, nichts nachtragen.
      if (!zeigerVorher) {
        uebersprungen += 1;
        continue;
      }
      if (!eintrag.targetId) {
        uebersprungen += 1;
        continue;
      }

      const ergebnis = await erfasseAusAuditEintrag(eintrag, vorgang, eigeneBotId);
      if (ergebnis.ergebnis === 'erfasst') {
        erfasst += 1;
      } else if (ergebnis.ergebnis === 'abgeglichen') {
        abgeglichen += 1;
      } else {
        uebersprungen += 1;
      }
    }
  }

  if (neuerZeiger && neuerZeiger !== zeigerVorher) {
    await prisma.botStatus.updateMany({
      where: { id: 'singleton' },
      data: { lastAuditEntryId: neuerZeiger },
    });
  }

  if (erfasst > 0) {
    log.info('Verpasste Massnahmen nachgetragen', { erfasst, abgeglichen, gelesen });
  }

  return { gelesen, erfasst, abgeglichen, uebersprungen, zeiger: neuerZeiger };
}
