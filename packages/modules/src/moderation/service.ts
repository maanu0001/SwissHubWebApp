import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { ModerationAction, ModerationActionType, ModerationSource } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import { MODERATION_PERMISSIONS } from './permissions';
import { meldeMassnahme } from './events';
import { assertRangfolge, loadModerationPolicyContext, type ModerationPolicyContext } from './policy';

const log = createLogger('moderation');

/**
 * Das Moderation Center.
 *
 * Ban, Kick und Timeout gehen ueber Discord; Jail bleibt beim Jail-Modul, das
 * es laengst kann. Hier steht keine zweite Jail-Logik - das Moderation Center
 * ist der gemeinsame Eingang, nicht ein zweiter Motor.
 *
 * ## Reihenfolge: erst Discord, dann die Akte
 *
 * Der Eintrag entsteht erst, wenn Discord die Massnahme bestaetigt hat.
 * Andersherum stuende in der Akte ein Bann, den es auf dem Server nie gab -
 * und niemand koennte ihn aufheben, weil es nichts aufzuheben gibt.
 *
 * Ein gescheiterter Versuch verschwindet deshalb nicht, sondern wird als
 * gescheitert vermerkt: wer es versucht hat, ist so interessant wie der
 * Erfolg.
 */

export interface ModerationActor {
  discordId: string;
  username: string;
  roleIds: readonly string[];
  isOwner: boolean;
  can(permission: string): boolean;
}

export interface ModerationOptions {
  gateway?: DiscordGateway;
  /** Vorgeladener Policy-Kontext - spart Discord-Anfragen in Stapelverarbeitung. */
  policyContext?: ModerationPolicyContext;
}

/** Hoechster Discord-Timeout: 28 Tage. Das ist die API, keine Einstellung. */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 3600;

/** Die angebotenen Timeout-Dauern. */
export const TIMEOUT_PRESETS = [
  { label: '5 Minuten', seconds: 300 },
  { label: '10 Minuten', seconds: 600 },
  { label: '30 Minuten', seconds: 1800 },
  { label: '1 Stunde', seconds: 3600 },
  { label: '6 Stunden', seconds: 21_600 },
  { label: '12 Stunden', seconds: 43_200 },
  { label: '1 Tag', seconds: 86_400 },
  { label: '1 Woche', seconds: 604_800 },
] as const;

interface MassnahmeEingabe {
  actor: ModerationActor;
  targetDiscordId: string;
  reason: string;
  /** Interne Notiz - erscheint in der Akte, nicht bei Discord. */
  note?: string | null;
}

/** Pflichtangabe: eine Massnahme ohne Grund ist in einem Monat nicht mehr erklaerbar. */
function pruefeGrund(roh: string): string {
  const grund = sanitizeText(roh, 400);
  if (grund.length < 3) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Bitte einen Grund angeben - er steht später in der Akte.',
    });
  }
  return grund;
}

async function ladeZiel(discordId: string, gateway: DiscordGateway) {
  const member = await gateway.members.get(discordId).catch(() => null);
  return { discordId, member };
}

/**
 * Ziel laden und die Rangfolge pruefen - in einem Schritt, weil das eine ohne
 * das andere nie vorkommt.
 */
async function ladeUndPruefe(
  eingabe: MassnahmeEingabe,
  gateway: DiscordGateway,
  options: ModerationOptions,
  erlaubeNichtmitglied: boolean,
) {
  const [ziel, context] = await Promise.all([
    ladeZiel(eingabe.targetDiscordId, gateway),
    options.policyContext ?? loadModerationPolicyContext(gateway),
  ]);

  assertRangfolge({
    actor: {
      discordId: eingabe.actor.discordId,
      roleIds: eingabe.actor.roleIds,
      isOwner: eingabe.actor.isOwner,
    },
    targetDiscordId: eingabe.targetDiscordId,
    target: ziel.member,
    context,
    erlaubeNichtmitglied,
  });

  return ziel;
}

/**
 * Schreibt den Eintrag in die Akte und ins Audit Log.
 *
 * Beides, weil es zwei Fragen sind: die Akte beantwortet «was ist diesem
 * Mitglied widerfahren», das Audit Log «wer hat in der Anwendung was getan».
 */
async function vermerke(input: {
  type: ModerationActionType;
  actor: ModerationActor;
  target: { discordId: string; username: string };
  reason: string;
  status: 'COMPLETED' | 'FAILED';
  /** Geplantes Ende - nur bei befristeten Massnahmen. */
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  /** Verweis auf den Datensatz, der die Sache traegt - z.B. die Notiz. */
  referenceId?: string | null;
  auditAction: string;
  errorMessage?: string;
  /**
   * Woher die Massnahme kam. Ohne Angabe `WEBAPP` - das Moderation Center
   * ist der einzige Weg hier hinein, und er fuehrt ueber das Dashboard.
   */
  source?: ModerationSource;
}): Promise<ModerationAction> {
  const eintrag = await prisma.moderationAction.create({
    data: {
      type: input.type,
      module: 'moderation',
      actorDiscordId: input.actor.discordId,
      actorUsername: input.actor.username,
      targetDiscordId: input.target.discordId,
      targetUsername: input.target.username,
      reason: input.reason,
      status: input.status,
      // Nur ein tatsaechlich gesetzter Timeout laeuft - ein gescheiterter
      // Versuch bekommt kein Ablaufdatum, sonst zaehlte er als aktiv.
      expiresAt: input.status === 'COMPLETED' ? (input.expiresAt ?? null) : null,
      source: input.source ?? 'WEBAPP',
      actorType: 'HUMAN',
      referenceId: input.referenceId ?? null,
      metadata: { source: input.source ?? 'WEBAPP', ...(input.metadata ?? {}) },
    },
  });

  await safeRecordAudit({
    action: input.auditAction,
    module: 'moderation',
    actorDiscordId: input.actor.discordId,
    actorUsername: input.actor.username,
    targetDiscordId: input.target.discordId,
    targetLabel: input.target.username,
    success: input.status === 'COMPLETED',
    errorMessage: input.errorMessage ?? null,
    metadata: { reason: input.reason, ...(input.metadata ?? {}) },
  });

  // Dieselbe Meldung, die auch eine direkt in Discord verhaengte Massnahme
  // ausloest. Eine Automation, die auf Banns hoert, hoert damit auf alle.
  if (input.status === 'COMPLETED') {
    await meldeMassnahme(eintrag);
  }

  return eintrag;
}

/** Fuehrt die Discord-Seite aus und vermerkt beides - Erfolg wie Fehlschlag. */
async function fuehreAus<T>(
  input: MassnahmeEingabe & {
    type: ModerationActionType;
    auditAction: string;
    targetUsername: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
  arbeit: () => Promise<T>,
): Promise<ModerationAction> {
  const ziel = { discordId: input.targetDiscordId, username: input.targetUsername };

  try {
    await arbeit();
  } catch (error) {
    // Kein «erfolgreich», wenn Discord Nein gesagt hat. Der Versuch bleibt
    // trotzdem in der Akte - er gehoert zur Geschichte des Mitglieds.
    const meldung = error instanceof Error ? error.message : 'unbekannt';
    log.warn('Moderationsmassnahme fehlgeschlagen', { type: input.type, error: meldung });
    await vermerke({
      type: input.type,
      actor: input.actor,
      target: ziel,
      reason: input.reason,
      status: 'FAILED',
      metadata: { ...(input.metadata ?? {}), note: input.note ?? null },
      auditAction: input.auditAction,
      errorMessage: meldung,
    });
    throw new AppError('INTERNAL', {
      userMessage: 'Discord hat die Massnahme abgelehnt. Sie wurde nicht ausgeführt.',
      internalMessage: meldung,
    });
  }

  return vermerke({
    type: input.type,
    actor: input.actor,
    target: ziel,
    reason: input.reason,
    status: 'COMPLETED',
    expiresAt: input.expiresAt ?? null,
    metadata: { ...(input.metadata ?? {}), note: input.note ?? null },
    auditAction: input.auditAction,
  });
}

// --- Bann -----------------------------------------------------------------

export interface BanEingabe extends MassnahmeEingabe {
  /** Wie weit zurueck Nachrichten geloescht werden. Discord: hoechstens 7 Tage. */
  deleteMessageSeconds?: number;
}

export async function banMember(
  eingabe: BanEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.ban)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst niemanden bannen.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  // Ein Bann trifft auch jemanden, der den Server bereits verlassen hat -
  // genau dafuer ist er da.
  const ziel = await ladeUndPruefe(eingabe, gateway, options, true);

  const loeschen = Math.min(Math.max(eingabe.deleteMessageSeconds ?? 0, 0), 604_800);

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'BAN',
      auditAction: AUDIT_ACTIONS.MODERATION_BAN,
      targetUsername: ziel.member?.displayName ?? 'Unbekannt',
      metadata: { deleteMessageSeconds: loeschen },
    },
    () =>
      gateway.bans.add(eingabe.targetDiscordId, {
        reason: `${grund} (${eingabe.actor.username})`,
        deleteMessageSeconds: loeschen,
      }),
  );
}

export async function unbanMember(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.unban)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Banns aufheben.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  const bann = await gateway.bans.get(eingabe.targetDiscordId).catch(() => null);
  if (!bann) {
    throw new AppError('NOT_FOUND', { userMessage: 'Für diese Person besteht kein Bann.' });
  }

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'UNBAN',
      auditAction: AUDIT_ACTIONS.MODERATION_UNBAN,
      targetUsername: 'Unbekannt',
    },
    () => gateway.bans.remove(eingabe.targetDiscordId, `${grund} (${eingabe.actor.username})`),
  );
}

// --- Kick -----------------------------------------------------------------

export async function kickMember(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.kick)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst niemanden kicken.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  // Wer nicht da ist, kann nicht entfernt werden - die Policy sagt das selbst.
  const ziel = await ladeUndPruefe(eingabe, gateway, options, false);

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'KICK',
      auditAction: AUDIT_ACTIONS.MODERATION_KICK,
      targetUsername: ziel.member?.displayName ?? 'Unbekannt',
    },
    () => gateway.members.kick(eingabe.targetDiscordId, `${grund} (${eingabe.actor.username})`),
  );
}

// --- Timeout --------------------------------------------------------------

export interface TimeoutEingabe extends MassnahmeEingabe {
  seconds: number;
}

export async function timeoutMember(
  eingabe: TimeoutEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.timeout)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Timeouts setzen.' });
  }
  if (eingabe.seconds < 60 || eingabe.seconds > MAX_TIMEOUT_SECONDS) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Ein Timeout dauert mindestens eine Minute und höchstens 28 Tage.',
    });
  }

  const grund = pruefeGrund(eingabe.reason);
  const ziel = await ladeUndPruefe(eingabe, gateway, options, false);

  const bis = new Date(Date.now() + eingabe.seconds * 1000);

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'TIMEOUT',
      auditAction: AUDIT_ACTIONS.MODERATION_TIMEOUT,
      targetUsername: ziel.member?.displayName ?? 'Unbekannt',
      expiresAt: bis,
      metadata: { seconds: eingabe.seconds },
    },
    () => gateway.members.timeout(eingabe.targetDiscordId, bis, `${grund} (${eingabe.actor.username})`),
  );
}

export async function removeTimeout(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.timeoutRemove)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Timeouts aufheben.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  const ziel = await ladeZiel(eingabe.targetDiscordId, gateway);
  if (!ziel.member) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Person ist nicht auf dem Server.' });
  }

  // Bewusst ohne Rangfolgepruefung: das Aufheben einer Massnahme kann niemanden
  // schlechter stellen. Wer die Berechtigung hat, darf jeden Timeout beenden -
  // sonst bliebe ein zu hoch gesetzter Timeout haengen, bis er ablaeuft.
  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'TIMEOUT_REMOVE',
      auditAction: AUDIT_ACTIONS.MODERATION_TIMEOUT_REMOVE,
      targetUsername: ziel.member.displayName,
    },
    () => gateway.members.timeout(eingabe.targetDiscordId, null, `${grund} (${eingabe.actor.username})`),
  );
}

// --- Notiz ----------------------------------------------------------------

/**
 * Eine interne Notiz in der Moderationsakte.
 *
 * Keine Massnahme - sie geht nicht an Discord und hat keine Wirkung. Sie steht
 * in der Akte, damit der naechste Moderator den Zusammenhang kennt.
 */
export async function addModerationNote(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.notesCreate)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Notizen schreiben.' });
  }
  const grund = pruefeGrund(eingabe.reason);
  const ziel = await ladeZiel(eingabe.targetDiscordId, gateway);
  const zielName = ziel.member?.displayName ?? 'Unbekannt';

  // Die Notiz gehoert in die Mitgliederakte - dort sucht man sie, und dort
  // zeigt das Profil sie an. Frueher stand sie ausschliesslich in der
  // Moderationshistorie: nicht verloren, aber am falschen Ort, und deshalb
  // fuer die Schreibenden verschwunden.
  const { schreibeNotiz } = await import('../members/notes');
  const notiz = await schreibeNotiz(
    { discordId: eingabe.actor.discordId, username: eingabe.actor.username },
    {
      targetDiscordId: eingabe.targetDiscordId,
      targetLabel: zielName,
      content: grund,
      category: 'Moderation',
    },
  );

  // Der Eintrag in der Moderationshistorie bleibt - er haelt fest, *dass*
  // notiert wurde, und verweist auf die Notiz. Der Text steht nur an einer
  // Stelle.
  return vermerke({
    type: 'NOTE',
    actor: eingabe.actor,
    target: { discordId: eingabe.targetDiscordId, username: zielName },
    reason: grund,
    status: 'COMPLETED',
    referenceId: notiz.id,
    auditAction: AUDIT_ACTIONS.MODERATION_NOTE,
  });
}
