import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type { AutomationRunStatus } from '@swisshub/database';
import type { DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { setzeFort } from './executor';
import { verwerfeJobsDesLaufs } from './scheduler';
import type { Akteur } from './store';

const logger = createLogger('automation:runs');

/**
 * Der Verlauf: was gelaufen ist, was hängt und was gescheitert ist.
 *
 * Der Verlauf ist die einzige Antwort auf die Frage «warum hat das Ding das
 * getan?». Deshalb steht in ihm jeder Schritt mit seinem Ergebnis - und
 * deshalb steht in ihm **nichts Geheimes**: Fehlermeldungen sind bereinigt,
 * ehe sie hier landen (§20).
 */

export interface VerlaufFilter {
  guildId: string;
  automationId?: string;
  status?: AutomationRunStatus[];
  seit?: Date;
  limit?: number;
  cursor?: string;
}

export interface VerlaufEintrag {
  id: string;
  automationId: string;
  automationName: string;
  status: AutomationRunStatus;
  trigger: string;
  eventType: string | null;
  dryRun: boolean;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export async function holeVerlauf(
  filter: VerlaufFilter,
): Promise<{ eintraege: VerlaufEintrag[]; naechsterCursor: string | null }> {
  const limit = Math.min(filter.limit ?? 50, 200);

  const zeilen = await prisma.automationRun.findMany({
    where: {
      guildId: filter.guildId,
      ...(filter.automationId ? { automationId: filter.automationId } : {}),
      ...(filter.status && filter.status.length > 0 ? { status: { in: filter.status } } : {}),
      ...(filter.seit ? { createdAt: { gte: filter.seit } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    include: { automation: { select: { name: true } } },
  });

  const hatMehr = zeilen.length > limit;
  const sichtbar = hatMehr ? zeilen.slice(0, limit) : zeilen;

  return {
    eintraege: sichtbar.map((zeile) => ({
      id: zeile.id,
      automationId: zeile.automationId,
      automationName: zeile.automation.name,
      status: zeile.status,
      trigger: zeile.trigger,
      eventType: zeile.eventType,
      dryRun: zeile.dryRun,
      error: zeile.error,
      durationMs: zeile.durationMs,
      createdAt: zeile.createdAt,
      finishedAt: zeile.finishedAt,
    })),
    naechsterCursor: hatMehr ? (sichtbar[sichtbar.length - 1]?.id ?? null) : null,
  };
}

/** Ein einzelner Lauf mit seinen Schritten - die Detailansicht. */
export async function holeLauf(guildId: string, runId: string) {
  return prisma.automationRun.findFirst({
    where: { id: runId, guildId },
    include: {
      automation: { select: { id: true, name: true } },
      steps: { orderBy: { index: 'asc' } },
      approvals: { orderBy: { stepIndex: 'asc' } },
    },
  });
}

/**
 * Der Fehler-Posteingang (§26).
 *
 * Läufe, die endgültig gescheitert sind. Sie stehen hier, bis jemand sie
 * ansieht - still zu verschwinden wäre die schlechteste Eigenschaft, die eine
 * Automation haben kann.
 */
export async function holeFehler(guildId: string, limit = 50) {
  return prisma.automationRun.findMany({
    where: { guildId, status: { in: ['FAILED', 'DEAD_LETTER'] } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: { automation: { select: { id: true, name: true } } },
  });
}

export interface Gesundheit {
  laufend: number;
  wartend: number;
  aufFreigabe: number;
  fehler24h: number;
  laeufe24h: number;
}

export async function laufGesundheit(guildId: string, jetzt = new Date()): Promise<Gesundheit> {
  const seit = new Date(jetzt.getTime() - 24 * 3600_000);
  const [laufend, wartend, aufFreigabe, fehler24h, laeufe24h] = await Promise.all([
    prisma.automationRun.count({ where: { guildId, status: 'RUNNING' } }),
    prisma.automationRun.count({ where: { guildId, status: 'WAITING' } }),
    prisma.automationRun.count({ where: { guildId, status: 'AWAITING_APPROVAL' } }),
    prisma.automationRun.count({
      where: { guildId, status: { in: ['FAILED', 'DEAD_LETTER'] }, createdAt: { gte: seit } },
    }),
    prisma.automationRun.count({ where: { guildId, createdAt: { gte: seit }, dryRun: false } }),
  ]);
  return { laufend, wartend, aufFreigabe, fehler24h, laeufe24h };
}

/**
 * Einen wartenden Lauf abbrechen.
 *
 * Auch offene Wecker gehen mit: sonst käme der Lauf nach Ablauf der Wartezeit
 * zurück, obwohl ihn jemand abgebrochen hat.
 */
export async function brichAb(guildId: string, runId: string, akteur: Akteur): Promise<boolean> {
  const ergebnis = await prisma.automationRun.updateMany({
    where: { id: runId, guildId, status: { in: ['PENDING', 'RUNNING', 'WAITING', 'AWAITING_APPROVAL'] } },
    data: { status: 'CANCELLED', finishedAt: new Date(), error: 'Von Hand abgebrochen.' },
  });
  if (ergebnis.count === 0) {
    return false;
  }
  await verwerfeJobsDesLaufs(runId);
  logger.info('Lauf abgebrochen', { runId, akteur: akteur.discordId });
  return true;
}

// --- Freigaben (§32) --------------------------------------------------------

export async function holeOffeneFreigaben(guildId: string, limit = 50) {
  return prisma.automationApproval.findMany({
    where: { guildId, status: 'PENDING' },
    orderBy: { requestedAt: 'asc' },
    take: Math.min(limit, 200),
    include: { run: { include: { automation: { select: { id: true, name: true } } } } },
  });
}

/**
 * Eine angehaltene Aktion freigeben oder ablehnen.
 *
 * Der Zuschlag wird über `status: 'PENDING'` in der Bedingung geholt: zwei
 * Menschen, die gleichzeitig auf «Genehmigen» drücken, führen die Aktion
 * trotzdem einmal aus. Dasselbe Verfahren wie überall sonst im Projekt.
 */
export async function entscheideFreigabe(
  guildId: string,
  approvalId: string,
  genehmigt: boolean,
  akteur: Akteur,
  optionen: { grund?: string; gateway?: DiscordGateway } = {},
): Promise<{ ok: boolean; grund?: string }> {
  const freigabe = await prisma.automationApproval.findFirst({
    where: { id: approvalId, guildId },
    include: { run: true },
  });
  if (!freigabe) {
    return { ok: false, grund: 'Diese Freigabe gibt es nicht.' };
  }

  const zugeteilt = await prisma.automationApproval.updateMany({
    where: { id: approvalId, status: 'PENDING' },
    data: {
      status: genehmigt ? 'APPROVED' : 'REJECTED',
      decidedBy: akteur.discordId,
      decidedAt: new Date(),
      reason: optionen.grund?.slice(0, 300) ?? null,
    },
  });
  if (zugeteilt.count === 0) {
    return { ok: false, grund: 'Diese Freigabe wurde bereits entschieden.' };
  }

  await recordAudit({
    action: genehmigt
      ? AUDIT_ACTIONS.AUTOMATION_APPROVAL_GRANTED
      : AUDIT_ACTIONS.AUTOMATION_APPROVAL_REJECTED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: freigabe.title,
    metadata: { runId: freigabe.runId, stepIndex: freigabe.stepIndex },
  });

  if (!genehmigt) {
    await prisma.automationRun.updateMany({
      where: { id: freigabe.runId, status: 'AWAITING_APPROVAL' },
      data: { status: 'CANCELLED', finishedAt: new Date(), error: 'Freigabe abgelehnt.' },
    });
    return { ok: true };
  }

  // Genehmigt: der Lauf macht dort weiter, wo er angehalten hat. Der
  // freigegebene Schritt wird dabei erneut betrachtet - diesmal ohne
  // Freigabesperre, weil die Freigabe nun vorliegt.
  await prisma.automationRun.updateMany({
    where: { id: freigabe.runId, status: 'AWAITING_APPROVAL' },
    data: { cursor: freigabe.stepIndex },
  });
  const ergebnis = await setzeFort(freigabe.runId, {
    ...(optionen.gateway ? { gateway: optionen.gateway } : {}),
  });
  return { ok: ergebnis.status !== 'FAILED' };
}

/**
 * Alte Läufe entfernen (§34).
 *
 * Nur abgeschlossene: was wartet oder auf eine Freigabe hofft, bleibt liegen,
 * auch wenn es alt ist. Ein Lauf, der seit acht Tagen auf einen Menschen
 * wartet, verschwände sonst genau dann, wenn dieser Mensch aus den Ferien
 * zurückkommt.
 */
export async function raeumeLaeufe(tage: number, jetzt = new Date()): Promise<number> {
  const grenze = new Date(jetzt.getTime() - tage * 24 * 3600_000);
  const ergebnis = await prisma.automationRun.deleteMany({
    where: {
      status: { in: ['SUCCESS', 'SKIPPED', 'CANCELLED'] },
      createdAt: { lt: grenze },
    },
  });
  if (ergebnis.count > 0) {
    logger.info('Alte Läufe entfernt', { anzahl: ergebnis.count, tage });
  }
  return ergebnis.count;
}
