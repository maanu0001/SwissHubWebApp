import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { VerificationRequest, VerificationStatus } from '@swisshub/database';
import { discord as defaultDiscord, resolveGuildId, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound } from '@swisshub/shared';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { VERIFICATION_MODULE_ID, type VerificationSettings } from './config';

const logger = createLogger('verification:service');

/**
 * Der Lebenslauf eines Verifikationsvorgangs.
 *
 * Dies ist die einzige Stelle, an der ein Vorgang entsteht oder endet.
 *
 * Der Kern ist `entscheide`: jede endgueltige Entscheidung geht durch diese
 * eine Funktion, und sie schreibt unter einer Bedingung, die nur einmal
 * zutrifft. Wer den Zuschlag nicht bekommt, hat nicht entschieden - egal ob
 * das ein Doppelklick war, ein zweiter Moderator oder ein spaet
 * eintreffendes AI-Ergebnis.
 *
 * Was die AI darf, ist nicht eine Frage der Konfiguration, sondern des
 * Bauplans: es gibt in dieser Datei keinen Pfad von einem AI-Ergebnis zu
 * einer Sanktion. `reject` verlangt einen menschlichen Handelnden und ist von
 * `verify` getrennt.
 */

/** Zustaende, in denen noch nichts entschieden ist. */
export const OFFENE_STATUS: readonly VerificationStatus[] = [
  'WAITING_FOR_MESSAGE',
  'AI_ANALYZING',
  'WAITING_FOR_REVIEW',
];

/** Zustaende, in denen ein Mensch gefragt ist. */
export const WARTET_AUF_MENSCH: readonly VerificationStatus[] = ['WAITING_FOR_REVIEW', 'AI_ANALYZING'];

const STATUS_LABEL: Record<VerificationStatus, string> = {
  WAITING_FOR_MESSAGE: 'Wartet auf Nachricht',
  AI_ANALYZING: 'AI prüft',
  WAITING_FOR_REVIEW: 'Wartet auf Prüfung',
  VERIFIED: 'Verifiziert',
  REJECTED: 'Abgelehnt',
  LEFT_SERVER: 'Server verlassen',
  EXPIRED: 'Abgelaufen',
  ERROR: 'Fehler',
};

export const statusLabel = (status: VerificationStatus): string => STATUS_LABEL[status];

export async function verificationSettings(): Promise<VerificationSettings> {
  return getModuleSettings<VerificationSettings>(VERIFICATION_MODULE_ID);
}

export async function moduleReady(): Promise<boolean> {
  return isModuleEnabled(VERIFICATION_MODULE_ID);
}

export async function getRequest(id: string): Promise<VerificationRequest | null> {
  return prisma.verificationRequest.findUnique({ where: { id } });
}

export async function requireRequest(id: string): Promise<VerificationRequest> {
  const eintrag = await getRequest(id);
  if (!eintrag) {
    throw notFound('Vorgang nicht gefunden', 'Diesen Verifikationsvorgang gibt es nicht.');
  }
  return eintrag;
}

/** Der offene Vorgang einer Person, falls es einen gibt. */
export async function offenerVorgang(
  guildId: string,
  discordId: string,
): Promise<VerificationRequest | null> {
  return prisma.verificationRequest.findFirst({
    where: { guildId, discordId, status: { in: [...OFFENE_STATUS] } },
    orderBy: { createdAt: 'desc' },
  });
}

/** War diese Person schon einmal erfolgreich verifiziert? */
export async function frueherVerifiziert(guildId: string, discordId: string): Promise<boolean> {
  const treffer = await prisma.verificationRequest.findFirst({
    where: { guildId, discordId, status: 'VERIFIED' },
    select: { id: true },
  });
  return treffer !== null;
}

export interface JoinEingabe {
  discordId: string;
  username?: string | null;
  displayName?: string | null;
  avatarHash?: string | null;
  /** Erstellungszeitpunkt des Discord-Kontos. */
  accountCreatedAt?: Date | null;
  joinedAt?: Date;
}

/**
 * Einen Vorgang eroeffnen.
 *
 * Idempotent: gibt es bereits einen offenen Vorgang, wird dieser
 * zurueckgegeben. Discord liefert `guildMemberAdd` bei Netzproblemen
 * durchaus zweimal, und zwei Vorgaenge fuer dieselbe Person waeren zwei
 * Meldungen an die Moderation.
 */
export async function startVerification(eingabe: JoinEingabe): Promise<VerificationRequest> {
  const guildId = await resolveGuildId();
  const vorhanden = await offenerVorgang(guildId, eingabe.discordId);
  if (vorhanden) {
    return vorhanden;
  }

  const eintrag = await prisma.verificationRequest.create({
    data: {
      guildId,
      discordId: eingabe.discordId,
      username: eingabe.username ?? null,
      displayName: eingabe.displayName ?? null,
      avatarHash: eingabe.avatarHash ?? null,
      joinedAt: eingabe.joinedAt ?? new Date(),
      accountCreatedAt: eingabe.accountCreatedAt ?? null,
      status: 'WAITING_FOR_MESSAGE',
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VERIFICATION_STARTED,
    module: VERIFICATION_MODULE_ID,
    actorDiscordId: 'system',
    actorUsername: 'Verifikation',
    targetDiscordId: eingabe.discordId,
    targetLabel: eingabe.displayName ?? eingabe.username ?? eingabe.discordId,
    success: true,
    metadata: { requestId: eintrag.id },
  });

  logger.info('Verifikation eröffnet', { requestId: eintrag.id, discordId: eingabe.discordId });
  return eintrag;
}

export interface NachrichtEingabe {
  discordId: string;
  messageId: string;
  content: string;
  /** Wann die Nachricht geschrieben wurde. */
  createdAt?: Date;
}

export interface NachrichtErgebnis {
  request: VerificationRequest;
  /** Erste Nachricht dieses Vorgangs - nur dann wird die Moderation geweckt. */
  erste: boolean;
  /** Bereits erfasst (Discord hat dasselbe Ereignis zweimal geliefert). */
  doppelt: boolean;
}

/**
 * Eine Nachricht im Verifikationskanal erfassen.
 *
 * Sie aktualisiert ausschliesslich den Vorgang der schreibenden Person. Wen
 * die Nachricht erwaehnt, worauf sie antwortet und welche Kennung darin
 * steht, spielt keine Rolle - der Absender ist die einzige Quelle. Damit
 * laesst sich ueber diesen Weg kein fremder Vorgang bewegen.
 *
 * Schreibt jemand mehrfach, bleibt es derselbe Vorgang: die neueste Nachricht
 * wird angezeigt, der Verlauf bleibt erhalten, und die Moderation wird nicht
 * bei jeder Zeile erneut geweckt.
 */
export async function recordMessage(eingabe: NachrichtEingabe): Promise<NachrichtErgebnis | null> {
  const guildId = await resolveGuildId();
  const vorhanden = await offenerVorgang(guildId, eingabe.discordId);
  if (!vorhanden) {
    return null;
  }
  // Ein bereits entschiedener Vorgang nimmt nichts mehr entgegen.
  if (vorhanden.decidedAt) {
    return null;
  }

  const jetzt = eingabe.createdAt ?? new Date();
  const text = eingabe.content.slice(0, 2000);

  // Dieselbe Discord-Nachricht nicht zweimal erfassen.
  const schonDa = await prisma.verificationMessage.findUnique({
    where: {
      requestId_discordMessageId: {
        requestId: vorhanden.id,
        discordMessageId: eingabe.messageId,
      },
    },
    select: { id: true },
  });
  if (schonDa) {
    return { request: vorhanden, erste: false, doppelt: true };
  }

  const erste = vorhanden.messageCount === 0;

  const [, aktualisiert] = await prisma.$transaction([
    prisma.verificationMessage.create({
      data: {
        requestId: vorhanden.id,
        discordMessageId: eingabe.messageId,
        content: text,
        createdAt: jetzt,
      },
    }),
    prisma.verificationRequest.update({
      where: { id: vorhanden.id },
      data: {
        latestMessage: text,
        latestMessageId: eingabe.messageId,
        latestMessageAt: jetzt,
        messageCount: { increment: 1 },
        // Der Zustand wandert nur beim ersten Mal weiter. Wer nachschiebt,
        // aendert nichts am Wartestand.
        ...(erste ? { status: 'WAITING_FOR_REVIEW' as const } : {}),
      },
    }),
  ]);

  if (erste) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_MESSAGE_RECEIVED,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: eingabe.discordId,
      actorUsername: vorhanden.username ?? eingabe.discordId,
      targetDiscordId: eingabe.discordId,
      targetLabel: vorhanden.displayName ?? eingabe.discordId,
      success: true,
      metadata: { requestId: vorhanden.id, messageId: eingabe.messageId },
    });
  }

  return { request: aktualisiert, erste, doppelt: false };
}

/** Wo eine Entscheidung gefallen ist. */
export type Entscheidungsquelle = 'DISCORD' | 'WEBAPP';

export interface Entscheidung {
  status: Extract<VerificationStatus, 'VERIFIED' | 'REJECTED' | 'LEFT_SERVER' | 'EXPIRED' | 'ERROR'>;
  by: 'HUMAN' | 'AI' | 'SYSTEM';
  actorDiscordId?: string | null;
  actorUsername?: string | null;
  reason?: string | null;
  /** Nur bei einem Menschen gesetzt - AI und System haben keinen Ort. */
  source?: Entscheidungsquelle | null;
}

/**
 * Die eine Stelle, an der ein Vorgang endet.
 *
 * `decidedAt: null` in der Bedingung ist der ganze Trick: die Datenbank
 * entscheidet, wer zuerst da war. Wer null Zeilen aendert, hat verloren und
 * darf nichts weiter tun - der Aufrufer erkennt das am `false` und laesst die
 * Finger von Rollen, Baennen und Meldungen.
 *
 * Damit ist der Wettlauf zwischen Moderator und AI entschieden, ohne dass es
 * eine Sperre, eine Warteschlange oder einen zweiten Dienst braucht.
 */
export async function entscheide(
  requestId: string,
  entscheidung: Entscheidung,
  now = new Date(),
): Promise<VerificationRequest | null> {
  const ergebnis = await prisma.verificationRequest.updateMany({
    where: { id: requestId, decidedAt: null, status: { in: [...OFFENE_STATUS] } },
    data: {
      status: entscheidung.status,
      decidedAt: now,
      decidedBy: entscheidung.by,
      decidedByDiscordId: entscheidung.actorDiscordId ?? null,
      decidedByUsername: entscheidung.actorUsername ?? null,
      decisionReason: entscheidung.reason ?? null,
      decidedSource: entscheidung.source ?? null,
    },
  });
  if (ergebnis.count === 0) {
    return null;
  }
  return prisma.verificationRequest.findUnique({ where: { id: requestId } });
}

export interface RollenErgebnis {
  ok: boolean;
  grund?: string;
}

/**
 * Rollen tauschen: unverifiziert raus, Mitglied rein.
 *
 * In einem Zug ueber `setRoles` statt in zwei Schritten. Discord bekommt
 * dadurch genau eine Anfrage, und es gibt keinen Zwischenstand, in dem jemand
 * beide Rollen oder gar keine traegt - was hiesse, dass er weder den Server
 * noch den Verifikationskanal sieht.
 *
 * Die uebrigen Rollen bleiben unangetastet: wer waehrend der Verifikation
 * schon eine Sonderrolle bekommen hat, soll sie behalten.
 */
export async function tauscheRollen(
  discordId: string,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<RollenErgebnis> {
  if (!settings.memberRoleId) {
    return { ok: false, grund: 'Es ist keine Mitgliederrolle eingestellt.' };
  }

  let mitglied;
  try {
    mitglied = await gateway.members.get(discordId);
  } catch (error) {
    logger.error('Mitglied konnte nicht geladen werden', { discordId, error });
    return { ok: false, grund: 'Das Mitglied konnte auf Discord nicht geladen werden.' };
  }
  if (!mitglied) {
    return { ok: false, grund: 'Das Mitglied ist nicht mehr auf dem Server.' };
  }

  const rollen = new Set(mitglied.roleIds);
  rollen.add(settings.memberRoleId);
  // Die zweite Rolle, wenn eine eingestellt ist. Beide in derselben Menge -
  // dadurch gibt es hier keinen Teilerfolg: entweder Discord nimmt den einen
  // Aufruf an und beide Rollen sitzen, oder es nimmt ihn nicht an und keine
  // sitzt. Ein Zwischenstand «verifiziert, aber kein Mitglied» kann gar nicht
  // entstehen.
  //
  // Ist eine Rolle bereits vorhanden, aendert `add` nichts - der Vorgang ist
  // damit ohne Zusatzaufwand wiederholbar.
  if (settings.verifiedRoleId) {
    rollen.add(settings.verifiedRoleId);
  }
  if (settings.unverifiedRoleId) {
    rollen.delete(settings.unverifiedRoleId);
  }

  try {
    await gateway.members.setRoles(discordId, [...rollen], 'Verifikation abgeschlossen');
  } catch (error) {
    // Haeufigste Ursache: die Zielrolle steht ueber der Bot-Rolle. Der
    // Einrichtungstest prueft genau das im Voraus - hier bleibt nur, es
    // sauber zu melden statt es zu verschlucken.
    logger.error('Rollen konnten nicht gesetzt werden', { discordId, error });
    return {
      ok: false,
      grund:
        'Die Rollen konnten nicht gesetzt werden. Häufigste Ursache: die Bot-Rolle steht nicht über den betroffenen Rollen.',
    };
  }
  return { ok: true };
}

export interface VerifyErgebnis {
  request: VerificationRequest;
  rollen: RollenErgebnis;
}

/**
 * Einen Vorgang freischalten.
 *
 * Der einzige Weg zu VERIFIED - fuer Menschen wie fuer die AI. Die Rollen
 * werden erst nach dem Zuschlag getauscht: waere es umgekehrt, koennte ein
 * verlorener Wettlauf trotzdem Rollen vergeben haben.
 */
export async function verify(
  requestId: string,
  von: {
    by: 'HUMAN' | 'AI';
    discordId?: string | null;
    username?: string | null;
    source?: Entscheidungsquelle | null;
  },
  options: { gateway?: DiscordGateway; settings?: VerificationSettings } = {},
): Promise<VerifyErgebnis> {
  const settings = options.settings ?? (await verificationSettings());
  const vorher = await requireRequest(requestId);

  const entschieden = await entscheide(requestId, {
    status: 'VERIFIED',
    by: von.by,
    actorDiscordId: von.discordId ?? null,
    actorUsername: von.username ?? (von.by === 'AI' ? 'AI-Prüfung' : null),
    source: von.source ?? null,
  });
  if (!entschieden) {
    throw conflict('Dieser Vorgang wurde bereits entschieden.');
  }

  const rollen = await tauscheRollen(vorher.discordId, settings, options.gateway);
  if (!rollen.ok) {
    // Der Zustand bleibt VERIFIED - entschieden ist entschieden -, aber der
    // Fehler wird festgehalten, damit die Moderation es von Hand nachziehen
    // kann. Ihn zu verschweigen hiesse, jemanden fuer freigeschaltet zu
    // halten, der es nicht ist.
    await prisma.verificationRequest.update({
      where: { id: requestId },
      data: { decisionReason: rollen.grund ?? 'Rollen konnten nicht vergeben werden.' },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_ERROR,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: von.discordId ?? 'system',
      actorUsername: von.username ?? 'Verifikation',
      targetDiscordId: vorher.discordId,
      targetLabel: vorher.displayName ?? vorher.discordId,
      success: false,
      metadata: { requestId, grund: rollen.grund },
    });
  }

  await safeRecordAudit({
    action:
      von.by === 'AI' ? AUDIT_ACTIONS.VERIFICATION_AI_VERIFIED : AUDIT_ACTIONS.VERIFICATION_HUMAN_VERIFIED,
    module: VERIFICATION_MODULE_ID,
    actorDiscordId: von.discordId ?? 'system',
    actorUsername: von.username ?? (von.by === 'AI' ? 'AI-Prüfung' : 'Unbekannt'),
    targetDiscordId: vorher.discordId,
    targetLabel: vorher.displayName ?? vorher.username ?? vorher.discordId,
    success: rollen.ok,
    metadata: {
      requestId,
      by: von.by,
      quelle: von.source ?? null,
      ...(von.by === 'AI' ? { confidence: vorher.aiConfidence, reasonCode: vorher.aiReasonCode } : {}),
    },
  });

  // Die Meldung an die Automation Engine steht nach der Pruefspur und wirft
  // nie: eine Freischaltung soll nicht daran scheitern, dass eine Automation
  // nicht erreichbar ist.
  const { meldeEreignis } = await import('../automation/emit');
  await meldeEreignis(
    'verification.completed',
    {
      requestId,
      discordId: vorher.discordId,
      displayName: vorher.displayName ?? vorher.username ?? vorher.discordId,
      entschiedenVon: von.by,
      rollenGesetzt: rollen.ok,
    },
    {
      guildId: vorher.guildId,
      actorId: von.discordId ?? null,
      subjectId: vorher.discordId,
      entityId: requestId,
    },
  );

  logger.info('Verifikation freigeschaltet', { requestId, by: von.by, rollen: rollen.ok });
  return { request: entschieden, rollen };
}

/**
 * Einen Vorgang als «Server verlassen» schliessen.
 *
 * Kein Urteil und keine Sanktion - nur die Feststellung, dass es nichts mehr
 * zu pruefen gibt.
 */
export async function markLeft(guildId: string, discordId: string): Promise<VerificationRequest | null> {
  const offen = await offenerVorgang(guildId, discordId);
  if (!offen) {
    return null;
  }
  const entschieden = await entscheide(offen.id, { status: 'LEFT_SERVER', by: 'SYSTEM' });
  if (entschieden) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_LEFT_SERVER,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: 'system',
      actorUsername: 'Verifikation',
      targetDiscordId: discordId,
      targetLabel: offen.displayName ?? discordId,
      success: true,
      metadata: { requestId: offen.id },
    });
  }
  return entschieden;
}

export { defaultDiscord };
