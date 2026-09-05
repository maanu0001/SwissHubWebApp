import { prisma } from '@swisshub/database';
import type {
  MusicCommandKind,
  MusicLoopMode,
  MusicQueueItem,
  MusicSession,
  MusicSessionEndReason,
} from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { MUSIC_MODULE_ID, type MusicSettings } from './config';
import type { MusicSearchResult } from './providers/types';

const logger = createLogger('music:session');

/**
 * Die einzige Geschaeftslogik des Musik-Moduls.
 *
 * Slash-Befehle und Webplayer rufen ausschliesslich hier hinein. Der
 * Legacy-Bot hatte die Logik in den Befehlsruempfen stehen; ein Webplayer
 * haette sie zwangslaeufig ein zweites Mal nachgebaut, und ab da waeren
 * `/skip` und der Skip-Knopf zwei verschiedene Dinge gewesen, die
 * auseinanderdriften.
 *
 * Hier wird ausserdem nichts abgespielt: diese Schicht aendert den
 * gewuenschten Zustand und legt einen Befehl fuer die Voice-Laufzeit ab. Ob
 * der Ton tatsaechlich laeuft, meldet die Laufzeit zurueck - der Browser
 * erfaehrt nie einen Erfolg, den niemand bestaetigt hat.
 */

export interface SessionActor {
  discordUserId: string;
  username: string;
  /** Woher der Aufruf kam - nur fuer die Fehlersuche im Protokoll. */
  origin: 'web' | 'discord';
}

async function ladeSession(sessionId: string): Promise<MusicSession> {
  const session = await prisma.musicSession.findUnique({ where: { id: sessionId } });
  if (!session || session.endedAt) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Musik-Session läuft nicht mehr.' });
  }
  return session;
}

/** Einen Befehl fuer die zustaendige Laufzeit ablegen. */
async function befehl(
  session: MusicSession,
  kind: MusicCommandKind,
  actor: SessionActor,
  payload: Record<string, unknown> = {},
): Promise<string> {
  if (!session.botInstanceId) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dieser Session ist derzeit kein Musik-Bot zugewiesen.',
    });
  }
  const eintrag = await prisma.musicCommand.create({
    data: {
      sessionId: session.id,
      botInstanceId: session.botInstanceId,
      kind,
      payload: payload as never,
      requestedByDiscordUserId: actor.discordUserId,
      origin: actor.origin,
    },
  });
  return eintrag.id;
}

/**
 * Aktivitaet vermerken.
 *
 * Grundlage des Leerlauf-Disconnects. Der Legacy-Bot setzte `last_active`
 * bei Hinzufuegen, Skip, Pause und Lautstaerke - dasselbe passiert hier,
 * nur an einer Stelle statt in jedem Befehl einzeln.
 */
async function aktivitaet(sessionId: string): Promise<void> {
  await prisma.musicSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });
}

/** Naechste freie Position - Luecken durch Entfernen stoeren dabei nicht. */
async function naechstePosition(sessionId: string): Promise<number> {
  const letzte = await prisma.musicQueueItem.findFirst({
    where: { sessionId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return (letzte?.position ?? 0) + 10;
}

export async function addTrack(
  sessionId: string,
  treffer: MusicSearchResult,
  actor: SessionActor,
): Promise<MusicQueueItem> {
  const session = await ladeSession(sessionId);
  const settings = await getModuleSettings<MusicSettings>(MUSIC_MODULE_ID);

  const anzahl = await prisma.musicQueueItem.count({ where: { sessionId } });
  if (anzahl >= settings.queueLimit) {
    throw new AppError('CONFLICT', {
      userMessage: `Die Warteschlange ist voll (${settings.queueLimit} Titel).`,
    });
  }
  if (settings.maxTrackSeconds > 0 && treffer.durationSeconds > settings.maxTrackSeconds) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieser Titel ist länger als erlaubt.',
    });
  }

  const eintrag = await prisma.musicQueueItem.create({
    data: {
      sessionId,
      position: await naechstePosition(sessionId),
      provider: 'youtube',
      providerTrackId: treffer.providerTrackId,
      title: treffer.title,
      artist: treffer.artist,
      webpageUrl: treffer.webpageUrl,
      durationSeconds: treffer.durationSeconds,
      thumbnailUrl: treffer.thumbnailUrl,
      requestedByDiscordUserId: actor.discordUserId,
      requestedByUsername: actor.username,
    },
  });

  await aktivitaet(sessionId);
  await befehl(session, 'QUEUE_ADD', actor, { queueItemId: eintrag.id });
  return eintrag;
}

/**
 * Den Bot in den Sprachkanal holen.
 *
 * Getrennt von der Zuweisung: die entscheidet nur, WELCHER Bot zustaendig
 * ist. Ob er tatsaechlich im Kanal steht, weiss erst die Laufzeit.
 */
export async function join(sessionId: string, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  await aktivitaet(sessionId);
  return befehl(session, 'JOIN', actor);
}

export async function pause(sessionId: string, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  await prisma.musicSession.update({
    where: { id: sessionId },
    data: { pausedAt: session.pausedAt ?? new Date(), lastActivityAt: new Date() },
  });
  return befehl(session, 'PAUSE', actor);
}

export async function resume(sessionId: string, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  // Die Pausendauer geht in die Fortschrittsberechnung ein: ohne sie liefe
  // der Balken im Browser waehrend der Pause weiter.
  const zusatz = session.pausedAt ? Date.now() - session.pausedAt.getTime() : 0;
  await prisma.musicSession.update({
    where: { id: sessionId },
    data: {
      pausedAt: null,
      pausedMs: session.pausedMs + Math.max(0, zusatz),
      lastActivityAt: new Date(),
    },
  });
  return befehl(session, 'RESUME', actor);
}

/**
 * Innerhalb des laufenden Titels an eine Stelle springen.
 *
 * Die Fortschrittsleiste sah bisher aus wie etwas, worauf man klicken kann,
 * und war doch nur eine Anzeige. Wer ein zweiminütiges Intro überspringen
 * wollte, konnte den Titel überspringen - mehr nicht.
 *
 * Die Position wird hier gesetzt, nicht erst wenn die Laufzeit antwortet:
 * `trackStartedAt` so weit zurückzudatieren, wie gesprungen wurde, ist genau
 * das, was die Fortschrittsberechnung liest. Der Balken steht damit sofort
 * richtig, statt bis zur nächsten Abfrage an der alten Stelle zu kleben.
 * Scheitert der Befehl, holt die nächste Abfrage die Wahrheit zurück.
 *
 * Die Länge des Titels ist die Grenze. Ein Sprung ans Ende oder darüber
 * hinaus wäre ein umständliches «Überspringen» - dafür gibt es `skip`.
 */
export async function seek(
  sessionId: string,
  sekunden: number,
  actor: SessionActor,
  jetzt = new Date(),
): Promise<string> {
  const session = await ladeSession(sessionId);
  if (!session.currentItemId) {
    throw new AppError('CONFLICT', { userMessage: 'Es läuft gerade kein Titel.' });
  }

  const titel = await prisma.musicQueueItem.findUnique({
    where: { id: session.currentItemId },
    select: { durationSeconds: true },
  });
  const laenge = titel?.durationSeconds ?? 0;

  const ziel = Math.trunc(sekunden);
  if (!Number.isFinite(ziel) || ziel < 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Stelle gibt es nicht.' });
  }
  // Ohne bekannte Länge - ein Livestream etwa - lässt sich nichts begrenzen
  // und auch nichts sinnvoll anspringen.
  if (laenge <= 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Bei diesem Titel lässt sich nicht springen.',
    });
  }
  // Die letzte Sekunde bleibt frei: ein Sprung genau ans Ende beendete den
  // Titel sofort und sähe aus wie ein versehentliches Überspringen.
  const begrenzt = Math.min(ziel, Math.max(0, laenge - 1));

  await prisma.musicSession.update({
    where: { id: sessionId },
    data: {
      trackStartedAt: new Date(jetzt.getTime() - begrenzt * 1000),
      // Die bisher gesammelte Pausendauer bezog sich auf den alten
      // Startzeitpunkt. Nach dem Sprung zählt sie doppelt, wenn sie
      // stehenbleibt.
      pausedMs: 0,
      pausedAt: session.pausedAt ? jetzt : null,
      lastActivityAt: jetzt,
    },
  });

  return befehl(session, 'SEEK', actor, { positionSeconds: begrenzt });
}

export async function skip(sessionId: string, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  await aktivitaet(sessionId);
  return befehl(session, 'SKIP', actor);
}

/**
 * Stoppen.
 *
 * Legacy-Verhalten: Wiedergabe anhalten UND Warteschlange leeren, aber den
 * Kanal nicht verlassen - dafuer gibt es `/leave`. Die Wiederholung geht
 * dabei aus, sonst faenge der Leerlaufzaehler nie an zu laufen.
 */
export async function stop(sessionId: string, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  await prisma.$transaction([
    prisma.musicQueueItem.deleteMany({ where: { sessionId } }),
    prisma.musicSession.update({
      where: { id: sessionId },
      data: {
        loopMode: 'OFF',
        currentItemId: null,
        trackStartedAt: null,
        pausedAt: null,
        pausedMs: 0,
        lastActivityAt: new Date(),
      },
    }),
  ]);
  return befehl(session, 'STOP', actor);
}

export async function setVolume(sessionId: string, prozent: number, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  const settings = await getModuleSettings<MusicSettings>(MUSIC_MODULE_ID);
  const wert = Math.max(0, Math.min(Math.trunc(prozent), settings.maxVolume));
  await prisma.musicSession.update({
    where: { id: sessionId },
    data: { volume: wert, lastActivityAt: new Date() },
  });
  return befehl(session, 'SET_VOLUME', actor, { volume: wert });
}

export async function setLoop(sessionId: string, modus: MusicLoopMode, actor: SessionActor): Promise<string> {
  const session = await ladeSession(sessionId);
  await prisma.musicSession.update({
    where: { id: sessionId },
    data: { loopMode: modus, lastActivityAt: new Date() },
  });
  return befehl(session, 'SET_LOOP', actor, { loopMode: modus });
}

export async function removeItem(sessionId: string, queueItemId: string, actor: SessionActor): Promise<void> {
  const session = await ladeSession(sessionId);
  const eintrag = await prisma.musicQueueItem.findFirst({ where: { id: queueItemId, sessionId } });
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieser Titel ist nicht mehr in der Warteschlange.' });
  }
  await prisma.musicQueueItem.delete({ where: { id: eintrag.id } });
  await aktivitaet(sessionId);
  await befehl(session, 'QUEUE_REMOVE', actor, { queueItemId });
}

/**
 * Verschieben.
 *
 * Die Position wird zwischen die Nachbarn gelegt, statt die ganze
 * Warteschlange neu zu nummerieren. Deshalb liegen die Positionen im
 * Zehnerabstand - dazwischen ist Platz.
 */
export async function moveItem(
  sessionId: string,
  queueItemId: string,
  zielIndex: number,
  actor: SessionActor,
): Promise<void> {
  const session = await ladeSession(sessionId);
  const eintraege = await prisma.musicQueueItem.findMany({
    where: { sessionId },
    orderBy: { position: 'asc' },
  });
  const eintrag = eintraege.find((e) => e.id === queueItemId);
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieser Titel ist nicht mehr in der Warteschlange.' });
  }

  const ohne = eintraege.filter((e) => e.id !== queueItemId);
  const ziel = Math.max(0, Math.min(Math.trunc(zielIndex), ohne.length));
  const davor = ohne[ziel - 1]?.position;
  const danach = ohne[ziel]?.position;

  let neu: number;
  if (davor === undefined && danach === undefined) {
    neu = 10;
  } else if (davor === undefined) {
    neu = danach! - 10;
  } else if (danach === undefined) {
    neu = davor + 10;
  } else if (danach - davor > 1) {
    neu = Math.floor((davor + danach) / 2);
  } else {
    // Kein Platz mehr zwischen den Nachbarn: einmal neu nummerieren. Selten,
    // aber ohne diesen Zweig liefen die Positionen irgendwann zusammen.
    await prisma.$transaction(
      ohne.map((e, i) =>
        prisma.musicQueueItem.update({ where: { id: e.id }, data: { position: (i + 1) * 10 } }),
      ),
    );
    neu = ziel === 0 ? 5 : ziel * 10 + 5;
  }

  await prisma.musicQueueItem.update({ where: { id: eintrag.id }, data: { position: neu } });
  await aktivitaet(sessionId);
  await befehl(session, 'QUEUE_MOVE', actor, { queueItemId, targetIndex: ziel });
}

/**
 * Die wartenden Titel neu anordnen.
 *
 * Der laufende Titel bleibt, wo er ist - und das ist mehr als eine
 * Anzeigefrage: die Laufzeit haelt den laufenden Titel weiterhin in der
 * Warteschlange und waehlt den naechsten als die Zeile mit der kleinsten
 * Position (`store.naechster_titel`). Dass der laufende Titel die kleinste
 * Position hat, ist die stillschweigende Voraussetzung dieser Auswahl -
 * jedes Hinzufuegen, Entfernen und Verschieben haelt sie ein.
 *
 * Das Mischen hielt sie als einziges nicht ein: es verteilte *alle* Zeilen
 * neu, den laufenden Titel eingeschlossen. Danach stand mitten in der
 * Warteschlange ein Titel, der gerade lief, und die Reihenfolge, die man sah,
 * war nicht mehr die, die gespielt wurde.
 *
 * Deshalb: der laufende Titel behaelt die Spitze, gemischt wird der Rest.
 */
export async function shuffle(sessionId: string, actor: SessionActor): Promise<void> {
  const session = await ladeSession(sessionId);
  const eintraege = await prisma.musicQueueItem.findMany({
    where: { sessionId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });

  const laufend = session.currentItemId
    ? eintraege.find((eintrag) => eintrag.id === session.currentItemId)
    : undefined;
  const wartend = eintraege.filter((eintrag) => eintrag.id !== laufend?.id);

  // Leere Warteschlange, nur der laufende Titel, oder genau einer dahinter:
  // es gibt nichts umzustellen. Ein Schreibvorgang und ein Befehl an die
  // Laufzeit, die beide nichts aendern, waeren nur Last - und ein Befehl an
  // eine Session ohne Bot wuerde obendrein einen Fehler melden.
  if (wartend.length < 2) {
    return;
  }

  // Fisher-Yates, serverseitig: eine reine Anzeigesortierung im Browser
  // waere fuer die Slash-Befehle unsichtbar.
  const gemischt = [...wartend];
  for (let i = gemischt.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j]!, gemischt[i]!];
  }

  const reihenfolge = laufend ? [laufend, ...gemischt] : gemischt;

  // `updateMany` statt `update`: endet der laufende Titel genau jetzt, ist
  // seine Zeile weg. `update` liesse die ganze Transaktion scheitern und der
  // Klick bliebe folgenlos; so faellt nur der verschwundene Titel aus, und
  // die uebrigen stehen danach trotzdem in der gemischten Reihenfolge.
  // Luecken in den Positionen sind ausdruecklich erlaubt.
  await prisma.$transaction(
    reihenfolge.map((eintrag, index) =>
      prisma.musicQueueItem.updateMany({
        where: { id: eintrag.id, sessionId },
        data: { position: (index + 1) * 10 },
      }),
    ),
  );
  await aktivitaet(sessionId);
  await befehl(session, 'QUEUE_SHUFFLE', actor);
}

/**
 * Session beenden und den Bot freigeben.
 *
 * Die beiden Schluessel werden auf `null` gesetzt - erst dadurch sind Kanal
 * und Bot wieder vergebbar.
 */
export async function endSession(
  sessionId: string,
  reason: MusicSessionEndReason,
  actor?: SessionActor,
): Promise<void> {
  const session = await prisma.musicSession.findUnique({ where: { id: sessionId } });
  if (!session || session.endedAt) {
    return;
  }

  if (actor && session.botInstanceId) {
    await befehl(session, 'LEAVE', actor).catch(() => undefined);
  }

  await prisma.$transaction(async (tx) => {
    await tx.musicSession.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        endReason: reason,
        activeChannelKey: null,
        activeBotKey: null,
        currentItemId: null,
      },
    });
    if (session.botInstanceId) {
      await tx.musicBotInstance.update({
        where: { id: session.botInstanceId },
        data: { status: 'FREE' },
      });
    }
  });

  logger.info('Musik-Session beendet', { sessionId, reason });
}
