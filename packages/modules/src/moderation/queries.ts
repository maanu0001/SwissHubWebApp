import { prisma } from '@swisshub/database';
import type {
  ModerationAction,
  ModerationActionType,
  ModerationActorType,
  ModerationSource,
} from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';

/**
 * Kennzahlen der Moderationsuebersicht.
 *
 * Alles optional: `undefined` heisst «darf diese Person nicht sehen», `null`
 * bei den Banns heisst «Discord hat nicht geantwortet». Beides ist etwas
 * anderes als eine Null.
 */
export interface ModerationOverview {
  heute?: number;
  siebenTage?: number;
  aktiveJails?: number;
  aktiveTimeouts?: number;
  banns?: number | null;
}

/**
 * Die Moderationsakte eines Mitglieds.
 *
 * Alles, was ihm widerfahren ist - Jail-Vorgaenge des Jail-Moduls
 * eingeschlossen, denn beide schreiben in dieselbe Tabelle.
 */
export async function memberHistory(targetDiscordId: string, limit = 50): Promise<ModerationAction[]> {
  return prisma.moderationAction.findMany({
    where: { targetDiscordId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}

/** Die letzten Massnahmen des Servers. */
export async function recentActions(limit = 25): Promise<ModerationAction[]> {
  return prisma.moderationAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });
}

/** Wer besonders oft auffaellt. */
export async function haeufigModeriert(
  tage = 30,
  limit = 10,
): Promise<Array<{ targetDiscordId: string; targetUsername: string; anzahl: number }>> {
  const seit = new Date(Date.now() - tage * 86_400_000);
  const zeilen = await prisma.moderationAction.groupBy({
    by: ['targetDiscordId', 'targetUsername'],
    where: { createdAt: { gte: seit }, status: 'COMPLETED', type: { not: 'NOTE' } },
    _count: { _all: true },
    orderBy: { _count: { targetDiscordId: 'desc' } },
    take: limit,
  });
  return zeilen.map((zeile) => ({
    targetDiscordId: zeile.targetDiscordId,
    targetUsername: zeile.targetUsername,
    anzahl: zeile._count._all,
  }));
}

/** Welcher Moderator wie oft gehandelt hat. */
export async function moderatorAktivitaet(
  tage = 30,
  limit = 10,
): Promise<Array<{ actorDiscordId: string; actorUsername: string; anzahl: number }>> {
  const seit = new Date(Date.now() - tage * 86_400_000);
  const zeilen = await prisma.moderationAction.groupBy({
    by: ['actorDiscordId', 'actorUsername'],
    where: { createdAt: { gte: seit }, status: 'COMPLETED' },
    _count: { _all: true },
    orderBy: { _count: { actorDiscordId: 'desc' } },
    take: limit,
  });
  return zeilen.map((zeile) => ({
    actorDiscordId: zeile.actorDiscordId,
    actorUsername: zeile.actorUsername,
    anzahl: zeile._count._all,
  }));
}

export interface ActionQuery {
  type?: ModerationActionType[];
  targetDiscordId?: string;
  actorDiscordId?: string;
  /** Woher die Massnahme kam - Dashboard, Bot, direkt aus Discord, Zeitsteuerung. */
  source?: ModerationSource[];
  /** Mensch oder Bot. */
  actorType?: ModerationActorType[];
  von?: Date;
  bis?: Date;
  /** Cursor: die Kennung des letzten Eintrags der vorherigen Seite. */
  cursor?: string;
  pageSize?: number;
}

/**
 * Der Verlauf - seitenweise ueber einen Cursor.
 *
 * Cursor statt Seitenzahl, weil die Tabelle waechst, waehrend jemand
 * blaettert: mit `skip` verschoebe sich der Ausschnitt bei jedem neuen
 * Eintrag, und Zeilen erschienen doppelt oder gar nicht.
 */
export async function listActions(
  query: ActionQuery = {},
): Promise<{ zeilen: ModerationAction[]; naechsterCursor: string | null }> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

  const zeilen = await prisma.moderationAction.findMany({
    where: {
      ...(query.type && query.type.length > 0 ? { type: { in: query.type } } : {}),
      ...(query.targetDiscordId ? { targetDiscordId: query.targetDiscordId } : {}),
      ...(query.actorDiscordId ? { actorDiscordId: query.actorDiscordId } : {}),
      ...(query.source && query.source.length > 0 ? { source: { in: query.source } } : {}),
      ...(query.actorType && query.actorType.length > 0 ? { actorType: { in: query.actorType } } : {}),
      ...(query.von || query.bis
        ? {
            createdAt: {
              ...(query.von ? { gte: query.von } : {}),
              ...(query.bis ? { lte: query.bis } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: pageSize + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  // Eine Zeile mehr geholt, als angezeigt wird: sie beantwortet, ob es
  // weitergeht, ohne eine zweite Zaehlabfrage.
  const hatMehr = zeilen.length > pageSize;
  const sichtbar = hatMehr ? zeilen.slice(0, pageSize) : zeilen;

  return {
    zeilen: sichtbar,
    naechsterCursor: hatMehr ? (sichtbar.at(-1)?.id ?? null) : null,
  };
}

/**
 * Die Timeouts, die gerade laufen.
 *
 * Seit direkt in Discord gesetzte Massnahmen erkannt werden, stehen hier
 * beide: die ueber dieses System gesetzten und die, die jemand in der
 * Discord-App verhaengt hat. Die Spalte `source` sagt an jeder Zeile, welche
 * von beiden es ist.
 *
 * Eine Einschraenkung bleibt und laesst sich nicht wegprogrammieren: erkannt
 * wird nur, was geschah, waehrend der Bot lief. Ein Timeout aus einer Zeit
 * ohne Bot fehlt hier - dagegen hilft kein Abgleich, weil Discord den
 * Vorgang selbst nicht mehr hergibt.
 *
 * `TIMEOUT_UPDATE` zaehlt mit: eine verlaengerte Frist ist eine laufende.
 *
 * Pro Mitglied zaehlt der juengste Timeout, und er zaehlt nur, wenn danach
 * keine Aufhebung kam.
 */
export async function aktiveTimeouts(limit = 50): Promise<ModerationAction[]> {
  const jetzt = new Date();
  const kandidaten = await prisma.moderationAction.findMany({
    where: {
      type: { in: ['TIMEOUT', 'TIMEOUT_UPDATE'] },
      status: 'COMPLETED',
      expiresAt: { gt: jetzt },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200) * 3,
  });
  if (kandidaten.length === 0) {
    return [];
  }

  const juengste = new Map<string, ModerationAction>();
  for (const eintrag of kandidaten) {
    if (!juengste.has(eintrag.targetDiscordId)) {
      juengste.set(eintrag.targetDiscordId, eintrag);
    }
  }

  const aufhebungen = await prisma.moderationAction.findMany({
    where: {
      type: 'TIMEOUT_REMOVE',
      status: 'COMPLETED',
      targetDiscordId: { in: [...juengste.keys()] },
    },
    select: { targetDiscordId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const letzteAufhebung = new Map<string, Date>();
  for (const eintrag of aufhebungen) {
    if (!letzteAufhebung.has(eintrag.targetDiscordId)) {
      letzteAufhebung.set(eintrag.targetDiscordId, eintrag.createdAt);
    }
  }

  return [...juengste.values()]
    .filter((eintrag) => {
      const aufhebung = letzteAufhebung.get(eintrag.targetDiscordId);
      return !aufhebung || aufhebung < eintrag.createdAt;
    })
    .slice(0, limit);
}

/** Was in die Uebersicht darf - jede Zahl haengt an ihrer Berechtigung. */
export interface OverviewScope {
  /** Darf die Moderationszahlen des Servers sehen. */
  moderation: boolean;
  /** Darf die Jail-Zahlen sehen. */
  jail: boolean;
  /** Darf die Bannliste sehen. */
  banns: boolean;
}

/**
 * Kennzahlen der Moderationsuebersicht.
 *
 * Was jemand nicht sehen darf, bleibt `undefined` - nicht `0`. Eine Null
 * waere eine Auskunft: «es gibt keine aktiven Jails» ist etwas anderes als
 * «das darfst du nicht wissen».
 */
export async function moderationOverview(
  scope: OverviewScope,
  options: { gateway?: DiscordGateway } = {},
): Promise<ModerationOverview> {
  const gateway = options.gateway ?? defaultDiscord;
  const tagesbeginn = new Date();
  tagesbeginn.setHours(0, 0, 0, 0);
  const siebenTageZurueck = new Date(Date.now() - 7 * 86_400_000);

  const [heute, siebenTage, aktiveJails, timeouts, banns] = await Promise.all([
    scope.moderation
      ? prisma.moderationAction.count({ where: { createdAt: { gte: tagesbeginn } } })
      : Promise.resolve(undefined),
    scope.moderation
      ? prisma.moderationAction.count({ where: { createdAt: { gte: siebenTageZurueck } } })
      : Promise.resolve(undefined),
    scope.jail
      ? prisma.jailEntry.count({
          where: { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] } },
        })
      : Promise.resolve(undefined),
    scope.moderation ? aktiveTimeouts(200).then((zeilen) => zeilen.length) : Promise.resolve(undefined),
    // Die Bannliste kommt von Discord - sie ist dort die Wahrheit, nicht bei
    // uns. Faellt Discord aus, steht hier `null` statt einer erfundenen Zahl.
    scope.banns
      ? gateway.bans
          .list({ limit: 1000 })
          .then((zeilen) => zeilen.length)
          .catch(() => null)
      : Promise.resolve(undefined),
  ]);

  return { heute, siebenTage, aktiveJails, aktiveTimeouts: timeouts, banns };
}
