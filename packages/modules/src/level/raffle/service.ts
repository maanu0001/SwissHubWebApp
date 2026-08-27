import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { XpRaffle, XpRaffleEntry, XpRaffleStatus, Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound, validationFailed } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';
import { calculateEntryCost, type EntryCostRules } from './entry-cost';
import type { RaffleActor, RaffleInput } from './schemas';

const logger = createLogger('level.raffle');

/**
 * Verlosungen im Level-System.
 *
 * Dies ist die einzige Stelle, an der eine Verlosung entsteht, ihren Zustand
 * wechselt oder endet. Dashboard, die öffentliche Seite und der Knopf auf
 * Discord rufen dieselben Funktionen auf - es gibt keine zweite Fassung der
 * Regeln je Oberfläche.
 */

/** Zustände, in denen eine Teilnahme möglich ist. */
export const ENTRY_OPEN_STATUS: XpRaffleStatus = 'ENTRY_OPEN';

/** Aus welchem Zustand welcher Übergang erlaubt ist. */
const ALLOWED_TRANSITIONS: Record<XpRaffleStatus, readonly XpRaffleStatus[]> = {
  DRAFT: ['SCHEDULED', 'ENTRY_OPEN', 'CANCELLED'],
  SCHEDULED: ['ENTRY_OPEN', 'CANCELLED'],
  ENTRY_OPEN: ['ENTRY_CLOSED', 'CANCELLED'],
  ENTRY_CLOSED: ['ENTRY_OPEN', 'DRAWING', 'CANCELLED'],
  DRAWING: ['WINNER_PENDING', 'CANCELLED'],
  WINNER_PENDING: ['DRAWING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: XpRaffleStatus, to: XpRaffleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

const STATUS_LABEL: Record<XpRaffleStatus, string> = {
  DRAFT: 'Entwurf',
  SCHEDULED: 'Geplant',
  ENTRY_OPEN: 'Teilnahme geöffnet',
  ENTRY_CLOSED: 'Teilnahme geschlossen',
  DRAWING: 'Ziehung läuft',
  WINNER_PENDING: 'Gewinner wartet auf Bestätigung',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgebrochen',
};

export const raffleStatusLabel = (status: XpRaffleStatus): string => STATUS_LABEL[status];

/** Zustände, in denen eine Verlosung als laufend gilt. */
export const LIVE_STATUSES: readonly XpRaffleStatus[] = [
  'SCHEDULED',
  'ENTRY_OPEN',
  'ENTRY_CLOSED',
  'DRAWING',
  'WINNER_PENDING',
];

export const entryCostRules = (raffle: XpRaffle): EntryCostRules => ({
  entryModel: raffle.entryModel,
  fixedEntryXp: raffle.fixedEntryXp,
  percentageBasisPoints: raffle.percentageBasisPoints,
  minimumEntryXp: raffle.minimumEntryXp,
  maximumEntryXp: raffle.maximumEntryXp,
});

export async function getRaffle(id: string): Promise<XpRaffle | null> {
  return prisma.xpRaffle.findUnique({ where: { id } });
}

/** Eine Transaktion, wie Prisma sie an den Rumpf von `$transaction` übergibt. */
export type RaffleTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Die Verlosung gesperrt lesen.
 *
 * Jeder Zustandswechsel einer Verlosung - Ziehung starten, neu ziehen,
 * Gewinner bestätigen, teilnehmen - muss dies zuerst tun. Ohne die Sperre
 * lesen zwei gleichzeitige Anfragen denselben Zustand, halten beide ihre
 * Prüfung für bestanden und führen beide aus.
 *
 * Bei der Ziehung fing der eindeutige Schlüssel auf `(raffleId, version)` das
 * nur ab, solange beide dieselbe Version errechneten. Kam die zweite Anfrage
 * erst nach dem Festschreiben der ersten dazu, zählte sie auf die bereits
 * vorhandene Ziehung hoch - und dieselbe Verlosung wurde zweimal gezogen. Beim
 * Bestätigen des Gewinners wäre auf demselben Weg der Gewinn zweimal
 * gutgeschrieben worden.
 *
 * `FOR UPDATE` reiht die Anfragen auf: die zweite wartet, bis die erste fertig
 * ist, liest dann den neuen Zustand und scheitert an der Zustandsprüfung - mit
 * einer verständlichen Meldung statt eines Datenbankfehlers.
 */
export async function lockRaffle(tx: RaffleTx, raffleId: string): Promise<XpRaffle> {
  await tx.$queryRaw`SELECT "id" FROM "XpRaffle" WHERE "id" = ${raffleId} FOR UPDATE`;
  const raffle = await tx.xpRaffle.findUnique({ where: { id: raffleId } });
  if (!raffle) {
    throw notFound(`Verlosung ${raffleId} nicht gefunden`, 'Diese Verlosung gibt es nicht.');
  }
  return raffle;
}

export async function requireRaffle(id: string): Promise<XpRaffle> {
  const raffle = await prisma.xpRaffle.findUnique({ where: { id } });
  if (!raffle) {
    throw notFound(`Verlosung ${id} nicht gefunden`, 'Diese Verlosung gibt es nicht.');
  }
  return raffle;
}

/**
 * Wie lange eine abgeschlossene Verlosung noch als aktuell gilt.
 *
 * Zwoelf Stunden nach der Bestaetigung. Solange bleibt der Eintrag in der
 * Seitenleiste stehen und die Seite zeigt die Ziehung - damit sie auch sehen
 * kann, wer nicht zufaellig in der richtigen Minute online war.
 *
 * Der Zeitpunkt kommt aus `completedAt` in der Datenbank: kein Browser-Timer,
 * kein `localStorage`, kein `setTimeout` ueber einen halben Tag. Wer die
 * Seite zwoelf Stunden offen liegen laesst, sieht beim naechsten Aufruf
 * dasselbe wie jeder andere.
 */
export const RAFFLE_NACHLAUF_MS = 12 * 60 * 60 * 1000;

/**
 * Die Verlosung, die auf der öffentlichen Seite oben steht.
 *
 * Bevorzugt wird die am weitesten fortgeschrittene laufende Verlosung; gibt es
 * keine, die zuletzt abgeschlossene - damit der Gewinner noch eine Weile
 * sichtbar bleibt, statt nach der Bestätigung sofort zu verschwinden.
 *
 * «Eine Weile» ist derselbe Nachlauf, nach dem auch der Eintrag in der
 * Seitenleiste verschwindet. Ohne diese Grenze stünde eine Verlosung von
 * vorletztem Monat noch immer als «aktuell» oben auf der Seite - und wer sie
 * öffnete, sähe eine Ziehung, die längst vorbei ist, ohne dass etwas darauf
 * hinwiese. Ältere Verlosungen bleiben über die Historie erreichbar.
 */
export async function getFeaturedRaffle(): Promise<XpRaffle | null> {
  const live = await prisma.xpRaffle.findFirst({
    where: { status: { in: [...LIVE_STATUSES] } },
    orderBy: [{ status: 'asc' }, { entryEndsAt: 'asc' }, { createdAt: 'desc' }],
  });
  if (live) {
    return live;
  }
  return prisma.xpRaffle.findFirst({
    where: {
      status: 'COMPLETED',
      completedAt: { gt: new Date(Date.now() - RAFFLE_NACHLAUF_MS) },
    },
    orderBy: { completedAt: 'desc' },
  });
}

/**
 * Legt eine Verlosung als Entwurf an.
 *
 * Ein Entwurf ist noch für niemanden sichtbar und kostet niemanden XP; erst
 * das Veröffentlichen macht ihn wirksam.
 */
export async function createRaffle(actor: RaffleActor, input: RaffleInput): Promise<XpRaffle> {
  const raffle = await prisma.xpRaffle.create({
    data: {
      ...toRaffleData(input),
      status: 'DRAFT',
      createdByDiscordId: actor.discordId,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_CREATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: raffle.title,
    success: true,
    metadata: {
      raffleId: raffle.id,
      title: raffle.title,
      entryModel: raffle.entryModel,
      fixedEntryXp: raffle.fixedEntryXp,
      percentageBasisPoints: raffle.percentageBasisPoints,
    },
  });

  return raffle;
}

/**
 * Felder, die nach der ersten bezahlten Teilnahme feststehen.
 *
 * Wer bereits bezahlt hat, hat zu den damals geltenden Bedingungen bezahlt.
 * Liesse sich das Einsatzmodell danach noch ändern, stünden Teilnahmen
 * nebeneinander, die nach verschiedenen Regeln zustande kamen - die
 * ausgewiesene Gewinnchance wäre dann schlicht falsch.
 */
export const LOCKED_AFTER_FIRST_ENTRY = [
  'entryModel',
  'fixedEntryXp',
  'percentageBasisPoints',
  'minimumEntryXp',
  'maximumEntryXp',
] as const;

export async function updateRaffle(actor: RaffleActor, id: string, input: RaffleInput): Promise<XpRaffle> {
  const raffle = await requireRaffle(id);
  if (raffle.status === 'COMPLETED' || raffle.status === 'CANCELLED') {
    throw conflict('Diese Verlosung ist beendet und lässt sich nicht mehr ändern.');
  }

  const data = toRaffleData(input);
  const entryCount = await prisma.xpRaffleEntry.count({ where: { raffleId: id } });

  if (entryCount > 0) {
    const changed = LOCKED_AFTER_FIRST_ENTRY.filter((field) => data[field] !== raffle[field]);
    if (changed.length > 0) {
      throw conflict(
        'Sobald jemand teilgenommen hat, lassen sich Einsatzmodell und Beträge nicht mehr ändern.',
      );
    }
    // Auf Nummer sicher: die gesperrten Felder gar nicht erst mitschreiben.
    for (const field of LOCKED_AFTER_FIRST_ENTRY) {
      delete (data as Partial<RaffleFields>)[field];
    }
  }

  const updated = await prisma.xpRaffle.update({ where: { id }, data });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: raffle.title,
    success: true,
    metadata: { raffleId: id, title: updated.title, entryCount, lockedFieldsSkipped: entryCount > 0 },
  });

  return updated;
}

/**
 * Veröffentlicht eine Verlosung.
 *
 * Ohne Startzeitpunkt beginnt die Teilnahme sofort, sonst wartet der
 * Hintergrundlauf auf den hinterlegten Zeitpunkt.
 */
export async function publishRaffle(actor: RaffleActor, id: string, now = new Date()): Promise<XpRaffle> {
  const raffle = await requireRaffle(id);
  if (raffle.status !== 'DRAFT') {
    throw conflict('Diese Verlosung ist bereits veröffentlicht.');
  }

  const startsLater = raffle.entryStartsAt !== null && raffle.entryStartsAt > now;
  const status: XpRaffleStatus = startsLater ? 'SCHEDULED' : 'ENTRY_OPEN';

  const updated = await prisma.xpRaffle.update({
    where: { id },
    data: {
      status,
      publishedAt: now,
      entryOpenedAt: status === 'ENTRY_OPEN' ? now : null,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_PUBLISHED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: raffle.title,
    success: true,
    metadata: { raffleId: id, title: updated.title, status },
  });

  return updated;
}

/** Öffnet die Teilnahme - von Hand oder durch den Hintergrundlauf. */
export async function openEntries(
  actor: RaffleActor | null,
  id: string,
  now = new Date(),
): Promise<XpRaffle> {
  const raffle = await requireRaffle(id);
  if (raffle.status === 'ENTRY_OPEN') {
    return raffle;
  }
  if (!canTransition(raffle.status, 'ENTRY_OPEN')) {
    throw conflict(`Aus "${raffleStatusLabel(raffle.status)}" lässt sich die Teilnahme nicht öffnen.`);
  }

  const updated = await prisma.xpRaffle.update({
    where: { id },
    data: { status: 'ENTRY_OPEN', entryOpenedAt: raffle.entryOpenedAt ?? now, entryClosedAt: null },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_ENTRY_OPENED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor?.discordId ?? null,
    actorUsername: actor?.username ?? 'Zeitsteuerung',
    targetLabel: raffle.title,
    success: true,
    metadata: { raffleId: id, title: updated.title, automatic: actor === null },
  });

  return updated;
}

/** Schliesst die Teilnahme. Ab hier sind die Gewinnchancen endgültig. */
export async function closeEntries(
  actor: RaffleActor | null,
  id: string,
  now = new Date(),
): Promise<XpRaffle> {
  const raffle = await requireRaffle(id);
  if (raffle.status === 'ENTRY_CLOSED') {
    return raffle;
  }
  if (!canTransition(raffle.status, 'ENTRY_CLOSED')) {
    throw conflict(`Aus "${raffleStatusLabel(raffle.status)}" lässt sich die Teilnahme nicht schliessen.`);
  }

  const updated = await prisma.xpRaffle.update({
    where: { id },
    data: { status: 'ENTRY_CLOSED', entryClosedAt: now },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_ENTRY_CLOSED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor?.discordId ?? null,
    actorUsername: actor?.username ?? 'Zeitsteuerung',
    targetLabel: raffle.title,
    success: true,
    metadata: {
      raffleId: id,
      title: updated.title,
      entryCount: updated.entryCount,
      automatic: actor === null,
    },
  });

  return updated;
}

/** Alle gültigen Teilnahmen - nur diese zählen für die Ziehung. */
export async function activeEntries(raffleId: string): Promise<XpRaffleEntry[]> {
  return prisma.xpRaffleEntry.findMany({
    where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Übernimmt Zähler und Topf aus den tatsächlichen Zeilen.
 *
 * Die beiden Felder an der Verlosung sind nur eine Abkürzung für die Anzeige;
 * gezählt wird immer in den Teilnahmen selbst.
 */
export async function refreshCounters(
  tx: Prisma.TransactionClient,
  raffleId: string,
): Promise<{ entryCount: number; potXp: number }> {
  const totals = await tx.xpRaffleEntry.aggregate({
    where: { raffleId, status: { in: ['ACTIVE', 'WINNER'] } },
    _count: { _all: true },
    _sum: { entryXp: true },
  });
  const entryCount = totals._count._all;
  const potXp = totals._sum.entryXp ?? 0;
  await tx.xpRaffle.update({ where: { id: raffleId }, data: { entryCount, potXp } });
  return { entryCount, potXp };
}

/**
 * Die Felder, die aus dem Formular stammen.
 *
 * Bewusst als eigener Typ statt als Prisma-Update-Typ: so lässt sich dieselbe
 * Struktur sowohl beim Anlegen als auch beim Ändern verwenden, und die
 * gesperrten Felder bleiben benennbar.
 */
type RaffleFields = Omit<
  Prisma.XpRaffleUncheckedCreateInput,
  'id' | 'status' | 'createdByDiscordId' | 'createdAt' | 'updatedAt'
>;

/** Wandelt die geprüfte Eingabe in Datenbankfelder. */
function toRaffleData(input: RaffleInput): RaffleFields {
  const percentage = input.entryModel === 'PERCENTAGE';
  const fixed = input.entryModel === 'FIXED';

  if (percentage && input.minimumEntryXp !== null && input.maximumEntryXp !== null) {
    if (input.minimumEntryXp > input.maximumEntryXp) {
      throw validationFailed(
        { minimumEntryXp: 'grösser als der Höchsteinsatz' },
        'Der Mindesteinsatz darf nicht über dem Höchsteinsatz liegen.',
      );
    }
  }
  if (input.entryStartsAt && input.entryEndsAt && input.entryStartsAt >= input.entryEndsAt) {
    throw validationFailed(
      { entryEndsAt: 'liegt vor dem Start' },
      'Das Ende der Teilnahme muss nach dem Start liegen.',
    );
  }
  if (input.entryEndsAt && input.drawScheduledAt && input.drawScheduledAt < input.entryEndsAt) {
    throw validationFailed(
      { drawScheduledAt: 'liegt vor dem Ende der Teilnahme' },
      'Die Auslosung kann nicht vor dem Ende der Teilnahme stattfinden.',
    );
  }

  return {
    title: input.title,
    description: input.description || null,
    bannerPath: input.bannerPath || null,
    bannerUrl: input.bannerUrl || null,
    prizeKind: input.prizeKind,
    prizeDescription: input.prizeDescription,
    prizeXp: input.prizeKind === 'XP_PRIZE' ? input.prizeXp : null,
    prizeRoleId: input.prizeKind === 'ROLE_PRIZE' ? input.prizeRoleId || null : null,
    entryModel: input.entryModel,
    fixedEntryXp: fixed ? input.fixedEntryXp : null,
    percentageBasisPoints: percentage ? input.percentageBasisPoints : null,
    minimumEntryXp: percentage ? input.minimumEntryXp : null,
    maximumEntryXp: percentage ? input.maximumEntryXp : null,
    minimumParticipants: input.minimumParticipants,
    maximumParticipants: input.maximumParticipants,
    entryStartsAt: input.entryStartsAt,
    entryEndsAt: input.entryEndsAt,
    drawScheduledAt: input.drawScheduledAt,
    autoDraw: input.autoDraw,
    participantsPublic: input.participantsPublic,
    autoAnnounceWinner: input.autoAnnounceWinner,
    discordChannelId: input.discordChannelId || null,
  };
}

/**
 * Prüft, ob eine Verlosung gerade Teilnahmen annimmt.
 *
 * Wird sowohl vor der Vorschau als auch noch einmal innerhalb der Transaktion
 * aufgerufen: zwischen Anzeige und Bestätigung kann die Teilnahme geschlossen
 * worden sein.
 */
export function assertEntryOpen(raffle: XpRaffle, now = new Date()): void {
  if (raffle.status === 'DRAWING' || raffle.status === 'WINNER_PENDING') {
    throw conflict('D Ziehig lauft scho - do chasch nümme mitmache.');
  }
  if (raffle.status === 'COMPLETED') {
    throw conflict('Die Verlosig isch scho vorbei.');
  }
  if (raffle.status === 'CANCELLED') {
    throw conflict('Die Verlosig isch abbroche worde.');
  }
  if (raffle.status !== 'ENTRY_OPEN') {
    throw conflict('D Teilnahm isch grad nid offe.');
  }
  if (raffle.entryEndsAt && raffle.entryEndsAt <= now) {
    throw conflict('D Teilnahmefrist isch abglaufe.');
  }
  if (raffle.maximumParticipants !== null && raffle.entryCount >= raffle.maximumParticipants) {
    throw conflict('D Verlosig isch scho voll.');
  }
}

/** Zustände, in denen eine Verlosung endgültig vorbei ist. */
export const ENDED_STATUSES: readonly XpRaffleStatus[] = ['COMPLETED', 'CANCELLED'];

export function isEnded(status: XpRaffleStatus): boolean {
  return ENDED_STATUSES.includes(status);
}

export interface RaffleDeletionSummary {
  title: string;
  status: XpRaffleStatus;
  entries: number;
  draws: number;
  refunds: number;
}

/**
 * Eine vergangene Verlosung endgültig entfernen.
 *
 * Gedacht zum Aufräumen: abgeschlossene und abgebrochene Verlosungen sammeln
 * sich in der Übersicht an, und irgendwann interessiert die dritte Verlosung
 * vom letzten Jahr niemanden mehr.
 *
 * Drei Dinge, die dieser Schritt bewusst NICHT tut:
 *
 *  - **Er rührt keine XP an.** Einsätze, Rückzahlungen und Gewinne stehen als
 *    eigene Zeilen im XP-Journal (`XpTransaction`) und haben keinen Verweis
 *    auf die Verlosung. Der Punktestand jedes Mitglieds bleibt exakt, wie er
 *    ist - hier verschwindet die Verlosung, nicht ihre Wirkung. Etwas anderes
 *    waere auch nicht vertretbar: eine Loeschung im Nachhinein duerfte
 *    niemandem XP wegnehmen oder zurueckgeben.
 *  - **Er ersetzt keinen Abbruch.** Eine laufende Verlosung laesst sich nicht
 *    loeschen. Wer sie beenden will, bricht sie ab - dabei werden die
 *    Einsaetze zurueckgezahlt. Loeschen statt Abbrechen hiesse, offene
 *    Rueckzahlungen spurlos verschwinden zu lassen.
 *  - **Er raeumt Discord nicht auf.** Eine bereits verschickte Ankuendigung
 *    bleibt stehen; ihre Kennungen landen im Audit Log, damit sie sich
 *    nachtraeglich finden laesst.
 *
 * Was bleibt, ist der Eintrag im Audit Log. Er ist nach dem Loeschen die
 * einzige Auskunft darueber, dass es diese Verlosung gab - deshalb traegt er
 * Titel, Zustand, Teilnehmerzahl, Topf und Gewinner, nicht nur die Kennung.
 */
export async function deleteRaffle(
  actor: RaffleActor,
  raffleId: string,
  reason: string,
): Promise<RaffleDeletionSummary> {
  const raffle = await requireRaffle(raffleId);

  if (!isEnded(raffle.status)) {
    throw conflict(
      'Nur abgeschlossene oder abgebrochene Verlosungen lassen sich löschen. Brich die Verlosung zuerst ab - dabei werden die Einsätze zurückgezahlt.',
    );
  }

  // Nach einem sauberen Abbruch ist keine Teilnahme mehr `ACTIVE`: jede wurde
  // auf `REFUNDED` gesetzt. Bleibt hier etwas uebrig, ist der Abbruch nicht
  // durchgelaufen und es steht noch eine Rueckzahlung aus. Die Zeile ist dann
  // der einzige Beleg dafuer, wem wie viel zusteht - sie zu loeschen hiesse,
  // den Anspruch zu loeschen.
  //
  // Bei einer abgeschlossenen Verlosung ist `ACTIVE` dagegen der Normalfall:
  // die Einsaetze der nicht gezogenen Teilnahmen sind verbraucht, genau
  // darauf beruht das Spiel.
  if (raffle.status === 'CANCELLED') {
    const offen = await prisma.xpRaffleEntry.count({ where: { raffleId, status: 'ACTIVE' } });
    if (offen > 0) {
      throw conflict(
        `Diese Verlosung hat noch ${offen} nicht zurückgezahlte ${offen === 1 ? 'Teilnahme' : 'Teilnahmen'}. Bitte zuerst den Abbruch abschliessen.`,
      );
    }
  }

  const [entries, draws, refunds] = await Promise.all([
    prisma.xpRaffleEntry.count({ where: { raffleId } }),
    prisma.xpRaffleDraw.count({ where: { raffleId } }),
    prisma.xpRaffleRefund.count({ where: { raffleId } }),
  ]);
  const gewinner = raffle.confirmedDrawId
    ? await prisma.xpRaffleDraw.findUnique({
        where: { id: raffle.confirmedDrawId },
        select: { winnerDiscordId: true },
      })
    : null;

  // Feste Reihenfolge statt Verlass auf die Kaskade: `XpRaffleDraw` zeigt mit
  // `winnerEntryId` auf eine Teilnahme, und diese Beziehung ist pflichtig -
  // wuerde die Datenbank die Teilnahmen zuerst entfernen, stuende die
  // Fremdschluesselpruefung im Weg. Die Reihenfolge hier ist die einzige, in
  // der keine Beziehung kurzzeitig ins Leere zeigt.
  await prisma.$transaction(async (tx) => {
    await tx.xpRaffle.update({ where: { id: raffleId }, data: { confirmedDrawId: null } });
    await tx.xpRaffleRefund.deleteMany({ where: { raffleId } });
    await tx.xpRaffleDraw.deleteMany({ where: { raffleId } });
    await tx.xpRaffleEntry.deleteMany({ where: { raffleId } });
    await tx.xpRaffle.delete({ where: { id: raffleId } });
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_DELETED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: raffle.title,
    success: true,
    metadata: {
      raffleId,
      reason,
      status: raffle.status,
      prizeDescription: raffle.prizeDescription,
      entryCount: entries,
      potXp: raffle.potXp,
      drawCount: draws,
      refundCount: refunds,
      winnerDiscordId: gewinner?.winnerDiscordId ?? null,
      completedAt: raffle.completedAt,
      cancelledAt: raffle.cancelledAt,
      // Die Ankuendigung bleibt auf Discord stehen - ohne diese Kennungen
      // waere sie nach dem Loeschen nicht mehr zuzuordnen.
      discordChannelId: raffle.discordChannelId,
      discordMessageId: raffle.discordMessageId,
      winnerMessageId: raffle.winnerMessageId,
    },
  });

  logger.info('Verlosung gelöscht', { raffleId, status: raffle.status, entries, draws, refunds });

  return { title: raffle.title, status: raffle.status, entries, draws, refunds };
}

/** Nur für die Übersicht: wie viel eine Teilnahme aktuell kostet. */
export function exampleCost(raffle: XpRaffle, xp: number): number {
  return calculateEntryCost(entryCostRules(raffle), xp).entryXp;
}

export { logger as raffleLogger };
