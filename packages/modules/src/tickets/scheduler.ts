import { prisma } from '@swisshub/database';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { TICKETS_MODULE_ID, type TicketSettings } from './config';
import { systemMeldung } from './discord';
import { closeTicket, purgeDueChannels, reconcileChannels } from './lifecycle';
import { reconcilePanels } from './panels';
import { purgeExpiredTranscripts } from './transcript';

const logger = createLogger('tickets:scheduler');

/** Wer die Zeitsteuerung ist, wenn sie selbst handelt. */
const ZEITSTEUERUNG = {
  discordId: 'system',
  username: 'Zeitsteuerung',
  source: 'SYSTEM' as const,
};

const TAG_MS = 24 * 3600_000;

/**
 * Was das Ticket-Modul regelmaessig erledigt.
 *
 * Alles laeuft im bestehenden Job-Runner des Bots - es gibt keinen zweiten
 * Zeitplaner. Jeder Durchgang ist idempotent: bleibt einer aus, holt der
 * naechste ihn nach, und zweimal ausgefuehrt aendert er nichts.
 */

/**
 * An eine Antwort erinnern.
 *
 * Gilt nur fuer Tickets, die auf das Mitglied warten. Ein Ticket, das auf
 * den Support wartet, ist nicht das Problem des Mitglieds - es dort zu
 * mahnen waere die falsche Richtung.
 */
export async function runTicketReminders(jetzt = new Date()): Promise<{ erinnert: number }> {
  const kategorien = await prisma.ticketCategory.findMany({
    where: { active: true, reminderAfterDays: { gt: 0 } },
    select: { id: true, reminderAfterDays: true },
  });
  if (kategorien.length === 0) {
    return { erinnert: 0 };
  }

  let erinnert = 0;
  for (const kategorie of kategorien) {
    const grenze = new Date(jetzt.getTime() - kategorie.reminderAfterDays * TAG_MS);

    const faellig = await prisma.ticket.findMany({
      where: {
        categoryId: kategorie.id,
        status: 'WAITING_FOR_USER',
        // Seit der letzten Nachricht ist die Frist verstrichen ...
        lastMessageAt: { lt: grenze },
        // ... und seit der letzten Erinnerung ebenfalls.
        OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: grenze } }],
      },
      select: { id: true, creatorDiscordId: true, ticketNumber: true },
      take: 100,
    });

    for (const ticket of faellig) {
      // Zuerst vermerken, dann melden: eine doppelte Erinnerung ist
      // aergerlicher als eine, die nach einem Absturz ausbleibt.
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { reminderSentAt: jetzt },
      });
      await systemMeldung(
        ticket.id,
        `<@${ticket.creatorDiscordId}> Dieses Ticket wartet noch auf deine Antwort. Ohne Rückmeldung wird es später automatisch geschlossen.`,
      );
      erinnert += 1;
    }
  }

  if (erinnert > 0) {
    logger.info('An Ticket-Antworten erinnert', { anzahl: erinnert });
  }
  return { erinnert };
}

/**
 * Tickets schliessen, in denen seit Tagen nichts geschieht.
 *
 * Nur solche, die auf das Mitglied warten und deren Kategorie es ausdruecklich
 * vorsieht. Ein Ticket, das auf den Support wartet, wird nie selbsttaetig
 * geschlossen - das waere kein Aufraeumen, sondern Wegsehen.
 */
export async function runTicketAutoClose(jetzt = new Date()): Promise<{ geschlossen: number }> {
  const kategorien = await prisma.ticketCategory.findMany({
    where: { active: true, autoCloseAfterDays: { gt: 0 } },
    select: { id: true, autoCloseAfterDays: true },
  });
  if (kategorien.length === 0) {
    return { geschlossen: 0 };
  }

  let geschlossen = 0;
  for (const kategorie of kategorien) {
    const grenze = new Date(jetzt.getTime() - kategorie.autoCloseAfterDays * TAG_MS);

    const faellig = await prisma.ticket.findMany({
      where: {
        categoryId: kategorie.id,
        status: 'WAITING_FOR_USER',
        lastMessageAt: { lt: grenze },
      },
      select: { id: true, ticketNumber: true, creatorDiscordId: true },
      take: 50,
    });

    for (const ticket of faellig) {
      try {
        await closeTicket(
          ticket.id,
          `Ohne Rückmeldung seit ${kategorie.autoCloseAfterDays} Tagen automatisch geschlossen.`,
          ZEITSTEUERUNG,
        );
        await safeRecordAudit({
          action: AUDIT_ACTIONS.TICKET_AUTO_CLOSED,
          module: TICKETS_MODULE_ID,
          actorUsername: ZEITSTEUERUNG.username,
          targetDiscordId: ticket.creatorDiscordId,
          targetLabel: `Ticket #${ticket.ticketNumber}`,
          success: true,
        });
        geschlossen += 1;
      } catch (fehler) {
        logger.warn('Ticket konnte nicht selbsttätig geschlossen werden', {
          ticketId: ticket.id,
          grund: fehler instanceof Error ? fehler.message : 'unbekannt',
        });
      }
    }
  }

  if (geschlossen > 0) {
    logger.info('Tickets selbsttätig geschlossen', { anzahl: geschlossen });
  }
  return { geschlossen };
}

/**
 * Aufraeumen und abgleichen.
 *
 * Faellige Kanaele entfernen, fehlende Kanaele und Panels erkennen,
 * abgelaufene Transcripts loeschen. Alles harmlos, wenn es doppelt laeuft.
 */
export async function runTicketMaintenance(): Promise<{
  kanaeleEntfernt: number;
  kanaeleFehlend: number;
  panelsFehlend: number;
  transcriptsEntfernt: number;
}> {
  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);

  const kanaeleEntfernt = await purgeDueChannels();
  const { fehlend: kanaeleFehlend } = await reconcileChannels();
  const { fehlend: panelsFehlend } = await reconcilePanels();
  const transcriptsEntfernt = await purgeExpiredTranscripts(settings.transcriptRetentionDays);

  if (kanaeleFehlend > 0 || panelsFehlend > 0) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_RECONCILED,
      module: TICKETS_MODULE_ID,
      actorUsername: ZEITSTEUERUNG.username,
      success: true,
      metadata: { kanaeleFehlend, panelsFehlend },
    });
  }
  if (transcriptsEntfernt > 0) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_RETENTION_PURGED,
      module: TICKETS_MODULE_ID,
      actorUsername: ZEITSTEUERUNG.username,
      success: true,
      metadata: { anzahl: transcriptsEntfernt, tage: settings.transcriptRetentionDays },
    });
  }

  return { kanaeleEntfernt, kanaeleFehlend, panelsFehlend, transcriptsEntfernt };
}

/**
 * Ein Durchgang der Zeitsteuerung.
 *
 * Bewusst mit der Modulpruefung davor: ist das Modul ausgeschaltet, soll es
 * auch keine Kanaele loeschen und keine Tickets schliessen. Ein
 * ausgeschaltetes Modul, das im Hintergrund weiterarbeitet, ist genau die
 * Ueberraschung, die niemand sucht.
 */
export async function runTicketTick(jetzt = new Date()): Promise<void> {
  if (!(await isModuleEnabled(TICKETS_MODULE_ID))) {
    return;
  }
  await runTicketReminders(jetzt);
  await runTicketAutoClose(jetzt);
  await runTicketMaintenance();
}
