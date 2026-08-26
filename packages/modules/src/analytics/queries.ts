import { prisma } from '@swisshub/database';
import type { DiscordEvent, DiscordEventCategory, DiscordEventSeverity, Prisma } from '@swisshub/database';

/**
 * Lesezugriffe auf das Ereignisprotokoll.
 *
 * Zwei Dinge sind hier absichtlich so und nicht anders:
 *
 * **Cursor statt Seitenzahlen.** Das Protokoll waechst waehrend des Lesens -
 * mit `skip` verschoebe sich der Ausschnitt bei jedem neuen Ereignis, und
 * Zeilen erschienen doppelt oder gar nicht. Bei einem Verlauf, aus dem jemand
 * Schluesse zieht, ist das kein Schoenheitsfehler.
 *
 * **Inhalte nur auf Verlangen.** `contentBefore`/`contentAfter` werden nur
 * mitgeladen, wenn der Aufrufer die Berechtigung dafuer bezeugt. Sie hier
 * wegzulassen ist mehr als Kosmetik: was nicht geladen wird, kann auch nicht
 * versehentlich in einer Antwort landen.
 */

export interface TimelineQuery {
  guildId: string;
  category?: DiscordEventCategory[];
  type?: string[];
  severity?: DiscordEventSeverity[];
  /** Wer gehandelt hat. */
  actorDiscordId?: string;
  /** Wen es betraf. */
  subjectDiscordId?: string;
  channelId?: string;
  von?: Date;
  bis?: Date;
  /**
   * Volltextsuche ueber Namen und Kanal.
   *
   * Nachrichteninhalte werden nur durchsucht, wenn `mitInhalten` gesetzt ist -
   * sonst liesse sich ueber Treffer/kein-Treffer erschliessen, was in einer
   * Nachricht stand, die der Suchende gar nicht lesen darf.
   */
  suche?: string;
  /** Darf der Aufrufer Nachrichteninhalte sehen? */
  mitInhalten?: boolean;
  cursor?: string;
  pageSize?: number;
}

/** Ereignis ohne die Textfelder - fuer alle, die sie nicht sehen duerfen. */
export type EventOhneInhalt = Omit<DiscordEvent, 'contentBefore' | 'contentAfter'>;

export interface TimelinePage {
  zeilen: Array<DiscordEvent | EventOhneInhalt>;
  naechsterCursor: string | null;
}

function baueWhere(query: TimelineQuery): Prisma.DiscordEventWhereInput {
  const suche = query.suche?.trim();

  return {
    guildId: query.guildId,
    ...(query.category?.length ? { category: { in: query.category } } : {}),
    ...(query.type?.length ? { type: { in: query.type } } : {}),
    ...(query.severity?.length ? { severity: { in: query.severity } } : {}),
    ...(query.actorDiscordId ? { actorDiscordId: query.actorDiscordId } : {}),
    ...(query.subjectDiscordId ? { subjectDiscordId: query.subjectDiscordId } : {}),
    ...(query.channelId ? { channelId: query.channelId } : {}),
    ...(query.von || query.bis
      ? {
          occurredAt: {
            ...(query.von ? { gte: query.von } : {}),
            ...(query.bis ? { lte: query.bis } : {}),
          },
        }
      : {}),
    ...(suche
      ? {
          OR: [
            { actorUsername: { contains: suche, mode: 'insensitive' } },
            { subjectUsername: { contains: suche, mode: 'insensitive' } },
            { channelName: { contains: suche, mode: 'insensitive' } },
            { actorDiscordId: suche },
            { subjectDiscordId: suche },
            { messageId: suche },
            // Der Inhalt wird nur durchsucht, wenn er auch gezeigt werden
            // darf - sonst waere die Trefferanzahl selbst eine Auskunft.
            ...(query.mitInhalten
              ? [
                  { contentBefore: { contains: suche, mode: 'insensitive' as const } },
                  { contentAfter: { contains: suche, mode: 'insensitive' as const } },
                ]
              : []),
          ],
        }
      : {}),
  };
}

/** Auswahl ohne die Inhaltsfelder - Prisma laedt sie dann gar nicht erst. */
const OHNE_INHALT = {
  id: true,
  guildId: true,
  category: true,
  type: true,
  severity: true,
  actorDiscordId: true,
  actorUsername: true,
  actorSource: true,
  subjectDiscordId: true,
  subjectUsername: true,
  channelId: true,
  channelName: true,
  messageId: true,
  moderationActionId: true,
  bulkId: true,
  metadata: true,
  occurredAt: true,
  createdAt: true,
} as const;

export async function timeline(query: TimelineQuery): Promise<TimelinePage> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const gemeinsam = {
    where: baueWhere(query),
    orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }],
    // Eine Zeile mehr, als angezeigt wird: sie beantwortet, ob es weitergeht,
    // ohne eine zweite Zaehlabfrage ueber eine grosse Tabelle.
    take: pageSize + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };

  const zeilen = query.mitInhalten
    ? await prisma.discordEvent.findMany(gemeinsam)
    : await prisma.discordEvent.findMany({ ...gemeinsam, select: OHNE_INHALT });

  const hatMehr = zeilen.length > pageSize;
  const sichtbar = hatMehr ? zeilen.slice(0, pageSize) : zeilen;

  return {
    zeilen: sichtbar,
    naechsterCursor: hatMehr ? (sichtbar.at(-1)?.id ?? null) : null,
  };
}

/** Ein einzelnes Ereignis samt archivierter Dateien. */
export async function getEvent(guildId: string, id: string, mitInhalten: boolean) {
  const zeile = await prisma.discordEvent.findFirst({
    where: { id, guildId },
    include: {
      medien: {
        where: { deletedAt: null },
        select: { id: true, displayName: true, mimeType: true, byteSize: true, expiresAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!zeile) {
    return null;
  }
  // Auch hier: nicht ausblenden in der Anzeige, sondern aus der Antwort
  // entfernen.
  return mitInhalten ? zeile : { ...zeile, contentBefore: null, contentAfter: null };
}

/** Die Zeilen einer Sammel-Loeschung. */
export async function bulkEvents(guildId: string, bulkId: string, mitInhalten: boolean) {
  const gemeinsam = {
    where: { guildId, bulkId },
    orderBy: [{ occurredAt: 'asc' as const }],
    take: 500,
  };
  return mitInhalten
    ? prisma.discordEvent.findMany(gemeinsam)
    : prisma.discordEvent.findMany({ ...gemeinsam, select: OHNE_INHALT });
}

export interface AnalyticsStats {
  gesamt: number;
  heute: number;
  proKategorie: Array<{ category: DiscordEventCategory; anzahl: number }>;
  /** Aeltestes aufbewahrtes Ereignis - macht die Aufbewahrungsfrist sichtbar. */
  aeltestes: Date | null;
}

export async function analyticsStats(guildId: string): Promise<AnalyticsStats> {
  const tagesbeginn = new Date();
  tagesbeginn.setHours(0, 0, 0, 0);

  const [gesamt, heute, kategorien, aeltestes] = await Promise.all([
    prisma.discordEvent.count({ where: { guildId } }),
    prisma.discordEvent.count({ where: { guildId, occurredAt: { gte: tagesbeginn } } }),
    prisma.discordEvent.groupBy({
      by: ['category'],
      where: { guildId },
      _count: { _all: true },
    }),
    prisma.discordEvent.findFirst({
      where: { guildId },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    }),
  ]);

  return {
    gesamt,
    heute,
    proKategorie: kategorien
      .map((zeile) => ({ category: zeile.category, anzahl: zeile._count._all }))
      .sort((a, b) => b.anzahl - a.anzahl),
    aeltestes: aeltestes?.occurredAt ?? null,
  };
}

/** Belegter Speicher des Medienarchivs in Bytes. */
export async function medienBelegung(guildId: string): Promise<number> {
  const summe = await prisma.discordEventMedia.aggregate({
    where: { guildId, deletedAt: null },
    _sum: { byteSize: true },
  });
  return summe._sum.byteSize ?? 0;
}
