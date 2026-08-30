import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { APPEALS_MODULE_ID, type AppealsSettings } from './config';
import { formatFallnummer } from './numbering';
import { schreibeEreignis } from './service';
import { OFFENE_STATUS } from './status';

const logger = createLogger('appeals:maintenance');

/**
 * Die Wartung offener Anträge.
 *
 * Zwei Dinge geschehen ausserhalb des Antrags und müssen trotzdem in ihm
 * ankommen:
 *
 * 1. **Jemand hebt den Bann von Hand auf (§28).** Der Antrag läuft dann ins
 *    Leere - er bezieht sich auf etwas, das es nicht mehr gibt. Das System
 *    erkennt es und sagt es, statt eine Entscheidung über einen
 *    gegenstandslosen Fall zu erzwingen.
 * 2. **Der Antragsteller antwortet nicht (§44).** Nach der eingestellten
 *    Frist läuft der Antrag ab. Vorher gibt es keine stille Löschung: der Fall
 *    bleibt lesbar, er ist nur abgeschlossen.
 *
 * Beides läuft über den Job-Takt des Bots und ist neustartsicher, weil der
 * Zustand in der Datenbank steht und nicht in einem Zeitgeber.
 */

export interface WartungsErgebnis {
  externAufgehoben: number;
  abgelaufen: number;
  anhaengeEntfernt: number;
}

/**
 * Anträge, deren Bann nicht mehr besteht.
 *
 * Nur eine begrenzte Zahl je Durchgang: die Prüfung ist eine Discord-Anfrage
 * je Antrag, und bei fünfzig offenen Anträgen wären das fünfzig Anfragen im
 * Minutentakt. Der Rest kommt im nächsten Durchgang.
 */
export async function erkenneExterneEntbannung(
  optionen: { gateway?: DiscordGateway; limit?: number; jetzt?: Date } = {},
): Promise<number> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const jetzt = optionen.jetzt ?? new Date();

  const offene = await prisma.appeal.findMany({
    where: { status: { in: [...OFFENE_STATUS] } },
    orderBy: { updatedAt: 'asc' },
    take: optionen.limit ?? 10,
  });

  let erkannt = 0;
  for (const appeal of offene) {
    let bann: { discordId: string; reason: string | null } | null;
    try {
      bann = await gateway.bans.get(appeal.applicantDiscordId);
    } catch (error) {
      // Discord antwortet nicht. Kein Schluss daraus - «keine Antwort» ist
      // nicht «kein Bann». Der nächste Durchgang versucht es erneut.
      logger.debug('Bannprüfung fehlgeschlagen', { appealId: appeal.id, error });
      continue;
    }
    if (bann) {
      continue;
    }

    // Den Zuschlag unter Bedingung holen: zwei Bot-Instanzen sollen den Fall
    // nicht zweimal umschreiben.
    const ergebnis = await prisma.appeal.updateMany({
      where: { id: appeal.id, status: appeal.status },
      data: {
        status: 'RESOLVED_EXTERNALLY',
        closedAt: jetzt,
        version: { increment: 1 },
      },
    });
    if (ergebnis.count === 0) {
      continue;
    }

    await schreibeEreignis({
      appealId: appeal.id,
      kind: 'SANCTION_LIFTED_EXTERNALLY',
      // Der Antragsteller darf das erfahren - es betrifft ihn unmittelbar.
      visibility: 'PUBLIC',
      publicLabel: 'Dein Bann wurde bereits aufgehoben',
      detail: { hinweis: 'Der zugrundeliegende Bann besteht nicht mehr.' },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.APPEAL_CLOSED,
      module: APPEALS_MODULE_ID,
      actorDiscordId: 'system',
      actorUsername: 'Entbannungsanträge',
      targetDiscordId: appeal.applicantDiscordId,
      targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      metadata: { appealId: appeal.id, grund: 'Bann ausserhalb des Antrags aufgehoben' },
    });

    logger.info('Antrag ohne Gegenstand geschlossen', { appealId: appeal.id });
    erkannt += 1;
  }

  return erkannt;
}

/**
 * Anträge ohne Antwort schliessen (§44).
 *
 * `waitingUntil` steht in der Datenbank, seit die Rückfrage gestellt wurde.
 * Ein Neustart verliert die Frist deshalb nicht - anders als ein Zeitgeber im
 * Arbeitsspeicher.
 */
export async function schliesseAbgelaufene(jetzt = new Date()): Promise<number> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  if (settings.ablaufTageOhneAntwort <= 0) {
    return 0;
  }

  const faellig = await prisma.appeal.findMany({
    where: {
      status: 'WAITING_FOR_APPLICANT',
      waitingUntil: { not: null, lte: jetzt },
    },
    take: 50,
  });

  let abgelaufen = 0;
  for (const appeal of faellig) {
    const ergebnis = await prisma.appeal.updateMany({
      where: { id: appeal.id, status: 'WAITING_FOR_APPLICANT' },
      data: { status: 'EXPIRED', closedAt: jetzt, version: { increment: 1 } },
    });
    if (ergebnis.count === 0) {
      continue;
    }

    await schreibeEreignis({
      appealId: appeal.id,
      kind: 'EXPIRED',
      visibility: 'PUBLIC',
      publicLabel: 'Antrag mangels Antwort abgelaufen',
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.APPEAL_EXPIRED,
      module: APPEALS_MODULE_ID,
      actorDiscordId: 'system',
      actorUsername: 'Entbannungsanträge',
      targetDiscordId: appeal.applicantDiscordId,
      targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      metadata: { appealId: appeal.id },
    });

    abgelaufen += 1;
  }

  if (abgelaufen > 0) {
    logger.info('Anträge ohne Antwort abgelaufen', { anzahl: abgelaufen });
  }
  return abgelaufen;
}

/** Ein Durchgang der Wartung - vom Bot getaktet. */
export async function wartung(
  optionen: { gateway?: DiscordGateway; jetzt?: Date } = {},
): Promise<WartungsErgebnis> {
  if (!(await isModuleEnabled(APPEALS_MODULE_ID))) {
    return { externAufgehoben: 0, abgelaufen: 0, anhaengeEntfernt: 0 };
  }

  const { raeumeAnhaenge } = await import('./attachments');
  return {
    externAufgehoben: await erkenneExterneEntbannung(optionen),
    abgelaufen: await schliesseAbgelaufene(optionen.jetzt),
    anhaengeEntfernt: await raeumeAnhaenge(optionen.jetzt),
  };
}
