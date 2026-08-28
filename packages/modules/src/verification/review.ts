import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { VerificationRequest } from '@swisshub/database';
import type { DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { conflict, forbidden } from '@swisshub/shared';
import { banMember, type ModerationActor } from '../moderation/service';
import { VERIFICATION_MODULE_ID, VERIFICATION_PERMISSIONS, type VerificationSettings } from './config';
import { classify, reichtZumFreischalten, type AiAusgang, type AiClient } from './ai';
import { entscheide, requireRequest, verificationSettings, verify } from './service';

const logger = createLogger('verification:review');

/**
 * Wer entscheidet - und was er dabei darf.
 *
 * Die beiden Wege sind hier bewusst nicht symmetrisch:
 *
 *  - `humanVerify` und `aiPipeline` fuehren beide zu VERIFIED.
 *  - `humanReject` fuehrt zu REJECTED und zu einem Bann. Es verlangt einen
 *    menschlichen Handelnden mit `verification.reject` und ist von der AI
 *    aus nicht erreichbar: `aiPipeline` ruft es nicht auf, und es gibt keinen
 *    Parameter, mit dem man es als AI aufrufen koennte.
 *
 * Das ist keine Frage der Konfiguration. Eine falsch gesetzte Einstellung
 * kann die AI nicht in den Sanktionspfad bringen, weil er von dort aus nicht
 * existiert.
 */

/** Wer im Namen eines Menschen handelt. */
export interface HumanActor extends ModerationActor {
  can(permission: string): boolean;
}

function pruefeRecht(actor: HumanActor, permission: string, meldung: string): void {
  if (!actor.can(permission)) {
    throw forbidden(`verification: ${actor.discordId} fehlt ${permission}`, meldung);
  }
}

export interface EntscheidungsErgebnis {
  request: VerificationRequest;
  /** Hat dieser Aufruf tatsaechlich entschieden - oder war jemand schneller? */
  gewonnen: boolean;
  rollenFehler?: string;
}

/**
 * Ein Mensch schaltet frei.
 *
 * Prueft die Berechtigung, dann den Zustand, dann erst wird gehandelt. Kommt
 * der Aufruf zu spaet - Doppelklick, zweiter Moderator, die AI war schneller -
 * geschieht nichts weiter, und der Aufrufer erfaehrt es.
 */
export async function humanVerify(
  actor: HumanActor,
  requestId: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<EntscheidungsErgebnis> {
  pruefeRecht(actor, VERIFICATION_PERMISSIONS.approve, 'Du darfst niemanden freischalten.');
  const vorher = await requireRequest(requestId);
  if (vorher.decidedAt) {
    return { request: vorher, gewonnen: false };
  }

  try {
    const ergebnis = await verify(
      requestId,
      { by: 'HUMAN', discordId: actor.discordId, username: actor.username },
      { gateway: options.gateway },
    );
    return {
      request: ergebnis.request,
      gewonnen: true,
      ...(ergebnis.rollen.ok ? {} : { rollenFehler: ergebnis.rollen.grund }),
    };
  } catch (error) {
    // `verify` wirft genau dann, wenn der Wettlauf verloren ging.
    const frisch = await requireRequest(requestId);
    if (frisch.decidedAt) {
      return { request: frisch, gewonnen: false };
    }
    throw error;
  }
}

export const ABLEHNUNGSGRUENDE = [
  'Spam/Bot',
  'Keine sinnvolle Verifikation',
  'Verdächtiger Account',
  'Regelverstoss',
  'Sonstiges',
] as const;

/**
 * Ein Mensch lehnt ab - und bannt damit.
 *
 * Der Bann laeuft ueber `moderation.banMember` und nicht ueber einen eigenen
 * Discord-Aufruf: nur so steht er in der Akte, im Ban-Log und im
 * Moderation Center, statt in einer zweiten Welt neben der Moderation.
 *
 * Dass diese Funktion einen `HumanActor` verlangt, ist der eigentliche
 * Schutz: die AI hat keinen, kann keinen bauen, und `aiPipeline` ruft sie
 * nicht auf.
 */
export async function humanReject(
  actor: HumanActor,
  requestId: string,
  reason: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<EntscheidungsErgebnis> {
  pruefeRecht(
    actor,
    VERIFICATION_PERMISSIONS.reject,
    'Du darfst niemanden ablehnen. Ablehnen bedeutet einen Bann.',
  );
  const grund = reason.trim();
  if (grund.length < 3) {
    throw conflict('Bitte einen Grund angeben - er steht später in der Akte.');
  }

  const vorher = await requireRequest(requestId);
  if (vorher.decidedAt) {
    return { request: vorher, gewonnen: false };
  }

  // Erst den Zuschlag holen, dann bannen. Umgekehrt koennte ein verlorener
  // Wettlauf jemanden gebannt haben, der gerade freigeschaltet wurde.
  const entschieden = await entscheide(requestId, {
    status: 'REJECTED',
    by: 'HUMAN',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    reason: grund,
  });
  if (!entschieden) {
    return { request: await requireRequest(requestId), gewonnen: false };
  }

  try {
    await banMember(
      {
        actor,
        targetDiscordId: vorher.discordId,
        reason: `Verifikation abgelehnt: ${grund}`,
        note: vorher.latestMessage ? `Verifikationsnachricht: ${vorher.latestMessage}` : null,
      },
      { gateway: options.gateway },
    );
  } catch (error) {
    // Der Vorgang bleibt abgelehnt - entschieden ist entschieden -, aber der
    // gescheiterte Bann wird festgehalten. Ihn zu verschweigen hiesse, eine
    // Person fuer gebannt zu halten, die es nicht ist.
    logger.error('Bann nach Ablehnung fehlgeschlagen', { requestId, error });
    await prisma.verificationRequest.update({
      where: { id: requestId },
      data: {
        decisionReason: `${grund} — Bann fehlgeschlagen, bitte von Hand prüfen.`,
      },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_ERROR,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      targetDiscordId: vorher.discordId,
      targetLabel: vorher.displayName ?? vorher.discordId,
      success: false,
      metadata: { requestId, schritt: 'ban' },
    });
    return {
      request: await requireRequest(requestId),
      gewonnen: true,
      rollenFehler: 'Der Bann konnte nicht ausgeführt werden. Bitte von Hand prüfen.',
    };
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VERIFICATION_REJECTED,
    module: VERIFICATION_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: vorher.discordId,
    targetLabel: vorher.displayName ?? vorher.username ?? vorher.discordId,
    success: true,
    metadata: { requestId, reason: grund },
  });

  logger.info('Verifikation abgelehnt', { requestId, actor: actor.discordId });
  return { request: entschieden, gewonnen: true };
}

export interface AiPipelineErgebnis {
  request: VerificationRequest;
  /** Die AI hat freigeschaltet. */
  freigeschaltet: boolean;
  /** Es liegt eine Einordnung vor - unabhaengig davon, ob sie reichte. */
  eingeordnet: boolean;
  ausgang: AiAusgang;
}

/**
 * Die AI einordnen lassen und - wenn sicher genug - freischalten.
 *
 * Der einzige Pfad von einem AI-Ergebnis zu einer Aenderung. Er endet
 * entweder bei VERIFIED oder bei WAITING_FOR_REVIEW. Es gibt keinen dritten
 * Ausgang, und insbesondere keinen, der sanktioniert.
 *
 * Scheitert die AI auf irgendeine Weise, bleibt der Vorgang bei der
 * Moderation. Das ist der sichere Ausgang: ein Mensch schaut ohnehin darauf.
 */
export async function aiPipeline(
  requestId: string,
  options: {
    gateway?: DiscordGateway;
    settings?: VerificationSettings;
    /** Eigener Zugang - fuer Tests, damit kein Netz noetig ist. */
    client?: AiClient;
  } = {},
): Promise<AiPipelineErgebnis> {
  const settings = options.settings ?? (await verificationSettings());
  const vorher = await requireRequest(requestId);

  const abbruch = (ausgang: AiAusgang): AiPipelineErgebnis => ({
    request: vorher,
    freigeschaltet: false,
    eingeordnet: false,
    ausgang,
  });

  if (!settings.aiEnabled) {
    return abbruch({ ok: false, error: 'AI-Prüfung ist ausgeschaltet.' });
  }
  if (vorher.decidedAt) {
    return abbruch({ ok: false, error: 'Bereits entschieden.' });
  }
  if (!vorher.latestMessage) {
    return abbruch({ ok: false, error: 'Keine Nachricht vorhanden.' });
  }
  // Kostenbremse: wer zehnmal schreibt, loest nicht zehn Anfragen aus.
  if (vorher.aiAttempts >= settings.aiMaxAttempts) {
    return abbruch({ ok: false, error: 'Höchstzahl der AI-Anfragen erreicht.' });
  }

  // Den Versuch vormerken und in AI_ANALYZING wechseln - aber nur, solange
  // niemand entschieden hat. So laeuft die AI nicht auf einem Fall weiter,
  // den ein Moderator gerade abgeschlossen hat.
  const belegt = await prisma.verificationRequest.updateMany({
    where: { id: requestId, decidedAt: null, status: 'WAITING_FOR_REVIEW' },
    data: { status: 'AI_ANALYZING', aiAttempts: { increment: 1 } },
  });
  if (belegt.count === 0) {
    return abbruch({ ok: false, error: 'Der Vorgang wird bereits geprüft oder ist entschieden.' });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VERIFICATION_AI_STARTED,
    module: VERIFICATION_MODULE_ID,
    actorDiscordId: 'system',
    actorUsername: 'AI-Prüfung',
    targetDiscordId: vorher.discordId,
    targetLabel: vorher.displayName ?? vorher.discordId,
    success: true,
    metadata: { requestId },
  });

  const ausgang = await classify(vorher.latestMessage, settings, { client: options.client });

  // Ergebnis festhalten - auch ein gescheitertes. Ohne den Vermerk sieht die
  // Moderation nur einen Fall, bei dem «nichts passiert ist».
  await prisma.verificationRequest.updateMany({
    where: { id: requestId, decidedAt: null },
    data: {
      status: 'WAITING_FOR_REVIEW',
      aiCheckedAt: new Date(),
      aiModel: ausgang.model ?? null,
      ...(ausgang.ok && ausgang.result
        ? {
            aiVerdict: ausgang.result.classification,
            aiConfidence: Math.round(ausgang.result.confidence * 10_000) / 10_000,
            aiReasonCode: ausgang.result.reasonCode,
            aiError: null,
          }
        : { aiVerdict: 'FAILED' as const, aiError: (ausgang.error ?? 'unbekannt').slice(0, 300) }),
    },
  });

  if (!ausgang.ok || !ausgang.result) {
    logger.info('AI-Einordnung ohne Ergebnis - geht an die Moderation', {
      requestId,
      grund: ausgang.error,
    });
    return { request: await requireRequest(requestId), freigeschaltet: false, eingeordnet: false, ausgang };
  }

  if (!reichtZumFreischalten(ausgang.result, settings)) {
    return { request: await requireRequest(requestId), freigeschaltet: false, eingeordnet: true, ausgang };
  }

  try {
    const ergebnis = await verify(requestId, { by: 'AI' }, { gateway: options.gateway, settings });
    return { request: ergebnis.request, freigeschaltet: true, eingeordnet: true, ausgang };
  } catch {
    // Wettlauf verloren: ein Mensch war schneller. Sein Ergebnis gilt.
    return { request: await requireRequest(requestId), freigeschaltet: false, eingeordnet: true, ausgang };
  }
}
