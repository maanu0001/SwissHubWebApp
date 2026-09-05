import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@swisshub/database';
import type { AutomationJob, AutomationJobKind } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const logger = createLogger('automation:scheduler');

/**
 * Der persistente Zeitplaner.
 *
 * Zeitgesteuerte Trigger, wartende Läufe und Wiederholungen laufen alle über
 * dieselbe Tabelle. Ein `setTimeout` käme für keines davon infrage: es
 * überlebt keinen Neustart, und ein Wait über sieben Tage wäre nach dem
 * ersten Deployment verloren (§9).
 *
 * ## Wie ein Job genau einmal ausgeführt wird
 *
 * Ein Job wird **unter Bedingung** beansprucht:
 *
 *     UPDATE ... WHERE id = ? AND status = 'PENDING'
 *
 * Laufen zwei Instanzen, kommt genau eine durch; die andere ändert null
 * Zeilen und lässt die Finger davon. Dasselbe Verfahren wie bei den
 * Erinnerungen des Kalenders und bei der Verifikation - es ist im Projekt
 * geprüft, und ein zweites hätte niemand geprüft.
 *
 * Zusätzlich trägt jeder Beanspruchende seine Kennung ein. Stirbt ein Prozess
 * mit einem Job in der Hand, findet ihn `holeVerwaisteZurueck()` nach der
 * Pachtfrist wieder - sonst bliebe er für immer beansprucht und nie
 * ausgeführt.
 */

/** Wie lange ein beanspruchter Job als in Arbeit gilt. */
export const PACHT_MS = 5 * 60 * 1000;

/** Kennung dieses Prozesses. Steht am Job, solange er ihn hält. */
export const INSTANZ_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export interface JobEingabe {
  kind: AutomationJobKind;
  guildId: string;
  runAt: Date;
  automationId?: string | null;
  runId?: string | null;
  payload?: Record<string, unknown> | null;
  maxAttempts?: number;
  /**
   * Verhindert doppelte Planung.
   *
   * Beispiel: der Erinnerungs-Trigger eines Events plant seinen Job unter
   * `relativ:<automationId>:<eventId>`. Läuft die Planung zweimal - etwa weil
   * zwei Instanzen denselben Takt haben -, entsteht trotzdem ein Job.
   */
  dedupeKey?: string | null;
}

/**
 * Einen Job einplanen.
 *
 * Gibt `null` zurück, wenn unter demselben Schlüssel bereits einer steht.
 * Das ist kein Fehler, sondern der Normalfall bei einer wiederholten Planung.
 */
export async function planeJob(eingabe: JobEingabe): Promise<AutomationJob | null> {
  try {
    return await prisma.automationJob.create({
      data: {
        kind: eingabe.kind,
        guildId: eingabe.guildId,
        runAt: eingabe.runAt,
        automationId: eingabe.automationId ?? null,
        runId: eingabe.runId ?? null,
        payload: (eingabe.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        maxAttempts: eingabe.maxAttempts ?? 5,
        dedupeKey: eingabe.dedupeKey ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  }
}

/**
 * Fällige Jobs holen und beanspruchen.
 *
 * Zwei Schritte, weil `updateMany` in PostgreSQL nicht sagt, *welche* Zeilen
 * es geändert hat: erst die Kandidaten lesen, dann jeden einzeln unter
 * Bedingung beanspruchen. Wer einen nicht bekommt, überspringt ihn.
 */
export async function beanspruchFaellige(limit = 20, jetzt = new Date()): Promise<AutomationJob[]> {
  const kandidaten = await prisma.automationJob.findMany({
    where: { status: 'PENDING', runAt: { lte: jetzt } },
    orderBy: { runAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const meine: AutomationJob[] = [];
  for (const kandidat of kandidaten) {
    const ergebnis = await prisma.automationJob.updateMany({
      where: { id: kandidat.id, status: 'PENDING' },
      data: {
        status: 'CLAIMED',
        claimedAt: jetzt,
        claimedBy: INSTANZ_ID,
        attempts: { increment: 1 },
      },
    });
    if (ergebnis.count === 0) {
      continue;
    }
    const job = await prisma.automationJob.findUnique({ where: { id: kandidat.id } });
    if (job) {
      meine.push(job);
    }
  }
  return meine;
}

/** Ein Job ist erledigt. */
export async function schliesseJobAb(jobId: string): Promise<void> {
  await prisma.automationJob.updateMany({
    where: { id: jobId },
    data: { status: 'DONE', claimedBy: null },
  });
}

/**
 * Ein Job ist gescheitert.
 *
 * Unter der Versuchsgrenze wird er mit wachsendem Abstand erneut eingeplant;
 * darüber gilt er als endgültig gescheitert und bleibt als `DEAD` liegen -
 * sichtbar im Fehler-Posteingang, statt still zu verschwinden (§26).
 */
export async function meldeJobFehler(
  job: AutomationJob,
  fehler: string,
  jetzt = new Date(),
): Promise<'RETRY' | 'DEAD'> {
  const kurz = fehler.slice(0, 500);
  if (job.attempts >= job.maxAttempts) {
    await prisma.automationJob.updateMany({
      where: { id: job.id },
      data: { status: 'DEAD', lastError: kurz, claimedBy: null },
    });
    logger.warn('Job endgültig gescheitert', { jobId: job.id, kind: job.kind, versuche: job.attempts });
    return 'DEAD';
  }

  await prisma.automationJob.updateMany({
    where: { id: job.id },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimedBy: null,
      lastError: kurz,
      runAt: naechsterVersuch(job.attempts, jetzt),
    },
  });
  return 'RETRY';
}

/**
 * Wann der nächste Versuch ansteht.
 *
 * Verdoppelnd, mit Obergrenze und einem Zufallsanteil. Der Zufall verhindert,
 * dass hundert gleichzeitig gescheiterte Jobs auch gleichzeitig
 * wiederkommen - sonst träfe dieselbe Störung sie wieder alle zusammen.
 */
export function naechsterVersuch(versuche: number, jetzt = new Date()): Date {
  const basis = Math.min(30 * 2 ** Math.max(0, versuche - 1), 900);
  const streuung = Math.floor(Math.random() * Math.min(basis, 30));
  return new Date(jetzt.getTime() + (basis + streuung) * 1000);
}

/**
 * Jobs zurückholen, deren Halter nicht mehr antwortet.
 *
 * Ohne das bliebe ein Job für immer beansprucht, wenn der Prozess ihn mit in
 * den Absturz nimmt. Die Pachtfrist ist grosszügig: lieber einen Job spät
 * wiederholen als einen doppelt ausführen, während der erste noch läuft.
 */
export async function holeVerwaisteZurueck(jetzt = new Date()): Promise<number> {
  const grenze = new Date(jetzt.getTime() - PACHT_MS);
  const ergebnis = await prisma.automationJob.updateMany({
    where: { status: 'CLAIMED', claimedAt: { lt: grenze } },
    data: { status: 'PENDING', claimedAt: null, claimedBy: null },
  });
  if (ergebnis.count > 0) {
    logger.warn('Verwaiste Jobs zurückgeholt', { anzahl: ergebnis.count });
  }
  return ergebnis.count;
}

/** Alle offenen Jobs einer Automation entfernen - beim Abschalten oder Löschen. */
export async function verwerfeJobs(automationId: string): Promise<number> {
  const ergebnis = await prisma.automationJob.deleteMany({
    where: { automationId, status: { in: ['PENDING', 'CLAIMED'] } },
  });
  return ergebnis.count;
}

/** Die offenen Jobs eines Laufs - beim Abbruch. */
export async function verwerfeJobsDesLaufs(runId: string): Promise<number> {
  const ergebnis = await prisma.automationJob.deleteMany({
    where: { runId, status: { in: ['PENDING', 'CLAIMED'] } },
  });
  return ergebnis.count;
}

export interface SchedulerGesundheit {
  offen: number;
  beansprucht: number;
  tot: number;
  /** Wie weit der älteste fällige Job überfällig ist, in Sekunden. */
  aeltesteVerzoegerungSekunden: number | null;
}

/**
 * Zustand des Zeitplaners (§39).
 *
 * Keine geheimen Angaben - Zahlen und eine Verzögerung. Die Verzögerung ist
 * die aussagekräftigste: steht sie bei Stunden, läuft der Takt nicht mehr,
 * und das sieht man an keiner anderen Zahl.
 */
export async function schedulerGesundheit(jetzt = new Date()): Promise<SchedulerGesundheit> {
  const [offen, beansprucht, tot, aeltester] = await Promise.all([
    prisma.automationJob.count({ where: { status: 'PENDING' } }),
    prisma.automationJob.count({ where: { status: 'CLAIMED' } }),
    prisma.automationJob.count({ where: { status: 'DEAD' } }),
    prisma.automationJob.findFirst({
      where: { status: 'PENDING', runAt: { lte: jetzt } },
      orderBy: { runAt: 'asc' },
      select: { runAt: true },
    }),
  ]);

  return {
    offen,
    beansprucht,
    tot,
    aeltesteVerzoegerungSekunden: aeltester
      ? Math.max(0, Math.round((jetzt.getTime() - aeltester.runAt.getTime()) / 1000))
      : null,
  };
}

/** Erledigte und tote Jobs nach einer Frist entfernen. */
export async function raeumeJobs(tage: number, jetzt = new Date()): Promise<number> {
  const grenze = new Date(jetzt.getTime() - tage * 24 * 3600_000);
  const ergebnis = await prisma.automationJob.deleteMany({
    where: { status: { in: ['DONE', 'DEAD'] }, updatedAt: { lt: grenze } },
  });
  return ergebnis.count;
}
