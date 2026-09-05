import { prisma } from '@swisshub/database';
import type { VerificationRequest, VerificationStatus } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { OFFENE_STATUS, WARTET_AUF_MENSCH } from './service';

/**
 * Abfragen fuer Uebersicht, Warteschlange und Verlauf.
 *
 * Alle Daten strikt nach Guild getrennt: die Kennung kommt aus der
 * Serverkonfiguration, nicht aus der Anfrage.
 */

export interface WarteZeile {
  id: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  status: VerificationStatus;
  joinedAt: Date;
  accountCreatedAt: Date | null;
  latestMessage: string | null;
  latestMessageId: string | null;
  latestMessageAt: Date | null;
  messageCount: number;
  aiVerdict: VerificationRequest['aiVerdict'];
  aiConfidence: number | null;
  aiReasonCode: string | null;
  aiError: string | null;
  /** Wartezeit in Sekunden, ab Beitritt. */
  wartetSeit: number;
  /** Konto juenger als einen Tag - ein Hinweis, kein Urteil. */
  jungesKonto: boolean;
  /** Kein Avatar gesetzt - ein Hinweis, kein Urteil. */
  ohneAvatar: boolean;
}

const AUSWAHL = {
  id: true,
  discordId: true,
  username: true,
  displayName: true,
  avatarHash: true,
  status: true,
  joinedAt: true,
  accountCreatedAt: true,
  latestMessage: true,
  latestMessageId: true,
  latestMessageAt: true,
  messageCount: true,
  aiVerdict: true,
  aiConfidence: true,
  aiReasonCode: true,
  aiError: true,
} as const;

function zuZeile(eintrag: Pick<VerificationRequest, keyof typeof AUSWAHL>, jetzt: Date): WarteZeile {
  return {
    ...eintrag,
    wartetSeit: Math.max(0, Math.floor((jetzt.getTime() - eintrag.joinedAt.getTime()) / 1000)),
    jungesKonto:
      eintrag.accountCreatedAt !== null &&
      eintrag.joinedAt.getTime() - eintrag.accountCreatedAt.getTime() < 24 * 3600_000,
    ohneAvatar: eintrag.avatarHash === null,
  };
}

/** Offene Vorgaenge, aelteste zuerst - wer am laengsten wartet, steht oben. */
export async function listQueue(limit = 100, jetzt = new Date()): Promise<WarteZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  const zeilen = await prisma.verificationRequest.findMany({
    where: { guildId, status: { in: [...OFFENE_STATUS] } },
    select: AUSWAHL,
    orderBy: { joinedAt: 'asc' },
    take: limit,
  });
  return zeilen.map((zeile) => zuZeile(zeile, jetzt));
}

/**
 * Wie viele Vorgaenge auf eine menschliche Entscheidung warten.
 *
 * Bewusst nur eine Zahl: das Dashboard braucht keine Zeilen, und eine
 * Zaehlung kostet keine Auswahl von Personendaten.
 */
export async function offeneAnzahl(): Promise<number> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return 0;
  }
  return prisma.verificationRequest.count({
    where: { guildId, status: { in: [...WARTET_AUF_MENSCH] } },
  });
}

export interface VerlaufZeile extends WarteZeile {
  decidedAt: Date | null;
  decidedBy: VerificationRequest['decidedBy'];
  decidedByUsername: string | null;
  decisionReason: string | null;
  /** Wie lange es vom Beitritt bis zur Entscheidung dauerte, in Sekunden. */
  dauer: number | null;
}

export type VerlaufFilter = 'ALL' | 'HUMAN_VERIFIED' | 'AI_VERIFIED' | 'REJECTED' | 'LEFT_SERVER' | 'EXPIRED';

export async function listHistory(
  filter: VerlaufFilter = 'ALL',
  options: { search?: string; limit?: number } = {},
): Promise<VerlaufZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }

  const nachFilter =
    filter === 'HUMAN_VERIFIED'
      ? { status: 'VERIFIED' as const, decidedBy: 'HUMAN' as const }
      : filter === 'AI_VERIFIED'
        ? { status: 'VERIFIED' as const, decidedBy: 'AI' as const }
        : filter === 'ALL'
          ? { status: { notIn: [...OFFENE_STATUS] } }
          : { status: filter as VerificationStatus };

  const suche = options.search?.trim();
  const zeilen = await prisma.verificationRequest.findMany({
    where: {
      guildId,
      ...nachFilter,
      ...(suche
        ? {
            OR: [
              { username: { contains: suche, mode: 'insensitive' as const } },
              { displayName: { contains: suche, mode: 'insensitive' as const } },
              { discordId: { contains: suche } },
            ],
          }
        : {}),
    },
    select: {
      ...AUSWAHL,
      decidedAt: true,
      decidedBy: true,
      decidedByUsername: true,
      decisionReason: true,
    },
    orderBy: { decidedAt: 'desc' },
    take: options.limit ?? 100,
  });

  const jetzt = new Date();
  return zeilen.map((zeile) => ({
    ...zuZeile(zeile, jetzt),
    decidedAt: zeile.decidedAt,
    decidedBy: zeile.decidedBy,
    decidedByUsername: zeile.decidedByUsername,
    decisionReason: zeile.decisionReason,
    dauer: zeile.decidedAt
      ? Math.max(0, Math.floor((zeile.decidedAt.getTime() - zeile.joinedAt.getTime()) / 1000))
      : null,
  }));
}

export interface Kennzahlen {
  wartetAufNachricht: number;
  wartetAufModeration: number;
  heuteVerifiziert: number;
  heuteAbgelehnt: number;
  heuteAiVerifiziert: number;
  /** Mittlere Wartezeit der heute entschiedenen Faelle, in Sekunden. */
  schnittWartezeit: number | null;
  medianWartezeit: number | null;
  /** Wie viele der heute entschiedenen Faelle. Grundlage der beiden Werte. */
  schnittBasis: number;
  aiAnfragenHeute: number;
  aiFehlerHeute: number;
  /** Anteil der AI-Freischaltungen an allen Freischaltungen, 7 Tage. */
  aiQuote7Tage: number | null;
  ablehnQuote7Tage: number | null;
  ohneNachricht7Tage: number;
}

function median(werte: number[]): number | null {
  if (werte.length === 0) {
    return null;
  }
  const sortiert = [...werte].sort((a, b) => a - b);
  const mitte = Math.floor(sortiert.length / 2);
  return sortiert.length % 2 === 0
    ? Math.round((sortiert[mitte - 1]! + sortiert[mitte]!) / 2)
    : sortiert[mitte]!;
}

/**
 * Kennzahlen der Uebersicht.
 *
 * Ausschliesslich, was sich aus vorhandenen Daten rechnen laesst. Die
 * Wartezeit nennt ihre Grundgesamtheit, und wo nichts entschieden wurde,
 * steht `null` statt einer Null - eine erfundene Null waere eine Aussage.
 */
export async function kennzahlen(jetzt = new Date()): Promise<Kennzahlen> {
  const guildId = await resolveGuildId().catch(() => null);
  const leer: Kennzahlen = {
    wartetAufNachricht: 0,
    wartetAufModeration: 0,
    heuteVerifiziert: 0,
    heuteAbgelehnt: 0,
    heuteAiVerifiziert: 0,
    schnittWartezeit: null,
    medianWartezeit: null,
    schnittBasis: 0,
    aiAnfragenHeute: 0,
    aiFehlerHeute: 0,
    aiQuote7Tage: null,
    ablehnQuote7Tage: null,
    ohneNachricht7Tage: 0,
  };
  if (!guildId) {
    return leer;
  }

  const tagesBeginn = new Date(jetzt);
  tagesBeginn.setHours(0, 0, 0, 0);
  const vorSieben = new Date(jetzt.getTime() - 7 * 24 * 3600_000);

  const [
    wartetAufNachricht,
    wartetAufModeration,
    heuteVerifiziert,
    heuteAbgelehnt,
    heuteAiVerifiziert,
    aiFehlerHeute,
  ] = await Promise.all([
    prisma.verificationRequest.count({ where: { guildId, status: 'WAITING_FOR_MESSAGE' } }),
    prisma.verificationRequest.count({
      where: { guildId, status: { in: ['WAITING_FOR_REVIEW', 'AI_ANALYZING'] } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'VERIFIED', decidedAt: { gte: tagesBeginn } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'REJECTED', decidedAt: { gte: tagesBeginn } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'VERIFIED', decidedBy: 'AI', decidedAt: { gte: tagesBeginn } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, aiVerdict: 'FAILED', aiCheckedAt: { gte: tagesBeginn } },
    }),
  ]);

  const aiAnfragen = await prisma.verificationRequest.aggregate({
    where: { guildId, aiCheckedAt: { gte: tagesBeginn } },
    _sum: { aiAttempts: true },
  });

  // Wartezeiten aus den heute entschiedenen Faellen.
  const entschieden = await prisma.verificationRequest.findMany({
    where: { guildId, decidedAt: { gte: tagesBeginn }, status: { in: ['VERIFIED', 'REJECTED'] } },
    select: { joinedAt: true, decidedAt: true },
    take: 1000,
  });
  const dauern = entschieden
    .filter((eintrag): eintrag is { joinedAt: Date; decidedAt: Date } => eintrag.decidedAt !== null)
    .map((eintrag) =>
      Math.max(0, Math.floor((eintrag.decidedAt.getTime() - eintrag.joinedAt.getTime()) / 1000)),
    );

  const [verifiziert7, aiVerifiziert7, abgelehnt7, ohneNachricht7] = await Promise.all([
    prisma.verificationRequest.count({
      where: { guildId, status: 'VERIFIED', decidedAt: { gte: vorSieben } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'VERIFIED', decidedBy: 'AI', decidedAt: { gte: vorSieben } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'REJECTED', decidedAt: { gte: vorSieben } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'EXPIRED', decidedAt: { gte: vorSieben } },
    }),
  ]);
  const entschieden7 = verifiziert7 + abgelehnt7;

  return {
    wartetAufNachricht,
    wartetAufModeration,
    heuteVerifiziert,
    heuteAbgelehnt,
    heuteAiVerifiziert,
    schnittWartezeit:
      dauern.length > 0 ? Math.round(dauern.reduce((summe, wert) => summe + wert, 0) / dauern.length) : null,
    medianWartezeit: median(dauern),
    schnittBasis: dauern.length,
    aiAnfragenHeute: aiAnfragen._sum.aiAttempts ?? 0,
    aiFehlerHeute,
    aiQuote7Tage: verifiziert7 > 0 ? Math.round((aiVerifiziert7 / verifiziert7) * 100) : null,
    ablehnQuote7Tage: entschieden7 > 0 ? Math.round((abgelehnt7 / entschieden7) * 100) : null,
    ohneNachricht7Tage: ohneNachricht7,
  };
}

/** Der letzte abgeschlossene Vorgang einer Person - fuer das Member Center. */
export async function verificationFuerMitglied(discordId: string): Promise<{
  status: VerificationStatus;
  decidedAt: Date | null;
  decidedBy: VerificationRequest['decidedBy'];
  decidedByUsername: string | null;
} | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.verificationRequest.findFirst({
    where: { guildId, discordId, decidedAt: { not: null } },
    select: { status: true, decidedAt: true, decidedBy: true, decidedByUsername: true },
    orderBy: { decidedAt: 'desc' },
  });
}
