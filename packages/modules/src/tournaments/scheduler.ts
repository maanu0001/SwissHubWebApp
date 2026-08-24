import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from './config';
import { ZEITSTEUERUNG, tournamentEvent } from './events';
import { setTournamentStatus } from './service';
import { closeCheckin } from './checkin';
import { expireInvites } from './teams';
import {
  announce,
  matchMeldung,
  purgeMatchChannels,
  reconcileResources,
  sendeCheckinAufruf,
} from './discord';

const logger = createLogger('tournaments:scheduler');

/**
 * Was das Turniermodul regelmaessig erledigt.
 *
 * Alles im bestehenden Job-Runner des Bots - es gibt keinen zweiten
 * Zeitplaner. Jeder Durchgang ist idempotent: bleibt einer aus, holt der
 * naechste ihn nach, und zweimal ausgefuehrt aendert er nichts. Deshalb steht
 * jede gesendete Ankuendigung in `TournamentAnnouncement`, und jeder
 * Statuswechsel geht durch `setTournamentStatus`.
 *
 * Ausdruecklich keine Zeitgeber im Arbeitsspeicher: ein Neustart wuerde sie
 * verlieren, und ein Check-in, der nie oeffnet, faellt erst auf, wenn alle
 * warten.
 */

/**
 * Zeitgesteuerte Phasenwechsel.
 *
 * Anmeldung schliessen, Check-in oeffnen und schliessen - alles, was am
 * Kalender haengt und nicht daran, dass jemand einen Knopf drueckt.
 */
export async function runPhasenwechsel(jetzt = new Date()): Promise<{ gewechselt: number }> {
  let gewechselt = 0;

  // --- Anmeldung schliessen -------------------------------------------
  const anmeldeschluss = await prisma.tournament.findMany({
    where: {
      status: 'REGISTRATION_OPEN',
      registrationClosesAt: { not: null, lte: jetzt },
    },
    select: { id: true },
  });
  for (const tournament of anmeldeschluss) {
    await setTournamentStatus(tournament.id, 'REGISTRATION_CLOSED', ZEITSTEUERUNG);
    await announce(tournament.id, 'REGISTRATION_CLOSED');
    gewechselt += 1;
  }

  // --- Check-in oeffnen -----------------------------------------------
  const checkinStart = await prisma.tournament.findMany({
    where: {
      status: 'REGISTRATION_CLOSED',
      checkinRequired: true,
      checkinOpensAt: { not: null, lte: jetzt },
    },
    select: { id: true },
  });
  for (const tournament of checkinStart) {
    await setTournamentStatus(tournament.id, 'CHECKIN_OPEN', ZEITSTEUERUNG);
    // Der Aufruf mit Knopf statt einer gewoehnlichen Ankuendigung: der Knopf
    // ist der Grund, warum die Nachricht existiert.
    await sendeCheckinAufruf(tournament.id);
    gewechselt += 1;
  }

  // --- Check-in schliessen --------------------------------------------
  const checkinEnde = await prisma.tournament.findMany({
    where: { status: 'CHECKIN_OPEN', checkinClosesAt: { not: null, lte: jetzt } },
    select: { id: true },
  });
  for (const tournament of checkinEnde) {
    await closeCheckin(tournament.id, ZEITSTEUERUNG);
    await setTournamentStatus(tournament.id, 'CHECKIN_CLOSED', ZEITSTEUERUNG);
    gewechselt += 1;
  }

  if (gewechselt > 0) {
    logger.info('Turnierphasen gewechselt', { anzahl: gewechselt });
  }
  return { gewechselt };
}

/**
 * Erinnerungen.
 *
 * Jede Art wird je Turnier genau einmal gesendet - der Eintrag in
 * `TournamentAnnouncement` sorgt dafuer. Ohne ihn schickte ein zweimal
 * laufender Durchgang dieselbe Erinnerung zweimal.
 */
export async function runReminders(jetzt = new Date()): Promise<{ gesendet: number }> {
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  if (!settings.remindersEnabled) {
    return { gesendet: 0 };
  }

  let gesendet = 0;

  // --- Vor Anmeldeschluss ---------------------------------------------
  const stunden = [...settings.reminderHoursBeforeRegistrationClose].sort((a, b) => a - b);
  const kleinste = stunden[0];
  if (kleinste !== undefined) {
    const bald = await prisma.tournament.findMany({
      where: {
        status: 'REGISTRATION_OPEN',
        registrationClosesAt: {
          not: null,
          gt: jetzt,
          lte: new Date(jetzt.getTime() + kleinste * 3600_000),
        },
      },
      select: { id: true },
    });
    for (const tournament of bald) {
      if (await announce(tournament.id, 'REGISTRATION_CLOSING')) {
        gesendet += 1;
      }
    }
  }

  // --- Vor Check-in-Ende ----------------------------------------------
  if (settings.reminderMinutesBeforeCheckinClose > 0) {
    const bald = await prisma.tournament.findMany({
      where: {
        status: 'CHECKIN_OPEN',
        checkinClosesAt: {
          not: null,
          gt: jetzt,
          lte: new Date(jetzt.getTime() + settings.reminderMinutesBeforeCheckinClose * 60_000),
        },
      },
      select: { id: true },
    });
    for (const tournament of bald) {
      if (await announce(tournament.id, 'CHECKIN_REMINDER')) {
        gesendet += 1;
      }
    }
  }

  // --- Vor einem Match ------------------------------------------------
  if (settings.reminderMinutesBeforeMatch > 0) {
    const matches = await prisma.tournamentMatch.findMany({
      where: {
        status: { in: ['SCHEDULED', 'READY'] },
        discordChannelId: { not: null },
        channelMissing: false,
        scheduledAt: {
          not: null,
          gt: jetzt,
          lte: new Date(jetzt.getTime() + settings.reminderMinutesBeforeMatch * 60_000),
        },
        tournament: { status: 'RUNNING' },
      },
      select: { id: true, matchNumber: true, scheduledAt: true, tournamentId: true },
      take: 100,
    });

    for (const match of matches) {
      // Die Erinnerung steht im Match-Kanal und nicht in der Ankuendigung:
      // sie betrifft zwei Teams, nicht den ganzen Server. Ein Eintrag im
      // Turnierverlauf verhindert die Wiederholung.
      const schonGesendet = await prisma.tournamentAnnouncement.findUnique({
        where: {
          tournamentId_kind: { tournamentId: match.tournamentId, kind: `MATCH_REMINDER:${match.id}` },
        },
      });
      if (schonGesendet) {
        continue;
      }

      await matchMeldung(
        match.id,
        `⏰ Match #${match.matchNumber} beginnt <t:${Math.floor((match.scheduledAt?.getTime() ?? 0) / 1000)}:R>.`,
      );
      await prisma.tournamentAnnouncement.create({
        data: { tournamentId: match.tournamentId, kind: `MATCH_REMINDER:${match.id}` },
      });
      gesendet += 1;
    }
  }

  if (gesendet > 0) {
    logger.info('Turnier-Erinnerungen gesendet', { anzahl: gesendet });
  }
  return { gesendet };
}

/**
 * Ueberfaellige Matches melden.
 *
 * Ein Match ohne Resultat blockiert die ganze Runde. Ohne diesen Durchgang
 * merkt es die Leitung erst, wenn sich jemand beschwert - und dann warten
 * schon vier andere Teams.
 */
export async function findeUeberfaellige(
  jetzt = new Date(),
): Promise<Array<{ id: string; matchNumber: number; tournamentId: string; seitMinuten: number }>> {
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  const grenze = new Date(jetzt.getTime() - settings.overdueResultMinutes * 60_000);

  const matches = await prisma.tournamentMatch.findMany({
    where: {
      status: { in: ['LIVE', 'AWAITING_RESULT'] },
      startedAt: { not: null, lt: grenze },
      tournament: { status: 'RUNNING' },
    },
    select: { id: true, matchNumber: true, tournamentId: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
    take: 100,
  });

  return matches.map((match) => ({
    id: match.id,
    matchNumber: match.matchNumber,
    tournamentId: match.tournamentId,
    seitMinuten: Math.round((jetzt.getTime() - (match.startedAt?.getTime() ?? 0)) / 60_000),
  }));
}

/**
 * Aufraeumen und abgleichen.
 *
 * Faellige Match-Kanaele entfernen, verschwundene Ressourcen erkennen,
 * abgelaufene Team-Einladungen schliessen. Alles harmlos, wenn es doppelt
 * laeuft.
 */
export async function runTournamentMaintenance(): Promise<{
  kanaeleEntfernt: number;
  ressourcenFehlend: number;
  einladungenAbgelaufen: number;
}> {
  const kanaeleEntfernt = await purgeMatchChannels();
  const { fehlend: ressourcenFehlend } = await reconcileResources();
  const einladungenAbgelaufen = await expireInvites();

  return { kanaeleEntfernt, ressourcenFehlend, einladungenAbgelaufen };
}

/**
 * Ein Durchgang der Zeitsteuerung.
 *
 * Mit der Modulpruefung davor: ist das Modul ausgeschaltet, soll es auch
 * keine Kanaele loeschen und keine Phasen wechseln. Ein ausgeschaltetes
 * Modul, das im Hintergrund weiterarbeitet, ist genau die Ueberraschung, die
 * niemand sucht.
 */
export async function runTournamentTick(jetzt = new Date()): Promise<void> {
  if (!(await isModuleEnabled(TOURNAMENTS_MODULE_ID))) {
    return;
  }

  await runPhasenwechsel(jetzt);
  await runReminders(jetzt);
  await runTournamentMaintenance();

  // Ueberfaellige Matches nur vermerken, nicht selbsttaetig entscheiden: ein
  // Match, das ein Team ohne Rueckfrage verliert, weil eine Uhr ablief, ist
  // keine Turnierleitung.
  const ueberfaellig = await findeUeberfaellige(jetzt);
  for (const match of ueberfaellig) {
    const schonGemeldet = await prisma.tournamentEvent.findFirst({
      where: {
        tournamentId: match.tournamentId,
        kind: 'MATCH_SCHEDULED',
        detail: { path: ['ueberfaellig'], equals: match.id },
      },
    });
    if (schonGemeldet) {
      continue;
    }
    await tournamentEvent(match.tournamentId, 'MATCH_SCHEDULED', ZEITSTEUERUNG, {
      ueberfaellig: match.id,
      match: match.matchNumber,
      seitMinuten: match.seitMinuten,
    });
  }
}
