import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type {
  CalendarEvent,
  CalendarRegistration,
  CalendarRegistrationStatus,
  Prisma,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, forbidden, notFound } from '@swisshub/shared';
import { CALENDAR_MODULE_ID } from './config';
import { requireEvent } from './service';
import type { CalendarActor } from './schemas';

const logger = createLogger('calendar:registrations');

/**
 * Anmeldungen zu einem Termin.
 *
 * Der Kern ist eine einzige Frage: ist noch ein Platz frei? Wer sie ohne
 * Sperre beantwortet, beantwortet sie fuer zwei gleichzeitige Anmeldungen
 * zweimal mit «ja» - und der Abend ist um eine Person ueberbucht. Deshalb
 * wird die Terminzeile gesperrt, bevor gezaehlt wird; ab da entscheidet nur
 * dieser Vorgang. Dasselbe Vorgehen wie bei der Turnieranmeldung.
 *
 * Die Eindeutigkeit `(eventId, discordId)` in der Datenbank ist die zweite
 * Sicherung: sie faengt den Doppelklick auch dann, wenn zwei Anfragen sich
 * exakt ueberlagern.
 */

export interface AnmeldeErgebnis {
  registration: CalendarRegistration;
  /** Auf der Warteliste gelandet statt bestaetigt. */
  waitlisted: boolean;
  position: number | null;
}

export interface Belegung {
  confirmed: number;
  waitlist: number;
  capacity: number;
  /** `null` bei unbegrenzt. */
  freeSeats: number | null;
  full: boolean;
}

export async function belegung(eventId: string): Promise<Belegung> {
  const event = await requireEvent(eventId);
  const [confirmed, waitlist] = await Promise.all([
    prisma.calendarRegistration.count({ where: { eventId, status: 'CONFIRMED' } }),
    prisma.calendarRegistration.count({ where: { eventId, status: 'WAITLIST' } }),
  ]);
  const capacity = event.capacity;
  return {
    confirmed,
    waitlist,
    capacity,
    freeSeats: capacity > 0 ? Math.max(0, capacity - confirmed) : null,
    full: capacity > 0 && confirmed >= capacity,
  };
}

/** Warum eine Anmeldung gerade nicht geht - oder `null`, wenn sie geht. */
export function anmeldungGesperrt(event: CalendarEvent, now = new Date()): string | null {
  if (!event.registrationEnabled) {
    return 'Für dieses Event gibt es keine Anmeldung.';
  }
  if (event.status === 'CANCELLED') {
    return 'Dieses Event wurde abgesagt.';
  }
  if (event.status === 'COMPLETED') {
    return 'Dieses Event ist bereits vorbei.';
  }
  if (event.status === 'DRAFT') {
    return 'Dieses Event ist noch nicht veröffentlicht.';
  }
  if (event.registrationClosesAt && event.registrationClosesAt <= now) {
    return 'Die Anmeldefrist ist abgelaufen.';
  }
  // Ein Termin, der laengst begonnen hat, nimmt niemanden mehr auf - auch
  // ohne ausdruecklichen Anmeldeschluss.
  if (event.startAt <= now) {
    return 'Dieses Event hat bereits begonnen.';
  }
  return null;
}

/** Warum eine Abmeldung gerade nicht geht - oder `null`. */
export function abmeldungGesperrt(event: CalendarEvent, now = new Date()): string | null {
  if (!event.allowSelfCancel) {
    return 'Für dieses Event ist keine eigenständige Abmeldung vorgesehen. Bitte melde dich bei der Organisation.';
  }
  if (event.cancelDeadlineAt && event.cancelDeadlineAt <= now) {
    return 'Die Frist für eine Abmeldung ist abgelaufen.';
  }
  if (event.status === 'COMPLETED') {
    return 'Dieses Event ist bereits vorbei.';
  }
  return null;
}

async function pruefeAntworten(
  eventId: string,
  antworten: Record<string, string>,
): Promise<Map<string, string>> {
  const fragen = await prisma.calendarQuestion.findMany({
    where: { eventId },
    orderBy: { position: 'asc' },
  });
  const ergebnis = new Map<string, string>();
  for (const frage of fragen) {
    const wert = (antworten[frage.id] ?? '').trim();
    if (!wert) {
      if (frage.required) {
        throw conflict(`Bitte beantworte «${frage.label}».`);
      }
      continue;
    }
    if (frage.choices.length > 0 && !frage.choices.includes(wert)) {
      throw conflict(`«${wert}» ist bei «${frage.label}» nicht zur Auswahl.`);
    }
    ergebnis.set(frage.id, wert.slice(0, 500));
  }
  return ergebnis;
}

export interface TeilnehmerIdentitaet {
  discordId: string;
  username?: string | null;
  displayName?: string | null;
}

export async function register(
  identity: TeilnehmerIdentitaet,
  eventId: string,
  antworten: Record<string, string> = {},
  now = new Date(),
): Promise<AnmeldeErgebnis> {
  const event = await requireEvent(eventId);
  const gesperrt = anmeldungGesperrt(event, now);
  if (gesperrt) {
    throw conflict(gesperrt);
  }
  const geprueft = await pruefeAntworten(eventId, antworten);

  const ergebnis = await prisma.$transaction(async (tx) => {
    // Ab hier entscheidet nur dieser Vorgang, ob noch ein Platz frei ist.
    // Ohne diese Zeile koennten zwei gleichzeitige Anmeldungen beide den
    // letzten Platz bekommen.
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;

    const frisch = await tx.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });
    const vorhanden = await tx.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId, discordId: identity.discordId } },
    });
    if (vorhanden && vorhanden.status !== 'CANCELLED') {
      throw conflict('Du bist bereits angemeldet.');
    }

    const belegt = await tx.calendarRegistration.count({
      where: { eventId, status: 'CONFIRMED' },
    });
    const wartend = await tx.calendarRegistration.count({
      where: { eventId, status: 'WAITLIST' },
    });
    const voll = frisch.capacity > 0 && belegt >= frisch.capacity;

    if (voll && !frisch.waitlistEnabled) {
      throw conflict('Dieses Event ist ausgebucht.');
    }

    const status: CalendarRegistrationStatus = voll ? 'WAITLIST' : 'CONFIRMED';
    const daten = {
      eventId,
      discordId: identity.discordId,
      username: identity.username?.slice(0, 64) ?? null,
      displayName: identity.displayName?.slice(0, 64) ?? null,
      status,
      waitlistPosition: voll ? wartend + 1 : null,
      registeredAt: now,
      cancelledAt: null,
      // Eine erneute Anmeldung nach einer Abmeldung ist eine neue Anmeldung,
      // kein wiederhergestelltes Nachruecken.
      promotedAt: null,
      promotionNotifiedAt: null,
    };

    const eintrag = vorhanden
      ? await tx.calendarRegistration.update({ where: { id: vorhanden.id }, data: daten })
      : await tx.calendarRegistration.create({ data: daten });

    // Antworten ersetzen - eine erneute Anmeldung soll nicht die alten
    // Angaben behalten.
    await tx.calendarAnswer.deleteMany({ where: { registrationId: eintrag.id } });
    if (geprueft.size > 0) {
      await tx.calendarAnswer.createMany({
        data: [...geprueft].map(([questionId, value]) => ({
          registrationId: eintrag.id,
          questionId,
          value,
        })),
      });
    }

    return { registration: eintrag, waitlisted: voll, position: eintrag.waitlistPosition };
  });

  const { meldeEreignis } = await import('../automation/emit');
  await meldeEreignis(
    'calendar.registration_created',
    {
      eventId,
      registrationId: ergebnis.registration.id,
      discordId: identity.discordId,
      titel: event.title,
      status: ergebnis.registration.status,
    },
    {
      guildId: event.guildId,
      actorId: identity.discordId,
      subjectId: identity.discordId,
      entityId: eventId,
    },
  );

  logger.info('Anmeldung eingegangen', {
    eventId,
    discordId: identity.discordId,
    status: ergebnis.registration.status,
  });
  return ergebnis;
}

export interface AbmeldeErgebnis {
  registration: CalendarRegistration;
  /** Wer durch die Abmeldung nachgerueckt ist. */
  nachgerueckt: CalendarRegistration | null;
}

/**
 * Sich selbst abmelden.
 *
 * Wird dadurch ein Platz frei, rueckt in derselben Transaktion die erste
 * wartende Person nach. Das getrennt zu tun hiesse, dass zwischen Freiwerden
 * und Nachruecken jemand anders den Platz nehmen koennte - und die Warteliste
 * waere eine Empfehlung statt einer Reihenfolge.
 */
export async function unregister(
  discordId: string,
  eventId: string,
  now = new Date(),
): Promise<AbmeldeErgebnis> {
  const event = await requireEvent(eventId);
  const gesperrt = abmeldungGesperrt(event, now);
  if (gesperrt) {
    throw conflict(gesperrt);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;

    const vorhanden = await tx.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId, discordId } },
    });
    if (!vorhanden || vorhanden.status === 'CANCELLED') {
      throw conflict('Du bist für dieses Event nicht angemeldet.');
    }

    const abgemeldet = await tx.calendarRegistration.update({
      where: { id: vorhanden.id },
      data: { status: 'CANCELLED', cancelledAt: now, waitlistPosition: null },
    });

    // Nur ein frei gewordener bestaetigter Platz laesst jemanden nachruecken.
    // Wer von der Warteliste abspringt, gibt keinen Platz frei - dann muss
    // aber die Reihenfolge dahinter aufschliessen.
    const nachgerueckt =
      vorhanden.status === 'CONFIRMED' ? await rueckeNach(tx, eventId, now) : null;
    await nummeriereWarteliste(tx, eventId);

    return { registration: abgemeldet, nachgerueckt };
  });
}

/**
 * Die erste wartende Person auf einen frei gewordenen Platz setzen.
 *
 * Erwartet eine bereits gesperrte Terminzeile - die Sperre ist der Grund,
 * weshalb hier nicht zwei Personen auf denselben Platz nachruecken.
 */
async function rueckeNach(
  tx: Prisma.TransactionClient,
  eventId: string,
  now: Date,
): Promise<CalendarRegistration | null> {
  const event = await tx.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.capacity <= 0) {
    return null;
  }
  const belegt = await tx.calendarRegistration.count({
    where: { eventId, status: 'CONFIRMED' },
  });
  if (belegt >= event.capacity) {
    return null;
  }
  const naechster = await tx.calendarRegistration.findFirst({
    where: { eventId, status: 'WAITLIST' },
    orderBy: [{ waitlistPosition: 'asc' }, { registeredAt: 'asc' }],
  });
  if (!naechster) {
    return null;
  }
  return tx.calendarRegistration.update({
    where: { id: naechster.id },
    data: { status: 'CONFIRMED', waitlistPosition: null, promotedAt: now },
  });
}

/** Luecken in der Warteliste schliessen, damit die Plaetze 1..n durchlaufen. */
async function nummeriereWarteliste(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const wartende = await tx.calendarRegistration.findMany({
    where: { eventId, status: 'WAITLIST' },
    orderBy: [{ waitlistPosition: 'asc' }, { registeredAt: 'asc' }],
    select: { id: true, waitlistPosition: true },
  });
  for (const [index, eintrag] of wartende.entries()) {
    const soll = index + 1;
    if (eintrag.waitlistPosition !== soll) {
      await tx.calendarRegistration.update({
        where: { id: eintrag.id },
        data: { waitlistPosition: soll },
      });
    }
  }
}

/**
 * Eine Anmeldung durch die Verwaltung entfernen.
 *
 * Derselbe Weg wie eine Abmeldung, nur ohne die Fristen: die gelten fuer die
 * Teilnehmer, nicht fuer die Organisation.
 */
export async function removeRegistration(
  actor: CalendarActor,
  registrationId: string,
  reason: string | null,
  now = new Date(),
): Promise<AbmeldeErgebnis> {
  const eintrag = await prisma.calendarRegistration.findUnique({
    where: { id: registrationId },
    include: { event: { select: { id: true, title: true } } },
  });
  if (!eintrag) {
    throw notFound('Anmeldung nicht gefunden', 'Diese Anmeldung existiert nicht.');
  }

  const ergebnis = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eintrag.eventId} FOR UPDATE`;
    const abgemeldet = await tx.calendarRegistration.update({
      where: { id: registrationId },
      data: { status: 'CANCELLED', cancelledAt: now, waitlistPosition: null },
    });
    const nachgerueckt =
      eintrag.status === 'CONFIRMED' ? await rueckeNach(tx, eintrag.eventId, now) : null;
    await nummeriereWarteliste(tx, eintrag.eventId);
    return { registration: abgemeldet, nachgerueckt };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_REGISTRATION_REMOVED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: eintrag.event.title,
    targetDiscordId: eintrag.discordId,
    success: true,
    metadata: { eventId: eintrag.eventId, registrationId, reason },
  });
  return ergebnis;
}

/**
 * Nachruecken nachholen, wenn sich die Platzzahl geaendert hat.
 *
 * Wird die Kapazitaet erhoeht, sollen Wartende aufruecken, ohne dass jemand
 * sich erst abmelden muss. Der Aufruf ist idempotent: ist kein Platz frei,
 * geschieht nichts.
 */
export async function fuelleFreiePlaetze(
  eventId: string,
  now = new Date(),
): Promise<CalendarRegistration[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;
    const nachgerueckt: CalendarRegistration[] = [];
    // Schleife statt Einzelfall: nach einer Erhoehung um fuenf Plaetze
    // ruecken fuenf Personen nach, nicht eine.
    for (;;) {
      const naechster = await rueckeNach(tx, eventId, now);
      if (!naechster) {
        break;
      }
      nachgerueckt.push(naechster);
    }
    await nummeriereWarteliste(tx, eventId);
    return nachgerueckt;
  });
}

export interface TeilnehmerZeile {
  id: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  status: CalendarRegistrationStatus;
  waitlistPosition: number | null;
  registeredAt: Date;
  promotedAt: Date | null;
  answers: Array<{ question: string; value: string }>;
}

/**
 * Teilnehmerliste eines Termins.
 *
 * Die Berechtigung prueft der Aufrufer - diese Stelle prueft sie nicht, und
 * genau deshalb darf sie nie ungeprueft aufgerufen werden. `withAnswers`
 * entscheidet, ob die Antworten auf Zusatzfragen mitkommen: sie gehen nur die
 * Organisation etwas an, nicht die oeffentliche Liste.
 */
export async function listRegistrations(
  eventId: string,
  options: { withAnswers?: boolean; includeCancelled?: boolean } = {},
): Promise<TeilnehmerZeile[]> {
  const where: Prisma.CalendarRegistrationWhereInput = {
    eventId,
    ...(options.includeCancelled ? {} : { status: { in: ['CONFIRMED', 'WAITLIST'] } }),
  };
  const orderBy: Prisma.CalendarRegistrationOrderByWithRelationInput[] = [
    { status: 'asc' },
    { waitlistPosition: 'asc' },
    { registeredAt: 'asc' },
  ];

  // Zwei Abfragen statt einer bedingten: der Verbund auf die Antworten kostet
  // etwas, und die oeffentliche Liste braucht ihn nie.
  if (!options.withAnswers) {
    const zeilen = await prisma.calendarRegistration.findMany({ where, orderBy });
    return zeilen.map((zeile) => ({
      id: zeile.id,
      discordId: zeile.discordId,
      username: zeile.username,
      displayName: zeile.displayName,
      status: zeile.status,
      waitlistPosition: zeile.waitlistPosition,
      registeredAt: zeile.registeredAt,
      promotedAt: zeile.promotedAt,
      answers: [],
    }));
  }

  const zeilen = await prisma.calendarRegistration.findMany({
    where,
    orderBy,
    include: { answers: { include: { question: { select: { label: true } } } } },
  });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    discordId: zeile.discordId,
    username: zeile.username,
    displayName: zeile.displayName,
    status: zeile.status,
    waitlistPosition: zeile.waitlistPosition,
    registeredAt: zeile.registeredAt,
    promotedAt: zeile.promotedAt,
    answers: zeile.answers.map((antwort) => ({
      question: antwort.question.label,
      value: antwort.value,
    })),
  }));
}

/** Die eigene Anmeldung - Grundlage der Knopfbeschriftung auf der Detailseite. */
export async function meineAnmeldung(
  eventId: string,
  discordId: string,
): Promise<CalendarRegistration | null> {
  const eintrag = await prisma.calendarRegistration.findUnique({
    where: { eventId_discordId: { eventId, discordId } },
  });
  return eintrag && eintrag.status !== 'CANCELLED' ? eintrag : null;
}

export { forbidden };
