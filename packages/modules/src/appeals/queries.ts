import { prisma } from '@swisshub/database';
import type { AppealPriority, AppealStatus } from '@swisshub/database';
import { formatFallnummer } from './numbering';
import { STATUS_LABEL_ANTRAGSTELLER } from './status';
import type { BanSnapshot } from './eligibility';
import { snapshotFuerAntragsteller } from './eligibility';

/**
 * Die Abfragen - und die wichtigste Trennung des Moduls.
 *
 * Es gibt **zwei** Sichten auf denselben Fall, und sie entstehen nicht durch
 * Weglassen in der Anzeige, sondern durch getrennte Abfragen:
 *
 * - `holeAntragstellerSicht` liest interne Kommentare gar nicht erst und
 *   filtert die Zeitleiste in der Datenbank auf `PUBLIC`.
 * - `holeStaffSicht` liest alles.
 *
 * Der Unterschied ist Absicht. Eine gemeinsame Abfrage mit einem `if` in der
 * Ausgabe wäre eine Zeile davon entfernt, interne Notizen an den
 * Antragsteller zu senden - und diese eine Zeile hätte irgendwann jemand
 * übersehen.
 */

// --- Antragsteller ----------------------------------------------------------

export interface AntragstellerNachricht {
  id: string;
  /** `SwissHub Team` oder `Du` - nie ein Moderatorname (§22). */
  von: 'TEAM' | 'DU';
  inhalt: string;
  am: Date;
}

export interface AntragstellerEreignis {
  id: string;
  label: string;
  am: Date;
}

export interface AntragstellerSicht {
  id: string;
  fallnummer: string;
  status: AppealStatus;
  statusLabel: string;
  eingereichtAm: Date | null;
  aktualisiertAm: Date;
  abgeschlossenAm: Date | null;
  /** Die eigenen Antworten - unveränderlich seit der Einreichung. */
  antworten: Record<string, string>;
  /** Bann-Angaben, die der Antragsteller ohnehin kennt. */
  bann: { discordGrund: string | null; verhaengtAm: string | null };
  /** Die öffentliche Begründung. Nie die interne. */
  entscheidung: string | null;
  naechsteMoeglichkeitAm: Date | null;
  nachrichten: AntragstellerNachricht[];
  zeitleiste: AntragstellerEreignis[];
  anhaenge: Array<{ id: string; fileName: string; sizeBytes: number; am: Date }>;
  /** Darf jetzt geantwortet werden? */
  darfAntworten: boolean;
  darfZurueckziehen: boolean;
}

/**
 * Die Sicht des Antragstellers.
 *
 * Die Kennung steht in der Abfrage. Ein fremder Antrag wird nicht gefunden -
 * nicht gefunden und dann verworfen, sondern gar nicht erst gelesen (§4).
 */
export async function holeAntragstellerSicht(
  guildId: string,
  appealId: string,
  antragstellerDiscordId: string,
): Promise<AntragstellerSicht | null> {
  const appeal = await prisma.appeal.findFirst({
    where: { id: appealId, guildId, applicantDiscordId: antragstellerDiscordId },
    include: {
      messages: {
        // SYSTEM-Nachrichten gibt es heute nicht; stünde je eine da, ginge sie
        // ebenfalls hinaus - deshalb hier keine Einschränkung, die später
        // stillschweigend etwas durchliesse.
        orderBy: { createdAt: 'asc' },
        take: 200,
      },
      // Die Zeitleiste wird in der Datenbank gefiltert, nicht in der Ausgabe.
      events: {
        where: { visibility: 'PUBLIC' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
      attachments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 50,
      },
      // `comments` steht bewusst nicht hier. Interne Notizen werden für den
      // Antragsteller nicht geladen.
    },
  });

  if (!appeal) {
    return null;
  }

  const antworten = { ...(appeal.answers as Record<string, string>) };
  // Der Idempotenzschlüssel ist Technik und keine Antwort.
  delete antworten.__idempotencyKey;

  const offen = ['SUBMITTED', 'UNDER_REVIEW', 'WAITING_FOR_APPLICANT', 'WAITING_FOR_STAFF', 'ESCALATED', 'DECISION_PENDING'];

  return {
    id: appeal.id,
    fallnummer: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    status: appeal.status,
    statusLabel: STATUS_LABEL_ANTRAGSTELLER[appeal.status],
    eingereichtAm: appeal.submittedAt,
    aktualisiertAm: appeal.updatedAt,
    abgeschlossenAm: appeal.closedAt,
    antworten,
    bann: snapshotFuerAntragsteller(appeal.banSnapshot as unknown as BanSnapshot),
    entscheidung: appeal.publicDecision,
    naechsteMoeglichkeitAm: appeal.nextEligibleAt,
    nachrichten: appeal.messages.map((nachricht) => ({
      id: nachricht.id,
      // Hier - und nur hier - wird aus dem Moderator «SwissHub Team». Die
      // Kennung bleibt in der Datenbank und im Audit, sie geht nur nicht
      // hinaus (§22).
      von: nachricht.author === 'APPLICANT' ? ('DU' as const) : ('TEAM' as const),
      inhalt: nachricht.content,
      am: nachricht.createdAt,
    })),
    zeitleiste: appeal.events.map((ereignis) => ({
      id: ereignis.id,
      label: ereignis.publicLabel ?? '',
      am: ereignis.createdAt,
    })),
    anhaenge: appeal.attachments.map((anhang) => ({
      id: anhang.id,
      fileName: anhang.fileName,
      sizeBytes: anhang.sizeBytes,
      am: anhang.createdAt,
    })),
    darfAntworten: offen.includes(appeal.status),
    darfZurueckziehen: offen.includes(appeal.status) || appeal.status === 'DRAFT',
  };
}

// --- Team -------------------------------------------------------------------

export interface AppealFilter {
  guildId: string;
  status?: AppealStatus[];
  prioritaet?: AppealPriority[];
  /** `null` = ohne Bearbeiter. */
  bearbeiter?: string | null;
  /** Discord-ID, Benutzername oder Fallnummer. */
  suche?: string;
  /** Nur Anträge von Personen mit früheren Anträgen. */
  nurWiederholung?: boolean;
  limit?: number;
  cursor?: string;
}

export interface AppealZeile {
  id: string;
  fallnummer: string;
  applicantDiscordId: string;
  applicantUsername: string;
  status: AppealStatus;
  prioritaet: AppealPriority;
  bearbeiterUsername: string | null;
  eingereichtAm: Date | null;
  aktualisiertAm: Date;
  /** Alter in Stunden - für die Anzeige und die Warnschwellen (§43). */
  alterStunden: number;
  offeneNachrichten: number;
  unbanStatus: string | null;
}

export async function listeAppeals(
  filter: AppealFilter,
): Promise<{ zeilen: AppealZeile[]; naechsterCursor: string | null }> {
  const limit = Math.min(filter.limit ?? 25, 100);
  const jetzt = Date.now();

  const suche = filter.suche?.trim();
  const fallnummer = suche?.match(/(\d{1,6})\s*$/u)?.[1];

  const zeilen = await prisma.appeal.findMany({
    where: {
      guildId: filter.guildId,
      ...(filter.status && filter.status.length > 0 ? { status: { in: filter.status } } : {}),
      ...(filter.prioritaet && filter.prioritaet.length > 0
        ? { priority: { in: filter.prioritaet } }
        : {}),
      ...(filter.bearbeiter !== undefined
        ? { assignedToDiscordId: filter.bearbeiter }
        : {}),
      ...(suche
        ? {
            OR: [
              { applicantDiscordId: suche },
              { applicantUsername: { contains: suche, mode: 'insensitive' as const } },
              ...(fallnummer ? [{ caseNumber: Number(fallnummer) }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    include: { _count: { select: { messages: true } } },
  });

  const hatMehr = zeilen.length > limit;
  const sichtbar = hatMehr ? zeilen.slice(0, limit) : zeilen;

  return {
    zeilen: sichtbar.map((zeile) => ({
      id: zeile.id,
      fallnummer: formatFallnummer(zeile.caseYear, zeile.caseNumber),
      applicantDiscordId: zeile.applicantDiscordId,
      applicantUsername: zeile.applicantUsername,
      status: zeile.status,
      prioritaet: zeile.priority,
      bearbeiterUsername: zeile.assignedToUsername,
      eingereichtAm: zeile.submittedAt,
      aktualisiertAm: zeile.updatedAt,
      alterStunden: Math.max(
        0,
        Math.round((jetzt - (zeile.submittedAt ?? zeile.createdAt).getTime()) / 3600_000),
      ),
      offeneNachrichten: zeile._count.messages,
      unbanStatus: zeile.unbanStatus,
    })),
    naechsterCursor: hatMehr ? (sichtbar[sichtbar.length - 1]?.id ?? null) : null,
  };
}

/**
 * Ein Fall in voller Tiefe - für das Team.
 *
 * Lädt alles: Nachrichten, interne Kommentare, die vollständige Zeitleiste.
 * Wer das aufruft, hat die Berechtigung dafür bereits nachgewiesen.
 */
export async function holeStaffSicht(guildId: string, appealId: string) {
  return prisma.appeal.findFirst({
    where: { id: appealId, guildId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
      comments: { orderBy: { createdAt: 'asc' }, take: 200 },
      events: { orderBy: { createdAt: 'asc' }, take: 200 },
      attachments: { orderBy: { createdAt: 'asc' }, take: 50 },
    },
  });
}

/** Frühere Anträge derselben Person (§49). */
export async function frühereAppeals(
  guildId: string,
  discordId: string,
  ausserId?: string,
): Promise<
  Array<{
    id: string;
    fallnummer: string;
    status: AppealStatus;
    entschiedenAm: Date | null;
    ergebnis: string | null;
  }>
> {
  const zeilen = await prisma.appeal.findMany({
    where: {
      guildId,
      applicantDiscordId: discordId,
      ...(ausserId ? { id: { not: ausserId } } : {}),
      status: { not: 'DRAFT' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      caseYear: true,
      caseNumber: true,
      status: true,
      decidedAt: true,
      decisionKind: true,
    },
  });

  return zeilen.map((zeile) => ({
    id: zeile.id,
    fallnummer: formatFallnummer(zeile.caseYear, zeile.caseNumber),
    status: zeile.status,
    entschiedenAm: zeile.decidedAt,
    ergebnis: zeile.decisionKind,
  }));
}

// --- Kennzahlen (§48) -------------------------------------------------------

export interface AppealKennzahlen {
  offen: number;
  ohneBearbeiter: number;
  wartetAufAntragsteller: number;
  neuDieseWoche: number;
  genehmigt: number;
  abgelehnt: number;
  /** Median der Bearbeitungsdauer in Stunden. `null`, wenn nichts entschieden wurde. */
  medianStunden: number | null;
  /** Anteil der Genehmigungen. Bewusst keine Bewertung einzelner Personen (§48). */
  genehmigungsQuote: number | null;
  entbannungOffen: number;
}

export async function kennzahlen(guildId: string, jetzt = new Date()): Promise<AppealKennzahlen> {
  const wocheZurueck = new Date(jetzt.getTime() - 7 * 24 * 3600_000);
  const offeneStatus: AppealStatus[] = [
    'SUBMITTED',
    'UNDER_REVIEW',
    'WAITING_FOR_APPLICANT',
    'WAITING_FOR_STAFF',
    'ESCALATED',
    'DECISION_PENDING',
  ];

  const [offen, ohneBearbeiter, wartet, neu, genehmigt, abgelehnt, entbannungOffen, entschieden] =
    await Promise.all([
      prisma.appeal.count({ where: { guildId, status: { in: offeneStatus } } }),
      prisma.appeal.count({
        where: { guildId, status: { in: offeneStatus }, assignedToDiscordId: null },
      }),
      prisma.appeal.count({ where: { guildId, status: 'WAITING_FOR_APPLICANT' } }),
      prisma.appeal.count({ where: { guildId, submittedAt: { gte: wocheZurueck } } }),
      prisma.appeal.count({ where: { guildId, decisionKind: 'APPROVE' } }),
      prisma.appeal.count({ where: { guildId, decisionKind: 'REJECT' } }),
      prisma.appeal.count({
        where: { guildId, decisionKind: 'APPROVE', unbanStatus: { in: ['PARTIAL', 'FAILED'] } },
      }),
      prisma.appeal.findMany({
        where: { guildId, decidedAt: { not: null }, submittedAt: { not: null } },
        select: { submittedAt: true, decidedAt: true },
        take: 500,
        orderBy: { decidedAt: 'desc' },
      }),
    ]);

  // Median statt Durchschnitt: ein einzelner Fall, der ein halbes Jahr lag,
  // verschiebt den Durchschnitt so weit, dass er nichts mehr aussagt.
  const dauern = entschieden
    .map((zeile) =>
      zeile.decidedAt && zeile.submittedAt
        ? (zeile.decidedAt.getTime() - zeile.submittedAt.getTime()) / 3600_000
        : null,
    )
    .filter((wert): wert is number => wert !== null)
    .sort((a, b) => a - b);

  const median =
    dauern.length === 0
      ? null
      : Math.round(dauern[Math.floor(dauern.length / 2)] ?? 0);

  const entschiedeneAnzahl = genehmigt + abgelehnt;

  return {
    offen,
    ohneBearbeiter,
    wartetAufAntragsteller: wartet,
    neuDieseWoche: neu,
    genehmigt,
    abgelehnt,
    medianStunden: median,
    genehmigungsQuote:
      entschiedeneAnzahl === 0 ? null : Math.round((genehmigt / entschiedeneAnzahl) * 100),
    entbannungOffen,
  };
}
