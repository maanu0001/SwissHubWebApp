import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { Appeal } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import { unbanMember, type ModerationActor } from '../moderation';
import { getModuleSettings } from '../module-state';
import { APPEALS_MODULE_ID, APPEALS_PERMISSIONS, type AppealsSettings } from './config';
import { formatFallnummer } from './numbering';
import { schreibeEreignis, type AppealActor } from './service';
import { istOffen } from './status';

const logger = createLogger('appeals:decision');

/**
 * Die Entscheidung.
 *
 * Der heikelste Vorgang des Moduls, und er hat drei Eigenschaften, die
 * zusammengehören:
 *
 * 1. **Genau eine Entscheidung gewinnt (§58).** Zwei Moderatoren, die
 *    gleichzeitig auf «Genehmigen» und «Ablehnen» drücken, dürfen nicht beide
 *    durchkommen. Der Zuschlag wird über eine Bedingung geholt, die nur einmal
 *    zutrifft - wer null Zeilen ändert, war zu spät und erfährt es.
 * 2. **Entschieden ist nicht ausgeführt (§26).** Die Entscheidung steht in
 *    der Datenbank, auch wenn Discord gerade nicht antwortet. Der Antrag sagt
 *    dann «genehmigt, Entbannung ausstehend» - und nicht, alles sei gut.
 * 3. **Die Entbannung läuft über das Moderation Center (§25, §41).** Kein
 *    eigener Discord-Aufruf. `unbanMember` prüft `moderation.unban`, die
 *    Rangfolge und die geschützten Konten - dieses Modul kann daran nicht
 *    vorbei, und das ist der Sinn.
 */

export interface EntscheidungsEingabe {
  guildId: string;
  appealId: string;
  actor: AppealActor;
  /** Was der Antragsteller liest. Pflicht - eine Entscheidung ohne Begründung ist keine. */
  publicDecision: string;
  /** Was nur das Team liest. */
  internalDecision?: string | null;
  gateway?: DiscordGateway;
}

export interface GenehmigungsEingabe extends EntscheidungsEingabe {
  /** Die Entbannung gleich durchführen. */
  entbannen: boolean;
  /**
   * Der Moderationshandelnde für die Entbannung.
   *
   * Bewusst getrennt vom `actor`: `unbanMember` prüft damit die
   * Moderationsberechtigung und die Rangfolge. Wer im Antrag entscheiden
   * darf, darf deswegen noch nicht auf Discord entbannen.
   */
  moderationActor?: ModerationActor;
}

export interface AblehnungsEingabe extends EntscheidungsEingabe {
  /** Darf die Person es erneut versuchen? */
  erneutErlaubt: boolean;
  /** Ab wann. Nur bei `erneutErlaubt`. Leer = Vorgabe aus den Einstellungen. */
  naechsteMoeglichkeitAm?: Date | null;
}

export interface EntscheidungsErgebnis {
  appeal: Appeal;
  /** Zustand der Discord-Entbannung, sofern eine versucht wurde. */
  entbannung?: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NO_OP' | 'NICHT_VERSUCHT';
  /** Was in der Oberfläche stehen soll, wenn die Entbannung nicht klappte. */
  hinweis?: string;
}

function pruefeBegruendung(roh: string): string {
  const text = sanitizeText(roh, 4000);
  if (text.length < 10) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Bitte eine Begründung angeben - sie geht an den Antragsteller.',
    });
  }
  return text;
}

/**
 * Braucht diese Entscheidung eine zweite Person? (§24)
 *
 * Die Einstellung entscheidet. `GENEHMIGUNG` ist der sinnvolle Mittelweg: eine
 * Ablehnung ändert am Zustand nichts, eine Genehmigung holt jemanden zurück
 * auf den Server.
 */
export async function brauchtVierAugen(art: 'APPROVE' | 'REJECT'): Promise<boolean> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  if (settings.vierAugen === 'IMMER') {
    return true;
  }
  return settings.vierAugen === 'GENEHMIGUNG' && art === 'APPROVE';
}

/**
 * Den Zuschlag für die Entscheidung holen.
 *
 * `decidedAt: null` in der Bedingung: nur der erste kommt durch. Der zweite
 * ändert null Zeilen und bekommt eine Meldung statt einer zweiten
 * Entscheidung.
 */
async function holeZuschlag(appeal: Appeal, jetzt: Date): Promise<boolean> {
  const ergebnis = await prisma.appeal.updateMany({
    where: { id: appeal.id, decidedAt: null, status: appeal.status },
    data: { decidedAt: jetzt, version: { increment: 1 } },
  });
  return ergebnis.count > 0;
}

async function ladeOffenen(guildId: string, appealId: string): Promise<Appeal> {
  const appeal = await prisma.appeal.findFirst({ where: { id: appealId, guildId } });
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }
  if (!istOffen(appeal.status)) {
    throw new AppError('CONFLICT', { userMessage: 'Über diesen Antrag wurde bereits entschieden.' });
  }
  return appeal;
}

// --- Vorschlag (Vier-Augen) -------------------------------------------------

/**
 * Eine Entscheidung vorschlagen.
 *
 * Der Antrag geht in `DECISION_PENDING`; die Wirkung tritt erst ein, wenn eine
 * **andere** Person bestätigt. Wer den eigenen Vorschlag bestätigen könnte,
 * hätte kein Vier-Augen-Prinzip, sondern zwei Klicks.
 */
export async function schlageVor(
  eingabe: EntscheidungsEingabe & { art: 'APPROVE' | 'REJECT' },
): Promise<Appeal> {
  const appeal = await ladeOffenen(eingabe.guildId, eingabe.appealId);
  const oeffentlich = pruefeBegruendung(eingabe.publicDecision);
  const jetzt = new Date();

  const ergebnis = await prisma.appeal.updateMany({
    where: { id: appeal.id, status: appeal.status, proposedAt: null },
    data: {
      status: 'DECISION_PENDING',
      decisionKind: eingabe.art,
      publicDecision: oeffentlich,
      internalDecision: eingabe.internalDecision
        ? sanitizeText(eingabe.internalDecision, 4000)
        : null,
      proposedByDiscordId: eingabe.actor.discordId,
      proposedByUsername: eingabe.actor.username,
      proposedAt: jetzt,
      version: { increment: 1 },
    },
  });
  if (ergebnis.count === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Für diesen Antrag liegt bereits ein Vorschlag vor.',
    });
  }

  await schreibeEreignis({
    appealId: appeal.id,
    kind: 'DECISION_PROPOSED',
    // Ein Vorschlag ist noch keine Entscheidung - der Antragsteller erführe
    // sonst von etwas, das noch kippen kann.
    visibility: 'INTERNAL',
    actor: eingabe.actor,
    detail: { art: eingabe.art },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_DECISION_PROPOSED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId: appeal.id, art: eingabe.art },
  });

  return { ...appeal, status: 'DECISION_PENDING' };
}

/** Die zweite Person - sie darf nicht dieselbe sein. */
export function pruefeZweitePerson(appeal: Appeal, actor: AppealActor): void {
  if (appeal.proposedByDiscordId && appeal.proposedByDiscordId === actor.discordId) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Den eigenen Vorschlag darf niemand selbst bestätigen.',
    });
  }
}

// --- Genehmigung ------------------------------------------------------------

export async function genehmige(eingabe: GenehmigungsEingabe): Promise<EntscheidungsErgebnis> {
  const appeal = await ladeOffenen(eingabe.guildId, eingabe.appealId);
  const oeffentlich = pruefeBegruendung(eingabe.publicDecision);
  const jetzt = new Date();

  if (appeal.status === 'DECISION_PENDING') {
    pruefeZweitePerson(appeal, eingabe.actor);
  }

  if (!(await holeZuschlag(appeal, jetzt))) {
    throw new AppError('CONFLICT', { userMessage: 'Über diesen Antrag wurde bereits entschieden.' });
  }

  await prisma.appeal.update({
    where: { id: appeal.id },
    data: {
      status: 'APPROVED',
      decisionKind: 'APPROVE',
      publicDecision: oeffentlich,
      internalDecision: eingabe.internalDecision
        ? sanitizeText(eingabe.internalDecision, 4000)
        : appeal.internalDecision,
      decidedByDiscordId: eingabe.actor.discordId,
      decidedByUsername: eingabe.actor.username,
      // Eine Genehmigung hebt jede Sperre auf - sie ist gegenstandslos.
      nextEligibleAt: null,
      finalRejection: false,
    },
  });

  await schreibeEreignis({
    appealId: appeal.id,
    kind: 'APPROVED',
    visibility: 'PUBLIC',
    actor: eingabe.actor,
    publicLabel: 'Entscheidung getroffen',
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_APPROVED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId: appeal.id, entbannen: eingabe.entbannen },
  });

  const { meldeEntbannungGescheitert, meldeEntscheidung } = await import('./notify');

  if (!eingabe.entbannen) {
    await meldeEntscheidung(appeal, 'APPROVE', { entbannt: false }).catch(() => undefined);
    return { appeal: { ...appeal, status: 'APPROVED' }, entbannung: 'NICHT_VERSUCHT' };
  }

  const ausgang = await fuehreEntbannungAus(appeal, eingabe);
  const aktualisiert = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });

  await meldeEntscheidung(aktualisiert, 'APPROVE', {
    entbannt: ausgang.zustand === 'COMPLETED' || ausgang.zustand === 'NO_OP',
  }).catch(() => undefined);

  if (ausgang.zustand === 'PARTIAL' || ausgang.zustand === 'FAILED') {
    await meldeEntbannungGescheitert(
      aktualisiert,
      ausgang.hinweis ?? 'Die Entbannung ist gescheitert.',
      { ...(eingabe.gateway ? { gateway: eingabe.gateway } : {}) },
    ).catch(() => undefined);
  }

  return {
    appeal: aktualisiert,
    entbannung: ausgang.zustand,
    ...(ausgang.hinweis ? { hinweis: ausgang.hinweis } : {}),
  };
}

/**
 * Die Entbannung ausführen - idempotent (§25, §59).
 *
 * Besteht kein Bann mehr, ist das kein Fehler: der gewünschte Zustand ist
 * bereits da. `unbanMember` wirft in diesem Fall `NOT_FOUND`; hier wird daraus
 * ein NO_OP. Andersherum würde ein zweiter Klick auf «Entbannen» eine
 * Fehlermeldung erzeugen, obwohl alles stimmt.
 */
export async function fuehreEntbannungAus(
  appeal: Appeal,
  eingabe: { actor: AppealActor; moderationActor?: ModerationActor; gateway?: DiscordGateway },
): Promise<{ zustand: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NO_OP'; hinweis?: string }> {
  const gateway = eingabe.gateway ?? defaultDiscord;
  const jetzt = new Date();

  if (!eingabe.moderationActor) {
    // Ohne Moderationshandelnden gibt es keine Berechtigungsprüfung - und
    // ohne die wird nicht entbannt. Lieber ein sichtbarer Hinweis als eine
    // Entbannung, die niemand geprüft hat.
    await vermerkeEntbannung(appeal.id, 'FAILED', 'Keine Moderationsberechtigung übergeben.', jetzt);
    return {
      zustand: 'FAILED',
      hinweis: 'Die Entbannung wurde nicht ausgeführt - es fehlt die Moderationsberechtigung.',
    };
  }

  await prisma.appeal.update({
    where: { id: appeal.id },
    data: { unbanStatus: 'EXECUTING', unbanAttemptAt: jetzt, unbanError: null },
  });

  await schreibeEreignis({
    appealId: appeal.id,
    kind: 'UNBAN_ATTEMPTED',
    visibility: 'INTERNAL',
    actor: eingabe.actor,
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_UNBAN_ATTEMPTED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: { appealId: appeal.id },
  });

  try {
    await unbanMember(
      {
        actor: eingabe.moderationActor,
        targetDiscordId: appeal.applicantDiscordId,
        reason: `Entbannungsantrag ${formatFallnummer(appeal.caseYear, appeal.caseNumber)} genehmigt`,
      },
      { gateway },
    );

    await vermerkeEntbannung(appeal.id, 'COMPLETED', null, jetzt);
    await schreibeEreignis({
      appealId: appeal.id,
      kind: 'UNBAN_SUCCEEDED',
      visibility: 'PUBLIC',
      actor: eingabe.actor,
      publicLabel: 'Dein Bann wurde aufgehoben',
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.APPEAL_UNBAN_SUCCEEDED,
      module: APPEALS_MODULE_ID,
      actorDiscordId: eingabe.actor.discordId,
      actorUsername: eingabe.actor.username,
      targetDiscordId: appeal.applicantDiscordId,
      targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      metadata: { appealId: appeal.id },
    });
    return { zustand: 'COMPLETED' };
  } catch (error) {
    const code = (error as { code?: string })?.code;

    // Kein Bann mehr - der gewünschte Zustand besteht bereits.
    if (code === 'NOT_FOUND') {
      await vermerkeEntbannung(appeal.id, 'COMPLETED', null, jetzt);
      await schreibeEreignis({
        appealId: appeal.id,
        kind: 'UNBAN_SUCCEEDED',
        visibility: 'PUBLIC',
        actor: eingabe.actor,
        publicLabel: 'Dein Bann wurde aufgehoben',
        detail: { hinweis: 'Es bestand bereits kein Bann mehr.' },
      });
      return { zustand: 'NO_OP', hinweis: 'Es bestand bereits kein Bann mehr.' };
    }

    const meldung =
      (error as { userMessage?: string })?.userMessage ?? 'Die Entbannung ist gescheitert.';
    await vermerkeEntbannung(appeal.id, 'PARTIAL', meldung, jetzt);
    await schreibeEreignis({
      appealId: appeal.id,
      kind: 'UNBAN_FAILED',
      visibility: 'INTERNAL',
      actor: eingabe.actor,
      detail: { grund: meldung },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.APPEAL_UNBAN_FAILED,
      module: APPEALS_MODULE_ID,
      actorDiscordId: eingabe.actor.discordId,
      actorUsername: eingabe.actor.username,
      targetDiscordId: appeal.applicantDiscordId,
      targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      success: false,
      errorMessage: meldung,
      metadata: { appealId: appeal.id },
    });

    logger.warn('Entbannung nach Genehmigung gescheitert', { appealId: appeal.id, code });
    return {
      // PARTIAL und nicht FAILED: die Entscheidung steht, nur die Wirkung
      // fehlt noch. Ein erneuter Versuch ist möglich.
      zustand: 'PARTIAL',
      hinweis: `Entscheidung genehmigt, die Entbannung konnte noch nicht durchgeführt werden: ${meldung}`,
    };
  }
}

async function vermerkeEntbannung(
  appealId: string,
  zustand: 'COMPLETED' | 'PARTIAL' | 'FAILED',
  fehler: string | null,
  jetzt: Date,
): Promise<void> {
  await prisma.appeal.update({
    where: { id: appealId },
    data: { unbanStatus: zustand, unbanAttemptAt: jetzt, unbanError: fehler?.slice(0, 500) ?? null },
  });
}

/**
 * Eine gescheiterte Entbannung erneut versuchen (§26).
 *
 * Nur, wenn die Entscheidung eine Genehmigung war und die Ausführung offen
 * ist. Ein erneuter Versuch auf einer abgelehnten Entscheidung wäre das
 * Gegenteil dessen, was entschieden wurde.
 */
export async function wiederholeEntbannung(
  guildId: string,
  appealId: string,
  eingabe: { actor: AppealActor; moderationActor: ModerationActor; gateway?: DiscordGateway },
): Promise<EntscheidungsErgebnis> {
  const appeal = await prisma.appeal.findFirst({ where: { id: appealId, guildId } });
  if (!appeal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
  }
  if (appeal.decisionKind !== 'APPROVE') {
    throw new AppError('CONFLICT', {
      userMessage: 'Nur eine genehmigte Entscheidung lässt sich entbannen.',
    });
  }
  if (appeal.unbanStatus === 'COMPLETED') {
    return { appeal, entbannung: 'NO_OP', hinweis: 'Die Entbannung ist bereits erfolgt.' };
  }

  const ausgang = await fuehreEntbannungAus(appeal, eingabe);
  const aktualisiert = await prisma.appeal.findUniqueOrThrow({ where: { id: appealId } });
  return {
    appeal: aktualisiert,
    entbannung: ausgang.zustand,
    ...(ausgang.hinweis ? { hinweis: ausgang.hinweis } : {}),
  };
}

// --- Ablehnung (§27) --------------------------------------------------------

export async function lehneAb(eingabe: AblehnungsEingabe): Promise<EntscheidungsErgebnis> {
  const appeal = await ladeOffenen(eingabe.guildId, eingabe.appealId);
  const oeffentlich = pruefeBegruendung(eingabe.publicDecision);
  const jetzt = new Date();

  if (appeal.status === 'DECISION_PENDING') {
    pruefeZweitePerson(appeal, eingabe.actor);
  }

  if (!(await holeZuschlag(appeal, jetzt))) {
    throw new AppError('CONFLICT', { userMessage: 'Über diesen Antrag wurde bereits entschieden.' });
  }

  const naechste = eingabe.erneutErlaubt
    ? (eingabe.naechsteMoeglichkeitAm ?? (await vorgabeSperrfrist(appeal, jetzt)))
    : null;

  await prisma.appeal.update({
    where: { id: appeal.id },
    data: {
      status: 'REJECTED',
      decisionKind: 'REJECT',
      publicDecision: oeffentlich,
      internalDecision: eingabe.internalDecision
        ? sanitizeText(eingabe.internalDecision, 4000)
        : appeal.internalDecision,
      decidedByDiscordId: eingabe.actor.discordId,
      decidedByUsername: eingabe.actor.username,
      nextEligibleAt: naechste,
      finalRejection: !eingabe.erneutErlaubt,
    },
  });

  await schreibeEreignis({
    appealId: appeal.id,
    kind: 'REJECTED',
    visibility: 'PUBLIC',
    actor: eingabe.actor,
    publicLabel: 'Entscheidung getroffen',
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.APPEAL_REJECTED,
    module: APPEALS_MODULE_ID,
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: appeal.applicantDiscordId,
    targetLabel: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    metadata: {
      appealId: appeal.id,
      erneutErlaubt: eingabe.erneutErlaubt,
      naechsteMoeglichkeitAm: naechste?.toISOString() ?? null,
    },
  });

  // Keine Discord-Aktion. Eine Ablehnung ändert nichts an der Sanktion - sie
  // bestätigt sie.
  const aktualisiert = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });

  const { meldeEntscheidung } = await import('./notify');
  await meldeEntscheidung(aktualisiert, 'REJECT', {
    erneutErlaubt: eingabe.erneutErlaubt,
  }).catch(() => undefined);

  return { appeal: aktualisiert, entbannung: 'NICHT_VERSUCHT' };
}

/**
 * Die vorgegebene Sperrfrist (§31).
 *
 * Die zweite Ablehnung wiegt schwerer als die erste - deshalb die längere
 * Frist. Gezählt werden die abgeschlossenen Ablehnungen dieser Person; die
 * gerade laufende ist noch nicht darunter.
 */
async function vorgabeSperrfrist(appeal: Appeal, jetzt: Date): Promise<Date> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  const frueher = await prisma.appeal.count({
    where: {
      guildId: appeal.guildId,
      applicantDiscordId: appeal.applicantDiscordId,
      decisionKind: 'REJECT',
      id: { not: appeal.id },
    },
  });
  const tage = frueher >= 1 ? settings.cooldownZweiteAblehnungTage : settings.cooldownTage;
  return new Date(jetzt.getTime() + tage * 24 * 3600_000);
}

/** Die Berechtigung, die für eine Entscheidung nötig ist. */
export function berechtigungFuer(art: 'APPROVE' | 'REJECT'): string {
  return art === 'APPROVE' ? APPEALS_PERMISSIONS.approve : APPEALS_PERMISSIONS.reject;
}
