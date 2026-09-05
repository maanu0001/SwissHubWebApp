import { prisma } from '@swisshub/database';
import type { CalendarCategory, CalendarEvent, CalendarEventStatus, Prisma } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import {
  monatsBeginnIn,
  naechsterMonatsBeginnIn,
  tagesBeginnIn,
  tageSpaeter,
  wochenBeginnIn,
} from '@swisshub/shared';
import { DEFAULT_TIMEZONE } from './config';
import { AKTIVE_STATUS, OEFFENTLICHE_STATUS, calendarSettings } from './service';
import type { CalendarQuery } from './schemas';

/**
 * Abfragen fuer Kalender, Verwaltung und Dashboard.
 *
 * Alle Daten strikt nach Guild getrennt: die Kennung kommt aus der
 * Serverkonfiguration, nicht aus der Anfrage. Ohne sie liefert jede Abfrage
 * eine leere Liste statt der Termine eines fremden Servers.
 */

export interface EventZeile {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  status: CalendarEventStatus;
  startAt: Date;
  endAt: Date | null;
  timezone: string;
  allDay: boolean;
  bannerUrl: string | null;
  iconUrl: string | null;
  locationKind: CalendarEvent['locationKind'];
  registrationEnabled: boolean;
  capacity: number;
  category: { id: string; name: string; color: string; icon: string | null } | null;
  confirmed: number;
  waitlist: number;
  /** Ist der Betrachter angemeldet - und wie? */
  meine: 'CONFIRMED' | 'WAITLIST' | null;
}

const ZEILEN_AUSWAHL = {
  id: true,
  slug: true,
  title: true,
  shortDescription: true,
  status: true,
  startAt: true,
  endAt: true,
  timezone: true,
  allDay: true,
  bannerUrl: true,
  iconUrl: true,
  locationKind: true,
  registrationEnabled: true,
  capacity: true,
  category: { select: { id: true, name: true, color: true, icon: true } },
} satisfies Prisma.CalendarEventSelect;

/**
 * Zaehlt Anmeldungen fuer mehrere Events auf einmal.
 *
 * Eine Abfrage je Event waere bei einer Monatsansicht mit 40 Terminen 40
 * Rundreisen zur Datenbank - eine Gruppierung ist eine.
 */
async function belegungen(
  eventIds: string[],
  viewerDiscordId: string | null,
): Promise<{
  zahlen: Map<string, { confirmed: number; waitlist: number }>;
  eigene: Map<string, 'CONFIRMED' | 'WAITLIST'>;
}> {
  const zahlen = new Map<string, { confirmed: number; waitlist: number }>();
  const eigene = new Map<string, 'CONFIRMED' | 'WAITLIST'>();
  if (eventIds.length === 0) {
    return { zahlen, eigene };
  }

  const gruppen = await prisma.calendarRegistration.groupBy({
    by: ['eventId', 'status'],
    where: { eventId: { in: eventIds }, status: { in: ['CONFIRMED', 'WAITLIST'] } },
    _count: { _all: true },
  });
  for (const gruppe of gruppen) {
    const eintrag = zahlen.get(gruppe.eventId) ?? { confirmed: 0, waitlist: 0 };
    if (gruppe.status === 'CONFIRMED') {
      eintrag.confirmed = gruppe._count._all;
    } else {
      eintrag.waitlist = gruppe._count._all;
    }
    zahlen.set(gruppe.eventId, eintrag);
  }

  if (viewerDiscordId) {
    const meine = await prisma.calendarRegistration.findMany({
      where: {
        eventId: { in: eventIds },
        discordId: viewerDiscordId,
        status: { in: ['CONFIRMED', 'WAITLIST'] },
      },
      select: { eventId: true, status: true },
    });
    for (const eintrag of meine) {
      eigene.set(eintrag.eventId, eintrag.status as 'CONFIRMED' | 'WAITLIST');
    }
  }

  return { zahlen, eigene };
}

function zuZeile(
  event: Prisma.CalendarEventGetPayload<{ select: typeof ZEILEN_AUSWAHL }>,
  zahlen: Map<string, { confirmed: number; waitlist: number }>,
  eigene: Map<string, 'CONFIRMED' | 'WAITLIST'>,
): EventZeile {
  const zahl = zahlen.get(event.id) ?? { confirmed: 0, waitlist: 0 };
  return {
    ...event,
    confirmed: zahl.confirmed,
    waitlist: zahl.waitlist,
    meine: eigene.get(event.id) ?? null,
  };
}

export interface SichtbarkeitsOptionen {
  /** Darf auch Entwuerfe sehen (Verwaltung). */
  includeDrafts?: boolean;
  viewerDiscordId?: string | null;
}

function statusFilter(options: SichtbarkeitsOptionen): CalendarEventStatus[] {
  return options.includeDrafts ? ['DRAFT', ...OEFFENTLICHE_STATUS] : [...OEFFENTLICHE_STATUS];
}

/** Der angezeigte Zeitraum, abgeleitet aus Ansicht und Ankerdatum. */
export function zeitraumFuer(
  query: Pick<CalendarQuery, 'view' | 'anchor'>,
  zone = DEFAULT_TIMEZONE,
  now = new Date(),
): { von: Date; bis: Date; anker: Date } {
  const anker = query.anchor ? new Date(query.anchor) : now;
  const gueltig = Number.isNaN(anker.getTime()) ? now : anker;

  if (query.view === 'week') {
    const von = wochenBeginnIn(gueltig, zone);
    return { von, bis: tageSpaeter(von, zone, 7), anker: gueltig };
  }
  if (query.view === 'agenda') {
    // Die Agenda blickt nach vorn, nicht auf einen Kalenderausschnitt: auf
    // dem Telefon will man wissen, was als Naechstes ansteht.
    const von = tagesBeginnIn(gueltig, zone);
    return { von, bis: tageSpaeter(von, zone, 60), anker: gueltig };
  }
  // Monatsansicht: der Gitterrand geht bis zu sechs Tage in die Nachbarmonate,
  // und die dortigen Termine sollen ebenfalls erscheinen.
  const monatsStart = monatsBeginnIn(gueltig, zone);
  const von = tageSpaeter(monatsStart, zone, -7);
  const bis = tageSpaeter(naechsterMonatsBeginnIn(gueltig, zone), zone, 7);
  return { von, bis, anker: gueltig };
}

/** Termine eines Zeitraums - Grundlage von Monats-, Wochen- und Agendaansicht. */
export async function listEventsInRange(
  von: Date,
  bis: Date,
  query: Partial<CalendarQuery> = {},
  options: SichtbarkeitsOptionen = {},
): Promise<EventZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  const settings = await calendarSettings();
  const vorgabeMs = settings.defaultDurationMinutes * 60_000;

  // Ein Termin gehoert in den Ausschnitt, wenn er darin beginnt **oder** noch
  // hineinragt. Der zweite Fall ist der ueber Mitternacht laufende Abend: er
  // beginnt am Freitag, endet am Samstag, und in der Samstagsspalte muss er
  // stehen. Nur nach `startAt` zu filtern hiesse, ihn dort zu verlieren.
  const spielraum = new Date(von.getTime() - vorgabeMs);

  const events = await prisma.calendarEvent.findMany({
    where: {
      guildId,
      status: { in: statusFilter(options) },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.withRegistration ? { registrationEnabled: true } : {}),
      // Die Textsuche steht unter `AND`, nicht als zweites `OR` daneben: zwei
      // gleichnamige Eigenschaften in einem Objekt sind keine Verknuepfung -
      // die zweite ueberschreibt die erste, und der Filter fiele lautlos weg.
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: query.search, mode: 'insensitive' as const } },
                  { description: { contains: query.search, mode: 'insensitive' as const } },
                  { shortDescription: { contains: query.search, mode: 'insensitive' as const } },
                ],
              },
            ],
          }
        : {}),
      ...(query.mine && options.viewerDiscordId
        ? {
            registrations: {
              some: {
                discordId: options.viewerDiscordId,
                status: { in: ['CONFIRMED', 'WAITLIST'] },
              },
            },
          }
        : {}),
      OR: [
        { startAt: { gte: von, lt: bis } },
        { endAt: { gte: von, lt: bis } },
        { AND: [{ startAt: { lt: von, gte: spielraum } }, { endAt: null }] },
        { AND: [{ startAt: { lt: von } }, { endAt: { gte: bis } }] },
      ],
    },
    select: ZEILEN_AUSWAHL,
    orderBy: { startAt: 'asc' },
    take: 400,
  });

  const { zahlen, eigene } = await belegungen(
    events.map((event) => event.id),
    options.viewerDiscordId ?? null,
  );
  const zeilen = events.map((event) => zuZeile(event, zahlen, eigene));

  // Erst nach dem Zaehlen filterbar: «noch Plaetze frei» haengt an der Zahl
  // der Anmeldungen, nicht an einer Spalte.
  return query.withFreeSeats
    ? zeilen.filter(
        (zeile) => zeile.registrationEnabled && (zeile.capacity === 0 || zeile.confirmed < zeile.capacity),
      )
    : zeilen;
}

/** Die naechsten anstehenden Termine - fuer Dashboard und Seitenspalte. */
export async function listUpcoming(
  limit = 5,
  options: SichtbarkeitsOptionen = {},
  now = new Date(),
): Promise<EventZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  const events = await prisma.calendarEvent.findMany({
    where: {
      guildId,
      status: { in: options.includeDrafts ? ['DRAFT', ...AKTIVE_STATUS] : [...AKTIVE_STATUS] },
      startAt: { gte: new Date(now.getTime() - 6 * 3600_000) },
    },
    select: ZEILEN_AUSWAHL,
    orderBy: { startAt: 'asc' },
    take: limit,
  });
  const { zahlen, eigene } = await belegungen(
    events.map((event) => event.id),
    options.viewerDiscordId ?? null,
  );
  return events.map((event) => zuZeile(event, zahlen, eigene));
}

/** Termine, bei denen der Betrachter angemeldet ist. */
export async function listMine(
  discordId: string,
  options: { past?: boolean; limit?: number } = {},
  now = new Date(),
): Promise<EventZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  const events = await prisma.calendarEvent.findMany({
    where: {
      guildId,
      status: { in: [...OEFFENTLICHE_STATUS] },
      registrations: { some: { discordId, status: { in: ['CONFIRMED', 'WAITLIST'] } } },
      ...(options.past ? { startAt: { lt: now } } : { startAt: { gte: now } }),
    },
    select: ZEILEN_AUSWAHL,
    orderBy: { startAt: options.past ? 'desc' : 'asc' },
    take: options.limit ?? 50,
  });
  const { zahlen, eigene } = await belegungen(
    events.map((event) => event.id),
    discordId,
  );
  return events.map((event) => zuZeile(event, zahlen, eigene));
}

/** Verwaltungsliste, nach Zustand gefiltert. */
export async function listForManagement(
  status: CalendarEventStatus | 'ALL',
  options: { search?: string; limit?: number } = {},
): Promise<EventZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  const events = await prisma.calendarEvent.findMany({
    where: {
      guildId,
      ...(status === 'ALL' ? {} : { status }),
      ...(options.search ? { title: { contains: options.search, mode: 'insensitive' as const } } : {}),
    },
    select: ZEILEN_AUSWAHL,
    orderBy: { startAt: 'desc' },
    take: options.limit ?? 100,
  });
  const { zahlen, eigene } = await belegungen(
    events.map((event) => event.id),
    null,
  );
  return events.map((event) => zuZeile(event, zahlen, eigene));
}

export async function listCategories(activeOnly = false): Promise<CalendarCategory[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  return prisma.calendarCategory.findMany({
    where: { guildId, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export interface KalenderKennzahlen {
  gesamt: number;
  kommend: number;
  laufend: number;
  entwuerfe: number;
  abgesagt: number;
  anmeldungenGesamt: number;
  /**
   * Durchschnittliche Teilnehmerzahl - nur ueber beendete Events **mit**
   * Anmeldung. Events ohne Anmeldung mitzurechnen ergaebe eine Zahl, die
   * nichts bedeutet: sie hatten nie eine Teilnehmerliste.
   */
  schnittTeilnehmer: number | null;
  /** Wie viele beendete Events in den Schnitt eingegangen sind. */
  schnittBasis: number;
  beliebtesteKategorien: Array<{ name: string; color: string; anzahl: number }>;
  bestBesucht: Array<{ id: string; slug: string; title: string; teilnehmer: number }>;
}

/**
 * Kennzahlen der Verwaltung.
 *
 * Ausdruecklich nur, was sich aus vorhandenen Daten rechnen laesst. Eine
 * No-Show-Quote etwa steht hier nicht: das System erfasst keine Anwesenheit,
 * und eine geschaetzte Zahl waere schlimmer als keine.
 */
export async function kennzahlen(now = new Date()): Promise<KalenderKennzahlen> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return {
      gesamt: 0,
      kommend: 0,
      laufend: 0,
      entwuerfe: 0,
      abgesagt: 0,
      anmeldungenGesamt: 0,
      schnittTeilnehmer: null,
      schnittBasis: 0,
      beliebtesteKategorien: [],
      bestBesucht: [],
    };
  }

  const [gesamt, kommend, laufend, entwuerfe, abgesagt, anmeldungenGesamt] = await Promise.all([
    prisma.calendarEvent.count({ where: { guildId } }),
    prisma.calendarEvent.count({ where: { guildId, status: 'SCHEDULED', startAt: { gte: now } } }),
    prisma.calendarEvent.count({ where: { guildId, status: 'ONGOING' } }),
    prisma.calendarEvent.count({ where: { guildId, status: 'DRAFT' } }),
    prisma.calendarEvent.count({ where: { guildId, status: 'CANCELLED' } }),
    prisma.calendarRegistration.count({
      where: { event: { guildId }, status: { in: ['CONFIRMED', 'WAITLIST'] } },
    }),
  ]);

  // Schnitt nur ueber beendete Events mit Anmeldung.
  const beendet = await prisma.calendarEvent.findMany({
    where: { guildId, status: 'COMPLETED', registrationEnabled: true },
    select: { id: true, slug: true, title: true },
    take: 500,
  });
  const teilnahmen = await prisma.calendarRegistration.groupBy({
    by: ['eventId'],
    where: { eventId: { in: beendet.map((event) => event.id) }, status: 'CONFIRMED' },
    _count: { _all: true },
  });
  const proEvent = new Map(teilnahmen.map((zeile) => [zeile.eventId, zeile._count._all]));
  const summe = beendet.reduce((wert, event) => wert + (proEvent.get(event.id) ?? 0), 0);

  const bestBesucht = beendet
    .map((event) => ({ ...event, teilnehmer: proEvent.get(event.id) ?? 0 }))
    .sort((a, b) => b.teilnehmer - a.teilnehmer)
    .slice(0, 5)
    .filter((event) => event.teilnehmer > 0);

  const kategorien = await prisma.calendarEvent.groupBy({
    by: ['categoryId'],
    where: { guildId, categoryId: { not: null } },
    _count: { _all: true },
  });
  const stammdaten = await prisma.calendarCategory.findMany({
    where: { id: { in: kategorien.map((zeile) => zeile.categoryId!).filter(Boolean) } },
    select: { id: true, name: true, color: true },
  });
  const nachId = new Map(stammdaten.map((eintrag) => [eintrag.id, eintrag]));
  const beliebtesteKategorien = kategorien
    .map((zeile) => {
      const eintrag = nachId.get(zeile.categoryId!);
      return eintrag ? { name: eintrag.name, color: eintrag.color, anzahl: zeile._count._all } : null;
    })
    .filter((eintrag): eintrag is { name: string; color: string; anzahl: number } => eintrag !== null)
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 5);

  return {
    gesamt,
    kommend,
    laufend,
    entwuerfe,
    abgesagt,
    anmeldungenGesamt,
    schnittTeilnehmer: beendet.length > 0 ? Math.round((summe / beendet.length) * 10) / 10 : null,
    schnittBasis: beendet.length,
    beliebtesteKategorien,
    bestBesucht,
  };
}

export interface FrageZeile {
  id: string;
  label: string;
  hint: string | null;
  required: boolean;
  choices: string[];
}

/** Zusatzfragen eines Events, in der eingestellten Reihenfolge. */
export async function listQuestions(eventId: string): Promise<FrageZeile[]> {
  return prisma.calendarQuestion.findMany({
    where: { eventId },
    orderBy: { position: 'asc' },
    select: { id: true, label: true, hint: true, required: true, choices: true },
  });
}

export interface ErinnerungsZeile {
  id: string;
  minutesBefore: number;
  dueAt: Date;
  channelId: string | null;
  mentionRoleId: string | null;
  mentionRegistrants: boolean;
  sentAt: Date | null;
  attempts: number;
  lastError: string | null;
}

/** Erinnerungen eines Events, laengster Vorlauf zuerst. */
export async function listReminders(eventId: string): Promise<ErinnerungsZeile[]> {
  return prisma.calendarReminder.findMany({
    where: { eventId },
    orderBy: { minutesBefore: 'desc' },
    select: {
      id: true,
      minutesBefore: true,
      dueAt: true,
      channelId: true,
      mentionRoleId: true,
      mentionRegistrants: true,
      sentAt: true,
      attempts: true,
      lastError: true,
    },
  });
}
