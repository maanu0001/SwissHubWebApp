import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type {
  Prisma,
  ModerationAction,
  ModerationActionType,
  ModerationActorType,
  ModerationSource,
} from '@swisshub/database';
import type { AuditLogEntry, DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { sanitizeText } from '@swisshub/shared';
import { AUDIT_LOG_ACTIONS, findeAuditEintrag, type AuditBefund } from './audit-lookup';
import { meldeMassnahme } from './events';

const log = createLogger('moderation:extern');

/**
 * Massnahmen, die nicht ueber SwissHub liefen.
 *
 * Bannt eine Moderatorin direkt in der Discord-App, wusste SwissHub davon
 * bisher nichts: die Akte kannte nur, was ueber das Dashboard ging. Wer sie
 * las, sah einen Ausschnitt und hielt ihn fuer das Ganze - und das ist
 * schlimmer als eine sichtbar leere Akte.
 *
 * Hier wird der Rest ergaenzt. Der Weg ist immer derselbe:
 *
 * ```
 * Gateway-Ereignis   -> DASS etwas geschah
 * Discord Audit Log  -> WER es tat und WARUM
 * Abgleich           -> war es womoeglich SwissHub selbst?
 * Akte               -> dieselbe Tabelle wie alles andere
 * ```
 *
 * ## Was hier ausdruecklich nicht passiert
 *
 * Es entsteht **keine zweite Moderationshistorie**. Extern erkannte
 * Massnahmen landen in `ModerationAction` - derselben Tabelle, die das
 * Moderation Center und das Jail-Modul fuellen. Sie erscheinen dadurch ohne
 * weiteres Zutun im Verlauf, im Mitgliederprofil und in den Kennzahlen.
 *
 * ## Die drei Zusagen
 *
 * 1. **Kein Doppel.** Was ueber SwissHub lief, wird nicht ein zweites Mal
 *    erfasst - erkannt am Abgleich und am eigenen Bot als Handelndem.
 * 2. **Kein erfundener Kick.** Ein Austritt wird nur dann zum Kick, wenn ein
 *    passender Audit-Eintrag ihn belegt. Ohne Beleg: nichts.
 * 3. **Kein zweimal verarbeiteter Audit-Eintrag.** Die Eindeutigkeit von
 *    `discordAuditLogEntryId` erzwingt das in der Datenbank, nicht im Code -
 *    also auch ueber Neustarts und gleichzeitige Laeufe hinweg.
 */

/** Wie lange vor oder nach einer Massnahme ein Ereignis noch dazugehoert. */
const ABGLEICH_FENSTER_MS = 30_000;

/** Discord laesst 512 Zeichen Grund zu; die Akte speichert hoechstens so viel. */
const GRUND_MAX = 400;

/** Laengenschranke fuer alles, was aus Discord kommt und in Metadaten landet. */
const NAME_MAX = 100;

export type ExternerVorgang =
  | { art: 'BAN' }
  | { art: 'UNBAN' }
  | { art: 'KICK' }
  | { art: 'TIMEOUT'; bis: Date }
  | { art: 'TIMEOUT_UPDATE'; vorher: Date; bis: Date }
  | { art: 'TIMEOUT_REMOVE'; vorher: Date };

export interface ExterneMassnahme {
  vorgang: ExternerVorgang;
  targetDiscordId: string;
  targetUsername: string;
  /** Wann das Gateway-Ereignis eintraf. */
  occurredAt: Date;
  /**
   * Die Kennung des eigenen Bots.
   *
   * Ohne sie liesse sich nicht erkennen, dass eine Massnahme von SwissHub
   * selbst stammt - und jede Aktion des Dashboards erschiene ein zweites Mal
   * als «direkt auf Discord».
   */
  eigeneBotId: string | null;
}

export interface ExternOptions {
  gateway?: DiscordGateway;
  warte?: (ms: number) => Promise<void>;
  maxVersuche?: number;
}

export type ErfassungsErgebnis =
  /** Neu in der Akte. */
  | { ergebnis: 'erfasst'; massnahme: ModerationAction }
  /** Gehoerte zu einer bereits erfassten SwissHub-Massnahme. */
  | { ergebnis: 'abgeglichen'; massnahmeId: string }
  /** Dieser Audit-Eintrag wurde schon einmal verarbeitet. */
  | { ergebnis: 'bereits-verarbeitet' }
  /** Nichts erfasst - mit Begruendung. */
  | { ergebnis: 'verworfen'; grund: VerwerfGrund };

export type VerwerfGrund =
  /** Austritt ohne Kick-Beleg: jemand ist freiwillig gegangen. */
  | 'freiwilliger-austritt'
  /** Austritt, aber das Audit Log war nicht lesbar - wir wissen es nicht. */
  | 'kick-unbelegt'
  /** Der eigene Bot hat gehandelt, die zugehoerige Zeile fehlt noch. */
  | 'eigener-bot-ohne-zeile';

/** Welcher Audit-Typ zu welchem Vorgang gehoert. */
const AUDIT_TYP: Record<ExternerVorgang['art'], number> = {
  BAN: AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD,
  UNBAN: AUDIT_LOG_ACTIONS.MEMBER_BAN_REMOVE,
  KICK: AUDIT_LOG_ACTIONS.MEMBER_KICK,
  // Discord fuehrt den Timeout als Aenderung am Mitglied, nicht als eigenen Typ.
  TIMEOUT: AUDIT_LOG_ACTIONS.MEMBER_UPDATE,
  TIMEOUT_UPDATE: AUDIT_LOG_ACTIONS.MEMBER_UPDATE,
  TIMEOUT_REMOVE: AUDIT_LOG_ACTIONS.MEMBER_UPDATE,
};

/**
 * Welche Vorgaenge sich auch ohne Beleg erfassen lassen.
 *
 * Ein `guildBanAdd` **ist** ein Bann - das Ereignis selbst sagt es, und ohne
 * Audit-Eintrag fehlt nur der Handelnde. Ein Austritt dagegen sagt gar
 * nichts: er ist ein Kick oder ein freiwilliges Gehen, und welches von
 * beidem, steht ausschliesslich im Audit Log. Deshalb steht `KICK` hier
 * nicht.
 */
const OHNE_BELEG_ERFASSBAR: ReadonlySet<ExternerVorgang['art']> = new Set([
  'BAN',
  'UNBAN',
  'TIMEOUT',
  'TIMEOUT_UPDATE',
  'TIMEOUT_REMOVE',
]);

/** Der Grund aus dem Audit Log - gekuerzt, entschaerft, oder gar nicht. */
function grundAus(eintrag: AuditLogEntry | null): string | null {
  if (!eintrag?.reason) {
    return null;
  }
  const sauber = sanitizeText(eintrag.reason, GRUND_MAX);
  return sauber.length > 0 ? sauber : null;
}

/**
 * Sucht eine bereits erfasste SwissHub-Massnahme zum selben Vorgang.
 *
 * Gesucht wird um den Zeitpunkt der **Massnahme** herum, nicht um «jetzt»:
 * findet ein spaeterer Abgleichlauf denselben Audit-Eintrag, muss er
 * dieselbe Zeile treffen wie das Gateway-Ereignis von damals.
 */
async function findeSwissHubMassnahme(input: {
  type: ModerationActionType;
  targetDiscordId: string;
  zeitpunkt: Date;
}): Promise<{ id: string; discordAuditLogEntryId: string | null } | null> {
  return prisma.moderationAction.findFirst({
    where: {
      type: input.type,
      targetDiscordId: input.targetDiscordId,
      // Extern erkannte Zeilen zaehlen hier nicht mit: sie sind nicht das,
      // wogegen abgeglichen wird, sondern das Ergebnis davon.
      source: { in: ['WEBAPP', 'BOT', 'SYSTEM'] },
      createdAt: {
        gte: new Date(input.zeitpunkt.getTime() - ABGLEICH_FENSTER_MS),
        lte: new Date(input.zeitpunkt.getTime() + ABGLEICH_FENSTER_MS),
      },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, discordAuditLogEntryId: true },
  });
}

/**
 * Haengt den Audit-Eintrag an eine bestehende Massnahme.
 *
 * Damit ist zweierlei belegt: dass Discord die Massnahme tatsaechlich
 * vollzogen hat, und dass dieser Audit-Eintrag verarbeitet ist. Die Bedingung
 * `discordAuditLogEntryId: null` entscheidet das Rennen zweier gleichzeitiger
 * Laeufe in der Datenbank - wer verliert, aendert nichts.
 */
async function belegeMassnahme(massnahmeId: string, auditEntryId: string): Promise<void> {
  try {
    await prisma.moderationAction.updateMany({
      where: { id: massnahmeId, discordAuditLogEntryId: null },
      data: { discordAuditLogEntryId: auditEntryId, detectedAt: new Date() },
    });
  } catch (error) {
    // Der Eintrag haengt bereits an einer anderen Zeile. Kein Fehler: der
    // Vorgang ist dann ohnehin verarbeitet.
    log.debug('moderation.discord.deduplicated', { massnahmeId, error });
  }
}

/** Die Metadaten eines externen Vorgangs - knapp und begrenzt. */
function metadatenFuer(
  massnahme: ExterneMassnahme,
  eintrag: AuditLogEntry | null,
): Record<string, unknown> {
  const basis: Record<string, unknown> = {
    // Ausdruecklich mitgefuehrt, weil bis heute jede Zeile diesen Schluessel
    // im Metadaten-JSON trug und Auswertungen darauf zugreifen. Die Spalte
    // `source` ist die massgebliche Angabe; hier steht sie ein zweites Mal,
    // damit alte Auswertungen weiter funktionieren.
    source: 'DISCORD',
    ...(eintrag ? { discordAuditLogEntryId: eintrag.id } : {}),
    ...(eintrag?.reason ? { reasonSource: 'DISCORD_AUDIT_LOG' } : {}),
  };

  const vorgang = massnahme.vorgang;
  if (vorgang.art === 'TIMEOUT') {
    basis.timeoutUntil = vorgang.bis.toISOString();
  } else if (vorgang.art === 'TIMEOUT_UPDATE') {
    basis.previousTimeoutUntil = vorgang.vorher.toISOString();
    basis.timeoutUntil = vorgang.bis.toISOString();
  } else if (vorgang.art === 'TIMEOUT_REMOVE') {
    basis.previousTimeoutUntil = vorgang.vorher.toISOString();
  }

  return basis;
}

/** Das geplante Ende - nur, wo es eines gibt. */
function ablaufFuer(vorgang: ExternerVorgang): Date | null {
  if (vorgang.art === 'TIMEOUT' || vorgang.art === 'TIMEOUT_UPDATE') {
    return vorgang.bis;
  }
  return null;
}

/**
 * Erfasst eine Massnahme, die nicht ueber SwissHub ausgeloest wurde.
 *
 * Die ganze Kette in einer Funktion, weil ihre Schritte nur zusammen richtig
 * sind: das Audit Log befragen, gegen die eigenen Zeilen abgleichen, und erst
 * dann - oder eben nicht - schreiben.
 */
export async function erfasseExterneMassnahme(
  massnahme: ExterneMassnahme,
  options: ExternOptions = {},
): Promise<ErfassungsErgebnis> {
  const art = massnahme.vorgang.art;
  log.debug('moderation.discord.detected', { art, target: massnahme.targetDiscordId });

  const befund: AuditBefund = await findeAuditEintrag(
    {
      actionType: AUDIT_TYP[art],
      targetId: massnahme.targetDiscordId,
      occurredAt: massnahme.occurredAt,
    },
    options,
  );

  const eintrag = befund.status === 'gefunden' ? befund.eintrag : null;

  if (eintrag) {
    log.debug('moderation.discord.audit_matched', { art, versuche: befund.versuche });
  } else {
    log.debug('moderation.discord.audit_unmatched', { art, status: befund.status });
  }

  return verarbeite(massnahme, eintrag, befund.status);
}

/**
 * Der Teil nach der Audit-Suche.
 *
 * Getrennt, weil es zwei Wege hierher gibt: das Gateway-Ereignis, das den
 * Eintrag erst suchen muss, und der Abgleichlauf, der ihn schon hat. Ab hier
 * ist beides dasselbe - und muss es sein, sonst gaelten fuer den einen Weg
 * andere Regeln als fuer den anderen.
 */
async function verarbeite(
  massnahme: ExterneMassnahme,
  eintrag: AuditLogEntry | null,
  befundStatus: AuditBefund['status'],
): Promise<ErfassungsErgebnis> {
  const art = massnahme.vorgang.art;

  // --- Kick: ohne Beleg wird daraus nichts ---------------------------------
  //
  // Ein Austritt ohne passenden Audit-Eintrag ist ein freiwilliges Gehen. Ihn
  // als Kick zu fuehren waere eine Behauptung ueber einen Menschen, die sich
  // nicht belegen laesst - und sie stuende dauerhaft in seiner Akte.
  if (!OHNE_BELEG_ERFASSBAR.has(art) && !eintrag) {
    const grund: VerwerfGrund =
      befundStatus === 'nicht-abrufbar' ? 'kick-unbelegt' : 'freiwilliger-austritt';
    log.debug('moderation.discord.audit_unmatched', { art, grund });
    return { ergebnis: 'verworfen', grund };
  }

  const type: ModerationActionType = art;
  // Der Zeitpunkt der Massnahme: Discords eigener, wo bekannt. Er ist
  // stabiler als der Empfang des Gateway-Ereignisses.
  const zeitpunkt = eintrag?.createdAt ?? massnahme.occurredAt;

  // --- Schon einmal verarbeitet? -------------------------------------------
  if (eintrag) {
    const bekannt = await prisma.moderationAction.findUnique({
      where: { discordAuditLogEntryId: eintrag.id },
      select: { id: true },
    });
    if (bekannt) {
      log.debug('moderation.discord.deduplicated', { art, auditEntry: eintrag.id });
      return { ergebnis: 'bereits-verarbeitet' };
    }
  }

  // --- War es SwissHub selbst? ---------------------------------------------
  const vonEigenemBot = Boolean(
    massnahme.eigeneBotId && eintrag?.userId && eintrag.userId === massnahme.eigeneBotId,
  );

  const bestehend = await findeSwissHubMassnahme({
    type,
    targetDiscordId: massnahme.targetDiscordId,
    zeitpunkt,
  });

  if (bestehend) {
    if (eintrag) {
      await belegeMassnahme(bestehend.id, eintrag.id);
    }
    log.debug('moderation.discord.deduplicated', { art, massnahmeId: bestehend.id });
    return { ergebnis: 'abgeglichen', massnahmeId: bestehend.id };
  }

  if (vonEigenemBot) {
    // Der eigene Bot hat gehandelt, aber die zugehoerige Zeile ist nicht zu
    // finden. Sie wird gerade geschrieben - jeder Weg, der den Bot handeln
    // laesst, schreibt sie unmittelbar danach. Eine eigene Zeile anzulegen
    // hiesse, genau das Doppel zu erzeugen, das hier verhindert werden soll.
    log.info('moderation.discord.deduplicated', {
      art,
      grund: 'eigener Bot ohne zugehoerige Zeile',
    });
    return { ergebnis: 'verworfen', grund: 'eigener-bot-ohne-zeile' };
  }

  // --- Erfassen ------------------------------------------------------------
  const actorType: ModerationActorType = eintrag?.userId
    ? eintrag.bot
      ? 'BOT'
      : 'HUMAN'
    : 'UNKNOWN';
  const source: ModerationSource = 'DISCORD';

  try {
    const zeile = await prisma.moderationAction.create({
      data: {
        type,
        module: 'moderation',
        actorDiscordId: eintrag?.userId ?? 'unknown',
        actorUsername: eintrag?.username
          ? sanitizeText(eintrag.username, NAME_MAX)
          : 'Unbekannt',
        actorType,
        targetDiscordId: massnahme.targetDiscordId,
        targetUsername: sanitizeText(massnahme.targetUsername, NAME_MAX) || 'Unbekannt',
        reason: grundAus(eintrag),
        status: 'COMPLETED',
        source,
        discordAuditLogEntryId: eintrag?.id ?? null,
        detectedAt: new Date(),
        expiresAt: ablaufFuer(massnahme.vorgang),
        metadata: metadatenFuer(massnahme, eintrag) as Prisma.InputJsonValue,
        createdAt: zeitpunkt,
      },
    });

    log.info('moderation.discord.persisted', { art, id: zeile.id, actorType });

    // Auch das SwissHub-Audit-Log haelt fest, dass wir eine fremde Massnahme
    // bemerkt haben - eine andere Frage als die der Akte, und deshalb ein
    // eigener Eintrag.
    await safeRecordAudit({
      action: AUDIT_ACTIONS.MODERATION_EXTERNAL_ACTION_DETECTED,
      module: 'moderation',
      actorDiscordId: eintrag?.userId ?? null,
      actorUsername: eintrag?.username ? sanitizeText(eintrag.username, NAME_MAX) : null,
      targetDiscordId: massnahme.targetDiscordId,
      targetLabel: sanitizeText(massnahme.targetUsername, NAME_MAX) || null,
      metadata: {
        actionType: type,
        source,
        actorType,
        ...(eintrag ? { discordAuditLogEntryId: eintrag.id } : {}),
        ...(grundAus(eintrag) ? { reason: grundAus(eintrag) } : {}),
      },
    });

    // Dasselbe fachliche Ereignis wie bei einer Massnahme aus dem Dashboard -
    // mit `quelle: 'DISCORD'`. Automationen, Kennzahlen und spaetere
    // Auswertungen sehen dadurch beide Welten, ohne davon zu wissen.
    await meldeMassnahme(zeile);

    return { ergebnis: 'erfasst', massnahme: zeile };
  } catch (error) {
    // Eindeutigkeitsverletzung auf `discordAuditLogEntryId`: ein zweiter Lauf
    // war schneller. Genau dafuer ist die Bedingung da.
    if (istEindeutigkeitsfehler(error)) {
      log.debug('moderation.discord.deduplicated', { art, grund: 'gleichzeitiger Lauf' });
      return { ergebnis: 'bereits-verarbeitet' };
    }
    throw error;
  }
}

/**
 * Verarbeitet einen Audit-Eintrag, der bereits vorliegt.
 *
 * Der Weg des Abgleichlaufs. Er hat den Eintrag schon in der Hand und muss
 * ihn nicht suchen - ab dann gilt fuer ihn dasselbe wie fuer ein
 * Gateway-Ereignis, einschliesslich der Abgleiche und der Eindeutigkeit.
 *
 * Der Name der betroffenen Person steht im Audit-Eintrag nicht; Discord
 * nennt dort nur ihre Kennung. Er bleibt deshalb «Unbekannt», statt dafuer
 * eine zusaetzliche Anfrage je Eintrag zu stellen - die Kennung ist die
 * Identitaet, der Name nur die Beschriftung.
 */
export async function erfasseAusAuditEintrag(
  eintrag: AuditLogEntry,
  vorgang: ExternerVorgang,
  eigeneBotId: string | null,
): Promise<ErfassungsErgebnis> {
  if (!eintrag.targetId) {
    return { ergebnis: 'verworfen', grund: 'freiwilliger-austritt' };
  }
  return verarbeite(
    {
      vorgang,
      targetDiscordId: eintrag.targetId,
      targetUsername: 'Unbekannt',
      occurredAt: eintrag.createdAt,
      eigeneBotId,
    },
    eintrag,
    'gefunden',
  );
}

/** Prisma meldet eine verletzte Eindeutigkeit als `P2002`. */
function istEindeutigkeitsfehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Ordnet eine Timeout-Aenderung ein.
 *
 * `null -> 22:00` ist ein neuer Timeout, `22:00 -> 23:00` eine Aenderung,
 * `22:00 -> null` eine Aufhebung.
 *
 * ## Der Ablauf ist keine Aufhebung
 *
 * Laeuft ein Timeout einfach ab, verschwindet das Feld ebenfalls - und es
 * saehe aus wie «jemand hat den Timeout aufgehoben». Es hat aber niemand
 * gehandelt, und in der Akte stuende eine Massnahme, die nie jemand ergriffen
 * hat.
 *
 * Unterschieden wird am Zeitpunkt: war die Frist bereits verstrichen, ist sie
 * abgelaufen; lag sie noch in der Zukunft, hat jemand sie beendet. Deshalb
 * braucht diese Funktion die aktuelle Zeit - und nimmt sie als Parameter,
 * damit sie pruefbar bleibt.
 */
export function ordneTimeoutEin(
  vorher: Date | null,
  nachher: Date | null,
  jetzt: Date = new Date(),
): ExternerVorgang | null {
  if (vorher?.getTime() === nachher?.getTime()) {
    return null;
  }
  if (nachher && !vorher) {
    return { art: 'TIMEOUT', bis: nachher };
  }
  if (nachher && vorher) {
    return { art: 'TIMEOUT_UPDATE', vorher, bis: nachher };
  }
  if (vorher && !nachher) {
    // Abgelaufen, nicht aufgehoben - niemand hat gehandelt.
    if (vorher.getTime() <= jetzt.getTime()) {
      return null;
    }
    return { art: 'TIMEOUT_REMOVE', vorher };
  }
  return null;
}
