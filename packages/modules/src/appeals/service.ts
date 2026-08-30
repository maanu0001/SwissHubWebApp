import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';
import type {
  Appeal,
  AppealEventKind,
  AppealPriority,
  AppealStatus,
  AppealVisibility,
} from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { APPEALS_MODULE_ID, APPEAL_FRAGEN, type AppealsSettings } from './config';
import { baueSnapshot, pruefeZulaessigkeit } from './eligibility';
import { formatFallnummer, naechsteFallnummer } from './numbering';
import { istOffen, uebergangErlaubt } from './status';

const logger = createLogger('appeals:service');

/**
 * Der Kern der Entbannungsanträge.
 *
 * Zwei Arten von Aufrufern kommen hier an, und sie sind streng getrennt:
 *
 * - **Der Antragsteller** identifiziert sich über seine Discord-Kennung. Jede
 *   Funktion, die er erreicht, prüft `applicantDiscordId` gegen die Kennung
 *   aus der Sitzung. Diese Prüfung liegt hier und nicht in der Oberfläche.
 * - **Das Team** kommt über die Berechtigungsprüfung der Server Actions.
 *
 * Was der Antragsteller sieht, entsteht nie durch Weglassen in der Anzeige,
 * sondern durch eigene Abfragen, die interne Daten gar nicht erst lesen.
 */

/** Wer eine Aktion auslöst. */
export interface AppealActor {
  discordId: string;
  username: string;
}

// --- Zeitleiste -------------------------------------------------------------

export interface EreignisEingabe {
  appealId: string;
  kind: AppealEventKind;
  visibility: AppealVisibility;
  actor?: AppealActor | null;
  /** Was der Antragsteller liest. Nur bei `PUBLIC` nötig. */
  publicLabel?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Einen Zeitleisteneintrag schreiben (§39).
 *
 * Die Sichtbarkeit steht an der Zeile, nicht an der Abfrage. Wer sie an der
 * Abfrage entscheidet, hat sie irgendwann an einer Abfrage vergessen.
 */
export async function schreibeEreignis(
  eingabe: EreignisEingabe,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.appealEvent.create({
    data: {
      appealId: eingabe.appealId,
      kind: eingabe.kind,
      visibility: eingabe.visibility,
      actorDiscordId: eingabe.actor?.discordId ?? null,
      actorUsername: eingabe.actor?.username ?? null,
      publicLabel: eingabe.publicLabel?.slice(0, 200) ?? null,
      detail: (eingabe.detail ?? {}) as Prisma.InputJsonValue,
    },
  });
}

// --- Lesen ------------------------------------------------------------------

/**
 * Einen Antrag laden - mit der Gilde in der Abfrage.
 *
 * Die Gilde steht in der Bedingung und nicht in einer Nachprüfung: eine
 * Kennung aus einer fremden Gilde darf nicht einmal gelesen werden.
 */
export async function holeAppeal(guildId: string, id: string): Promise<Appeal | null> {
  return prisma.appeal.findFirst({ where: { id, guildId } });
}

/**
 * Der Antrag eines Antragstellers - **die Eigentumsprüfung** (§4).
 *
 * Der Name ist Absicht: `tests/unit/action-authorization.test.ts` verlangt von
 * jeder Aktion mit `applicant: true` genau diesen Aufruf. Wer die Prüfung
 * anders schreibt, fällt dort auf.
 *
 * Die Kennung kommt aus der Sitzung, nie aus der Eingabe. Ein Antragsteller,
 * der eine fremde Kennung schickt, bekommt trotzdem nur seine eigenen Anträge.
 */
export async function requireEigenerAppeal(
  guildId: string,
  appealId: string,
  antragstellerDiscordId: string,
): Promise<Appeal> {
  const appeal = await prisma.appeal.findFirst({
    where: { id: appealId, guildId, applicantDiscordId: antragstellerDiscordId },
  });
  if (!appeal) {
    // Bewusst NOT_FOUND und nicht FORBIDDEN: ein anderer Code verriete, dass
    // es diesen Antrag gibt (§32, IDOR).
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }
  return appeal;
}

/** Der aktuelle Antrag einer Person, falls es einen gibt. */
export async function aktuellerAppeal(
  guildId: string,
  discordId: string,
): Promise<Appeal | null> {
  return prisma.appeal.findFirst({
    where: { guildId, applicantDiscordId: discordId },
    orderBy: { createdAt: 'desc' },
  });
}

// --- Entwurf und Einreichung ------------------------------------------------

export type Antworten = Partial<Record<string, string>>;

/**
 * Die Antworten prüfen.
 *
 * Serverseitig, weil die Prüfung im Browser eine Bequemlichkeit ist und keine
 * Zusage. Längen und Pflichtfelder stehen an der Fragenliste - eine zweite
 * Liste hier liefe irgendwann auseinander.
 */
export function pruefeAntworten(roh: Antworten): Record<string, string> {
  const geprueft: Record<string, string> = {};
  const fehler: Record<string, string> = {};

  for (const frage of APPEAL_FRAGEN) {
    const wert = sanitizeText(roh[frage.key] ?? '', frage.max);
    if (frage.pflicht && wert.length < frage.min) {
      fehler[frage.key] = `Bitte mindestens ${frage.min} Zeichen.`;
      continue;
    }
    if (!frage.pflicht && wert.length > 0 && wert.length < frage.min) {
      fehler[frage.key] = `Bitte mindestens ${frage.min} Zeichen - oder ganz leer lassen.`;
      continue;
    }
    geprueft[frage.key] = wert;
  }

  if (Object.keys(fehler).length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Bitte fülle die Pflichtfragen vollständig aus.',
      details: { fieldErrors: fehler },
    });
  }
  return geprueft;
}

export interface EinreichEingabe {
  guildId: string;
  applicant: AppealActor & { avatarHash?: string | null };
  antworten: Antworten;
  /** Verhindert, dass ein Doppelklick zwei Anträge erzeugt (§30, §59). */
  idempotencyKey: string;
  gateway?: DiscordGateway;
}

export interface EinreichErgebnis {
  appeal: Appeal;
  /** `false`, wenn derselbe Schlüssel bereits einen Antrag erzeugt hat. */
  neu: boolean;
}

/**
 * Einen Antrag einreichen (§12).
 *
 * Reihenfolge mit Bedacht: erst die Zulässigkeit, dann die Momentaufnahme,
 * dann die Zeile. Wer erst schreibt und danach prüft, hat im Fehlerfall
 * bereits geschrieben.
 *
 * Alles in einer Transaktion: Fallnummer, Antrag und erster
 * Zeitleisteneintrag stehen und fallen zusammen. Bricht etwas ab, gibt es
 * weder Antrag noch verbrauchte Nummer.
 */
export async function reicheEin(eingabe: EinreichEingabe): Promise<EinreichErgebnis> {
  const gateway = eingabe.gateway ?? defaultDiscord;
  const jetzt = new Date();

  // Doppelklick: derselbe Schlüssel, derselbe Antrag.
  const vorhanden = await prisma.appeal.findFirst({
    where: {
      guildId: eingabe.guildId,
      applicantDiscordId: eingabe.applicant.discordId,
      answers: { path: ['__idempotencyKey'], equals: eingabe.idempotencyKey },
    },
  });
  if (vorhanden) {
    return { appeal: vorhanden, neu: false };
  }

  const befund = await pruefeZulaessigkeit(eingabe.applicant.discordId, {
    gateway,
    jetzt,
    guildId: eingabe.guildId,
  });
  if (!befund.erlaubt || !befund.bann) {
    throw new AppError('CONFLICT', {
      userMessage: befund.grund ?? 'Ein Antrag ist derzeit nicht möglich.',
    });
  }

  const antworten = pruefeAntworten(eingabe.antworten);
  const snapshot = baueSnapshot(befund.bann, befund.moderationsEintrag ?? null, jetzt);
  const jahr = jetzt.getUTCFullYear();

  const appeal = await prisma.$transaction(async (tx) => {
    const nummer = await naechsteFallnummer(eingabe.guildId, jahr, tx);
    const angelegt = await tx.appeal.create({
      data: {
        guildId: eingabe.guildId,
        caseNumber: nummer,
        caseYear: jahr,
        applicantDiscordId: eingabe.applicant.discordId,
        applicantUsername: eingabe.applicant.username,
        applicantAvatarHash: eingabe.applicant.avatarHash ?? null,
        status: 'SUBMITTED',
        // Der Schlüssel liegt bei den Antworten und nicht in einer eigenen
        // Spalte: er gehört zur Einreichung und zu nichts sonst.
        answers: { ...antworten, __idempotencyKey: eingabe.idempotencyKey } as Prisma.InputJsonValue,
        banSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        sanctionActionId: snapshot.moderationActionId,
        submittedAt: jetzt,
      },
    });

    await schreibeEreignis(
      {
        appealId: angelegt.id,
        kind: 'SUBMITTED',
        visibility: 'PUBLIC',
        actor: eingabe.applicant,
        publicLabel: 'Antrag eingereicht',
      },
      tx,
    );
    return angelegt;
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_SUBMITTED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: eingabe.applicant.discordId,
    actorUsername: eingabe.applicant.username,
    targetDiscordId: eingabe.applicant.discordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId: appeal.id, quelle: snapshot.quelle },
  });

  // Meldung an das Team und Ereignis fuer die Automation Engine. Beides
  // wirft nie - der Antrag steht bereits, und eine misslungene Meldung darf
  // ihn nicht umwerfen.
  const { meldeNeuerAntrag } = await import('./notify');
  await meldeNeuerAntrag(appeal, { gateway }).catch((error: unknown) => {
    logger.warn('Neuer Antrag konnte nicht gemeldet werden', { appealId: appeal.id, error });
  });

  logger.info('Antrag eingereicht', {
    appealId: appeal.id,
    fall: formatFallnummer(appeal.caseYear, appeal.caseNumber),
  });

  return { appeal, neu: true };
}

// --- Zustand ---------------------------------------------------------------

export interface StatusEingabe {
  guildId: string;
  appealId: string;
  nach: AppealStatus;
  actor: AppealActor;
  /** Wird dem Antragsteller angezeigt, wenn der Übergang öffentlich ist. */
  publicLabel?: string;
  /** Der Zustand wird auch dem Antragsteller gezeigt. */
  oeffentlich?: boolean;
  waitingUntil?: Date | null;
}

/**
 * Den Zustand fortschreiben - unter Bedingung.
 *
 * `status: von` in der Bedingung ist der ganze Punkt: zwei Menschen, die
 * gleichzeitig etwas ändern, führen nicht zu zwei Änderungen. Wer null Zeilen
 * ändert, war zu spät und erfährt es (§58).
 */
export async function setzeStatus(eingabe: StatusEingabe): Promise<Appeal> {
  const appeal = await holeAppeal(eingabe.guildId, eingabe.appealId);
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }
  if (!uebergangErlaubt(appeal.status, eingabe.nach)) {
    throw new AppError('CONFLICT', {
      userMessage: `Aus «${appeal.status}» führt kein Weg nach «${eingabe.nach}».`,
      internalMessage: `Unerlaubter Übergang ${appeal.status} -> ${eingabe.nach}`,
    });
  }

  const ergebnis = await prisma.appeal.updateMany({
    where: { id: appeal.id, status: appeal.status, version: appeal.version },
    data: {
      status: eingabe.nach,
      version: { increment: 1 },
      ...(eingabe.waitingUntil !== undefined ? { waitingUntil: eingabe.waitingUntil } : {}),
    },
  });
  if (ergebnis.count === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Der Antrag wurde inzwischen von jemand anderem geändert. Bitte neu laden.',
    });
  }

  await schreibeEreignis({
    appealId: appeal.id,
    kind: 'STATUS_CHANGED',
    visibility: eingabe.oeffentlich ? 'PUBLIC' : 'INTERNAL',
    actor: eingabe.actor,
    publicLabel: eingabe.publicLabel ?? null,
    detail: { von: appeal.status, nach: eingabe.nach },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_STATUS_CHANGED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId: appeal.id, von: appeal.status, nach: eingabe.nach },
  });

  return { ...appeal, status: eingabe.nach, version: appeal.version + 1 };
}

// --- Zuweisung (§17) --------------------------------------------------------

export async function weiseZu(
  guildId: string,
  appealId: string,
  ziel: AppealActor | null,
  actor: AppealActor,
): Promise<Appeal> {
  const appeal = await holeAppeal(guildId, appealId);
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }
  if (!istOffen(appeal.status)) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dieser Antrag ist abgeschlossen und lässt sich nicht mehr zuweisen.',
    });
  }

  const geaendert = await prisma.appeal.update({
    where: { id: appealId },
    data: {
      assignedToDiscordId: ziel?.discordId ?? null,
      assignedToUsername: ziel?.username ?? null,
      assignedAt: ziel ? new Date() : null,
    },
  });

  await schreibeEreignis({
    appealId,
    kind: ziel ? 'ASSIGNED' : 'UNASSIGNED',
    // Wer den Fall bearbeitet, geht den Antragsteller nichts an (§22, §39).
    visibility: 'INTERNAL',
    actor,
    detail: { zielDiscordId: ziel?.discordId ?? null, zielUsername: ziel?.username ?? null },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_ASSIGNED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId, zielDiscordId: ziel?.discordId ?? null },
  });

  return geaendert;
}

// --- Priorität (§19) --------------------------------------------------------

export async function setzePrioritaet(
  guildId: string,
  appealId: string,
  prioritaet: AppealPriority,
  actor: AppealActor,
): Promise<Appeal> {
  const appeal = await holeAppeal(guildId, appealId);
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }

  const geaendert = await prisma.appeal.update({
    where: { id: appealId },
    data: { priority: prioritaet },
  });

  await schreibeEreignis({
    appealId,
    kind: 'PRIORITY_CHANGED',
    visibility: 'INTERNAL',
    actor,
    detail: { von: appeal.priority, nach: prioritaet },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_PRIORITY_CHANGED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId, von: appeal.priority, nach: prioritaet },
  });

  return geaendert;
}

// --- Nachrichten (§21) ------------------------------------------------------

/** Wie lang eine Nachricht sein darf. */
export const MAX_NACHRICHT = 4000;

export async function schreibeStaffNachricht(
  guildId: string,
  appealId: string,
  inhalt: string,
  actor: AppealActor,
  optionen: { warteTage?: number } = {},
): Promise<Appeal> {
  const appeal = await holeAppeal(guildId, appealId);
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }
  if (!istOffen(appeal.status)) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dieser Antrag ist abgeschlossen - es lässt sich nichts mehr schreiben.',
    });
  }

  const text = sanitizeText(inhalt, MAX_NACHRICHT);
  if (text.length < 2) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Nachricht ist leer.' });
  }

  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  const frist =
    settings.ablaufTageOhneAntwort > 0
      ? new Date(Date.now() + (optionen.warteTage ?? settings.ablaufTageOhneAntwort) * 24 * 3600_000)
      : null;

  await prisma.appealMessage.create({
    data: {
      appealId,
      author: 'STAFF',
      authorDiscordId: actor.discordId,
      authorUsername: actor.username,
      content: text,
    },
  });

  await schreibeEreignis({
    appealId,
    kind: 'STAFF_MESSAGE',
    visibility: 'PUBLIC',
    actor,
    publicLabel: 'Rückfrage gestellt',
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_STAFF_MESSAGE,
    module: APPEALS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId },
  });

  // Der Zustand folgt der Nachricht - aber nur, wenn er darf. Aus einem
  // Endzustand heraus wird ohnehin nicht geschrieben.
  if (uebergangErlaubt(appeal.status, 'WAITING_FOR_APPLICANT')) {
    return setzeStatus({
      guildId,
      appealId,
      nach: 'WAITING_FOR_APPLICANT',
      actor,
      oeffentlich: true,
      publicLabel: 'Wir haben eine Rückfrage',
      waitingUntil: frist,
    });
  }
  return appeal;
}

/**
 * Eine Antwort des Antragstellers.
 *
 * Die Eigentumsprüfung ist hier keine Formsache: dies ist der eine Weg, auf
 * dem jemand ohne Mitgliedschaft in die Datenbank schreibt.
 */
export async function schreibeAntragstellerNachricht(
  guildId: string,
  appealId: string,
  inhalt: string,
  antragsteller: AppealActor,
): Promise<Appeal> {
  const appeal = await requireEigenerAppeal(guildId, appealId, antragsteller.discordId);
  if (!istOffen(appeal.status)) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dein Antrag ist abgeschlossen - es lässt sich nichts mehr schreiben.',
    });
  }

  const text = sanitizeText(inhalt, MAX_NACHRICHT);
  if (text.length < 2) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Nachricht ist leer.' });
  }

  await prisma.appealMessage.create({
    data: {
      appealId,
      author: 'APPLICANT',
      authorDiscordId: antragsteller.discordId,
      authorUsername: antragsteller.username,
      content: text,
    },
  });

  await schreibeEreignis({
    appealId,
    kind: 'APPLICANT_MESSAGE',
    visibility: 'PUBLIC',
    actor: antragsteller,
    publicLabel: 'Deine Antwort ist eingegangen',
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_APPLICANT_REPLIED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: antragsteller.discordId,
    actorUsername: antragsteller.username,
    targetDiscordId: antragsteller.discordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId },
  });

  const { meldeAntwort } = await import('./notify');
  await meldeAntwort(appeal).catch(() => undefined);

  if (uebergangErlaubt(appeal.status, 'WAITING_FOR_STAFF')) {
    return setzeStatus({
      guildId,
      appealId,
      nach: 'WAITING_FOR_STAFF',
      actor: antragsteller,
      oeffentlich: true,
      publicLabel: 'Antwort beim Team eingegangen',
      waitingUntil: null,
    });
  }
  return appeal;
}

// --- Interne Kommentare (§20) -----------------------------------------------

export async function schreibeInternenKommentar(
  guildId: string,
  appealId: string,
  inhalt: string,
  actor: AppealActor,
): Promise<void> {
  const appeal = await holeAppeal(guildId, appealId);
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }

  const text = sanitizeText(inhalt, MAX_NACHRICHT);
  if (text.length < 2) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Kommentar ist leer.' });
  }

  await prisma.appealInternalComment.create({
    data: {
      appealId,
      authorDiscordId: actor.discordId,
      authorUsername: actor.username,
      content: text,
    },
  });

  await schreibeEreignis({
    appealId,
    kind: 'INTERNAL_COMMENT',
    // Niemals öffentlich. Das ist der ganze Zweck dieser Tabelle.
    visibility: 'INTERNAL',
    actor,
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_INTERNAL_COMMENT,
    module: APPEALS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId },
  });
}

// --- Rückzug (§45) ----------------------------------------------------------

export async function ziehZurueck(
  guildId: string,
  appealId: string,
  antragsteller: AppealActor,
): Promise<Appeal> {
  const appeal = await requireEigenerAppeal(guildId, appealId, antragsteller.discordId);
  if (!uebergangErlaubt(appeal.status, 'WITHDRAWN')) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dein Antrag lässt sich nicht mehr zurückziehen.',
    });
  }

  const ergebnis = await prisma.appeal.updateMany({
    where: { id: appealId, status: appeal.status },
    data: { status: 'WITHDRAWN', closedAt: new Date(), version: { increment: 1 } },
  });
  if (ergebnis.count === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dein Antrag wurde inzwischen geändert. Bitte neu laden.',
    });
  }

  await schreibeEreignis({
    appealId,
    kind: 'WITHDRAWN',
    visibility: 'PUBLIC',
    actor: antragsteller,
    publicLabel: 'Antrag zurückgezogen',
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_WITHDRAWN,
    module: APPEALS_MODULE_ID,
    actorDiscordId: antragsteller.discordId,
    actorUsername: antragsteller.username,
    targetDiscordId: antragsteller.discordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId },
  });

  logger.info('Antrag zurückgezogen', { appealId });
  return { ...appeal, status: 'WITHDRAWN' };
}
