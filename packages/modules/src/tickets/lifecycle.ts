import { prisma } from '@swisshub/database';
import type { Ticket } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { discord, DiscordApiError, DISCORD_PERMISSIONS, resolveGuildId } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { TICKETS_MODULE_ID, type TicketSettings } from './config';
import type { TicketActor } from './service';
import { systemMeldung } from './discord';
import { ensureTranscripts } from './transcript';

const logger = createLogger('tickets:lifecycle');

/**
 * Wie lange der Kanal nach dem Schliessen stehen bleibt.
 *
 * `DELETE_IMMEDIATELY` sind fuenf Sekunden, nicht null. Der Unterschied ist
 * sichtbar: bei null verschwindet der Kanal im selben Moment, in dem jemand
 * auf «Schliessen» klickt - die Abschlussmeldung liest dann niemand mehr, und
 * es sieht nach einem Absturz aus. Fuenf Sekunden reichen, um zu sehen, dass
 * das Ticket abgeschlossen wurde, und sind kurz genug, dass niemand darauf
 * wartet.
 */
export const KANAL_LOESCHVERZOEGERUNG_MS = 5_000;

const AUFBEWAHRUNG_MS: Record<TicketSettings['closeBehaviour'], number | null> = {
  DELETE_IMMEDIATELY: KANAL_LOESCHVERZOEGERUNG_MS,
  KEEP_24H: 24 * 3600_000,
  KEEP_7D: 7 * 24 * 3600_000,
  KEEP_FOREVER: null,
};

/**
 * Ein Ticket schliessen.
 *
 * Der Kanal wird standardmaessig NICHT sofort geloescht, sondern nur
 * stummgeschaltet. Sofortiges Loeschen nimmt dem Mitglied jede Moeglichkeit,
 * die Antwort nochmals zu lesen - und dem Team jede Moeglichkeit, einen
 * Fehlgriff zu bemerken, bevor die Spuren weg sind. Wann geloescht wird,
 * entscheidet die Einstellung; der Aufraeumer holt es spaeter nach.
 */
export async function closeTicket(
  ticketId: string,
  reason: string | null,
  actor: TicketActor,
): Promise<Ticket> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (ticket.closedAt) {
    return ticket;
  }

  const settings = await getModuleSettings<TicketSettings>(TICKETS_MODULE_ID);
  const aufbewahrung = AUFBEWAHRUNG_MS[settings.closeBehaviour];

  // Der Abschluss wird beansprucht, nicht bloss geschrieben.
  //
  // Zwei Wege fuehren hierher - der Knopf im Dashboard und der Knopf auf
  // Discord -, und sie koennen sich in derselben Sekunde treffen. Die
  // Abfrage oben verhindert das nicht: beide lesen dann ein offenes Ticket
  // und beide schreiben. Das Ergebnis waere zweimal alles - zwei
  // Abschlussmeldungen im Kanal, zwei Ereignisse im Verlauf, zwei
  // Aufraeumauftraege.
  //
  // `closedAt: null` in der Bedingung entscheidet das in der Datenbank: genau
  // ein Aufruf aktualisiert eine Zeile, der andere keine und kehrt mit dem
  // bereits geschlossenen Ticket zurueck, ohne etwas anzustossen.
  const jetzt = new Date();
  const beansprucht = await prisma.ticket.updateMany({
    where: { id: ticketId, closedAt: null },
    data: {
      status: 'CLOSED',
      closedAt: jetzt,
      closedByDiscordId: actor.discordId,
      closeReason: reason?.slice(0, 500) ?? null,
      channelPurgeAt: aufbewahrung === null ? null : new Date(jetzt.getTime() + aufbewahrung),
    },
  });
  if (beansprucht.count === 0) {
    // Jemand anders war schneller. Sein Durchgang erledigt die Folgearbeiten.
    return prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  }

  const geschlossen = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

  // Ab hier ist das Ticket geschlossen. Alles Weitere sind Folgearbeiten, und
  // keine davon darf den Abschluss noch umstossen: ein Ticket, das in der
  // Datenbank geschlossen ist und dem Klickenden trotzdem einen Fehler meldet,
  // ist genau das, was «es liess sich nicht schliessen» heisst.
  await prisma.ticketEvent
    .create({
      data: {
        ticketId,
        kind: 'CLOSED',
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        actorSource: actor.source,
        detail: { grund: reason ?? null } as never,
      },
    })
    .catch((fehler: unknown) => {
      logger.warn('Abschluss-Ereignis konnte nicht geschrieben werden', {
        ticketId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    });

  // Zuerst die Meldung, dann die Sperre: nach dem Stummschalten koennte der
  // Bot je nach Rechtelage selbst nicht mehr schreiben.
  const abschluss = ticket.categoryId
    ? await prisma.ticketCategory.findUnique({
        where: { id: ticket.categoryId },
        select: { closeMessage: true },
      })
    : null;
  await systemMeldung(
    ticketId,
    [
      `**${actor.username}** hat dieses Ticket geschlossen.`,
      reason ? `Grund: ${reason}` : null,
      abschluss?.closeMessage ?? null,
    ]
      .filter((zeile): zeile is string => Boolean(zeile))
      .join('\n\n'),
  );

  // Der Verlauf wird jetzt festgehalten, solange der Kanal noch steht. Wer
  // erst beim Aufraeumen sichert, sichert das, was das Aufraeumen uebrig
  // laesst.
  await ensureTranscripts(ticketId).catch(() => undefined);

  // Kanal stummschalten statt loeschen.
  if (ticket.discordChannelId) {
    await sperreKanal(ticket).catch((fehler: unknown) => {
      logger.warn('Ticket-Kanal konnte nicht gesperrt werden', {
        ticketId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    });
  }

  // Die Frage nach der Bewertung kommt zuletzt - nach der Sperre, damit sie
  // unter dem Abschluss steht, und nur wenn die Einstellung es vorsieht.
  if (settings.feedbackEnabled) {
    const { frageNachBewertung } = await import('./support');
    await frageNachBewertung(ticketId, ticket.ticketNumber).catch(() => undefined);
  }

  const kategorie = ticket.categoryId
    ? await prisma.ticketCategory.findUnique({
        where: { id: ticket.categoryId },
        select: { name: true },
      })
    : null;
  const { meldeEreignis } = await import('../automation/emit');
  await meldeEreignis(
    'ticket.closed',
    {
      ticketId,
      nummer: geschlossen.ticketNumber,
      discordId: geschlossen.creatorDiscordId,
      kategorie: kategorie?.name ?? 'Ohne Kategorie',
      offenMinuten: geschlossen.closedAt
        ? Math.round((geschlossen.closedAt.getTime() - geschlossen.createdAt.getTime()) / 60_000)
        : null,
    },
    {
      guildId: geschlossen.guildId,
      actorId: actor.discordId,
      subjectId: geschlossen.creatorDiscordId,
      entityId: ticketId,
    },
  );

  // Den faelligen Kanal zeitnah abraeumen. Der Zeitpunkt steht bereits in der
  // Datenbank - dieser Wecker holt ihn nur frueher ein, als der
  // Aufraeumauftrag es taete. Stirbt der Prozess dazwischen, macht es der
  // Auftrag beim naechsten Durchlauf; das Ticket ist ohnehin schon
  // geschlossen.
  if (geschlossen.channelPurgeAt && geschlossen.discordChannelId) {
    planeZeitnahesAufraeumen(geschlossen.channelPurgeAt.getTime() - Date.now());
  }

  return geschlossen;
}

/**
 * Ein kurzer Wecker fuer die Aufraeumung.
 *
 * Ausdruecklich nur eine Abkuerzung, keine Zusage: der Auftrag in der
 * Datenbank ist die Zusage. Deshalb wird hier nichts nachgehalten, nichts
 * wiederholt und nichts gemeldet - schlaegt es fehl, greift der regulaere
 * Aufraeumauftrag.
 *
 * Nur fuer kurze Fristen. Wer einen Kanal 24 Stunden stehen laesst, bekommt
 * keinen Wecker, der 24 Stunden im Speicher haengt.
 */
const WECKER_HOECHSTFRIST_MS = 60_000;

function planeZeitnahesAufraeumen(inMs: number): void {
  if (inMs > WECKER_HOECHSTFRIST_MS) {
    return;
  }
  const timer = setTimeout(
    () => {
      void purgeDueChannels().catch(() => undefined);
    },
    Math.max(0, inMs) + 250,
  );
  // Ein offener Wecker darf den Prozess nicht am Beenden hindern.
  timer.unref?.();
}

/** Nach dem Schliessen darf gelesen, aber nicht mehr geschrieben werden. */
async function sperreKanal(ticket: Ticket): Promise<void> {
  if (!ticket.discordChannelId) {
    return;
  }
  const nurLesen = {
    allow: DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
    deny: DISCORD_PERMISSIONS.SEND_MESSAGES,
  };

  await discord.managedChannels.setOverwrite(
    ticket.discordChannelId,
    { id: ticket.creatorDiscordId, type: 1, ...nurLesen },
    'Ticket geschlossen',
  );

  const teilnehmer = await prisma.ticketParticipant.findMany({
    where: { ticketId: ticket.id, removedAt: null },
  });
  for (const eintrag of teilnehmer) {
    await discord.managedChannels
      .setOverwrite(
        ticket.discordChannelId,
        { id: eintrag.discordId, type: 1, ...nurLesen },
        'Ticket geschlossen',
      )
      .catch(() => undefined);
  }
}

/**
 * Ein geschlossenes Ticket wieder oeffnen.
 *
 * Existiert der Kanal noch, bekommt er seine Rechte zurueck. Ist er weg,
 * entsteht ein neuer - aber nur auf ausdruecklichen Wunsch: einen Kanal
 * beilaeufig neu anzulegen waere fuer alle Beteiligten ueberraschend.
 */
export async function reopenTicket(
  ticketId: string,
  actor: TicketActor,
  options: { neuerKanalWennNoetig?: boolean } = {},
): Promise<Ticket> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (!ticket.closedAt) {
    return ticket;
  }

  let kanalId = ticket.discordChannelId;

  if (kanalId) {
    const vorhanden = await discord.managedChannels.get(kanalId).catch(() => null);
    if (!vorhanden) {
      kanalId = null;
    }
  }

  if (kanalId) {
    await stelleSchreibrechteWiederHer(ticket, kanalId).catch(() => undefined);
  } else if (!options.neuerKanalWennNoetig) {
    // Ohne ausdrücklichen Wunsch entsteht kein neuer Kanal: das Ticket lebt
    // in der Datenbank weiter, und ein beiläufig neu angelegter Kanal wäre
    // für alle Beteiligten überraschend.
    throw new AppError('CONFLICT', {
      userMessage:
        'Der Discord-Kanal existiert nicht mehr. Das Ticket bleibt im Archiv erhalten.',
    });
  }

  const geoeffnet = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: ticket.assignedToDiscordId ? 'IN_PROGRESS' : 'OPEN',
      closedAt: null,
      closeReason: null,
      closedByDiscordId: null,
      reopenedAt: new Date(),
      channelPurgeAt: null,
      channelMissing: kanalId === null,
      discordChannelId: kanalId,
    },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId,
      kind: 'REOPENED',
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      actorSource: actor.source,
      detail: {} as never,
    },
  });

  await systemMeldung(ticketId, `**${actor.username}** hat dieses Ticket wieder geöffnet.`);

  return geoeffnet;
}

async function stelleSchreibrechteWiederHer(ticket: Ticket, kanalId: string): Promise<void> {
  const schreiben = {
    allow:
      DISCORD_PERMISSIONS.VIEW_CHANNEL |
      DISCORD_PERMISSIONS.SEND_MESSAGES |
      DISCORD_PERMISSIONS.ATTACH_FILES |
      DISCORD_PERMISSIONS.EMBED_LINKS |
      DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
    deny: 0n,
  };

  await discord.managedChannels.setOverwrite(
    kanalId,
    { id: ticket.creatorDiscordId, type: 1, ...schreiben },
    'Ticket wieder geöffnet',
  );

  const teilnehmer = await prisma.ticketParticipant.findMany({
    where: { ticketId: ticket.id, removedAt: null },
  });
  for (const eintrag of teilnehmer) {
    await discord.managedChannels
      .setOverwrite(kanalId, { id: eintrag.discordId, type: 1, ...schreiben }, 'Ticket wieder geöffnet')
      .catch(() => undefined);
  }
}

/**
 * Faellige Kanaele aufraeumen.
 *
 * Laeuft im bestehenden Job-Runner. Das Ticket selbst bleibt vollstaendig -
 * geloescht wird nur der Discord-Kanal, dessen Inhalt zu diesem Zeitpunkt
 * bereits als Transcript gesichert ist.
 */
export async function purgeDueChannels(jetzt = new Date()): Promise<number> {
  const faellig = await prisma.ticket.findMany({
    where: {
      channelPurgeAt: { not: null, lte: jetzt },
      discordChannelId: { not: null },
    },
    select: { id: true, discordChannelId: true, ticketNumber: true },
  });

  let entfernt = 0;
  for (const ticket of faellig) {
    // Den Auftrag beanspruchen, ehe er ausgefuehrt wird.
    //
    // Der Wecker im Web-Prozess und der Aufraeumauftrag im Bot koennen
    // denselben faelligen Kanal gleichzeitig aufgreifen. Ohne diesen Schritt
    // schickte einer von beiden ein zweites DELETE an Discord und faenge sich
    // dafuer einen Fehler ein - fuer nichts, denn der Kanal ist bereits weg.
    //
    // Wer null Zeilen aktualisiert, war zu spaet und laesst die Finger davon.
    const zugeteilt = await prisma.ticket.updateMany({
      where: { id: ticket.id, channelPurgeAt: { not: null } },
      data: { channelPurgeAt: null },
    });
    if (zugeteilt.count === 0) {
      continue;
    }

    try {
      await discord.managedChannels.remove(
        ticket.discordChannelId!,
        `Ticket #${ticket.ticketNumber} abgeschlossen`,
      );
      entfernt += 1;
    } catch (fehler) {
      // Ein Kanal, den es nicht mehr gibt, ist kein Fehlschlag - er ist das
      // Ziel. Discord antwortet darauf mit 404, und genau so wird es hier
      // behandelt: erledigt. Alles andere wird vermerkt, aendert aber nichts
      // am weiteren Ablauf - der Kanal ist ohnehin nicht mehr zu retten.
      const unbekannt = fehler instanceof DiscordApiError && fehler.status === 404;
      if (!unbekannt) {
        logger.warn('Ticket-Kanal konnte nicht entfernt werden', {
          ticketId: ticket.id,
          grund: fehler instanceof Error ? fehler.message : 'unbekannt',
        });
      }
    }
    // Auch bei einem Fehler die Markierung loesen - der Kanal ist entweder
    // weg oder von Hand geloescht worden; erneut zu versuchen brachte nichts.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { discordChannelId: null, channelPurgeAt: null, channelMissing: true, status: 'ARCHIVED', archivedAt: new Date() },
    });
  }

  if (entfernt > 0) {
    logger.info('Ticket-Kanäle aufgeräumt', { anzahl: entfernt });
  }
  return entfernt;
}

/**
 * Geschlossene Tickets, deren Kanal stehengeblieben ist.
 *
 * Der Wecker im Prozess ist eine Abkuerzung und keine Zusage - stirbt der
 * Prozess zwischen Abschluss und Loeschung, bleibt der Auftrag in der
 * Datenbank stehen und der naechste Aufraeumdurchgang holt ihn nach. Das
 * deckt den Regelfall ab.
 *
 * Es bleibt ein Fall, den es nicht deckt: ein Ticket, das geschlossen wurde,
 * als die Einstellung «nie loeschen» galt, und dessen Kanal seither steht,
 * obwohl inzwischen «sofort loeschen» eingestellt ist. Es traegt keinen
 * Faelligkeitszeitpunkt, also sucht niemand danach, und der Kanal bleibt
 * fuer immer - sichtbar fuer alle, die im Ticket waren.
 *
 * Dieser Durchgang traegt den fehlenden Zeitpunkt nach. Er loescht selbst
 * nichts: das tut der bestehende Aufraeumer, und zwar nach derselben Regel
 * wie bei jedem anderen Ticket.
 */
export async function scheduleOrphanedChannels(
  aufbewahrungMs: number | null,
  jetzt = new Date(),
): Promise<number> {
  if (aufbewahrungMs === null) {
    // «Nie loeschen» ist eine Ansage und kein Versehen.
    return 0;
  }

  const verwaist = await prisma.ticket.findMany({
    where: {
      closedAt: { not: null },
      channelPurgeAt: null,
      discordChannelId: { not: null },
      channelMissing: false,
      status: { in: ['CLOSED'] },
    },
    select: { id: true, closedAt: true },
  });

  let nachgetragen = 0;
  for (const ticket of verwaist) {
    // Ab dem Abschluss gerechnet, nicht ab jetzt: ein Ticket, das gestern
    // geschlossen wurde, ist mit der heutigen Einstellung sofort faellig.
    const faellig = new Date((ticket.closedAt ?? jetzt).getTime() + aufbewahrungMs);
    const { count } = await prisma.ticket.updateMany({
      where: { id: ticket.id, channelPurgeAt: null },
      data: { channelPurgeAt: faellig },
    });
    nachgetragen += count;
  }

  if (nachgetragen > 0) {
    logger.info('Liegengebliebene Ticket-Kanäle eingeplant', { anzahl: nachgetragen });
  }
  return nachgetragen;
}

/** Die Aufbewahrungsfrist der aktuellen Einstellung, in Millisekunden. */
export function aufbewahrungsfristMs(behaviour: TicketSettings['closeBehaviour']): number | null {
  return AUFBEWAHRUNG_MS[behaviour];
}

/**
 * Discord und Datenbank abgleichen.
 *
 * Ein Kanal kann von Hand geloescht worden sein. Das Ticket bleibt dann
 * vollstaendig erhalten - nur die Markierung sagt, dass der Kanal fehlt,
 * damit die Oberflaeche nicht auf etwas zeigt, das es nicht mehr gibt.
 */
export async function reconcileChannels(): Promise<{ fehlend: number }> {
  await resolveGuildId();
  const offene = await prisma.ticket.findMany({
    where: {
      discordChannelId: { not: null },
      channelMissing: false,
      status: { notIn: ['ARCHIVED'] },
    },
    select: { id: true, discordChannelId: true },
  });

  let fehlend = 0;
  for (const ticket of offene) {
    const kanal = await discord.managedChannels.get(ticket.discordChannelId!).catch(() => null);
    if (kanal) {
      continue;
    }
    fehlend += 1;
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { channelMissing: true },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, kind: 'CHANNEL_MISSING', actorSource: 'SYSTEM' },
    });
  }

  if (fehlend > 0) {
    logger.info('Fehlende Ticket-Kanäle erkannt', { anzahl: fehlend });
  }
  return { fehlend };
}
