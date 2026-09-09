import { prisma } from '@swisshub/database';
import type { Automation, AutomationJob } from '@swisshub/database';
import {
  DISCORD_ERROR_CODES,
  DiscordApiError,
  discord as defaultDiscord,
  type DiscordGateway,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { beanspruche, holeUnverarbeitete } from './bus';
import { LIMITS, type EventEnvelope } from './contract';
import type { AutomationContext } from './context';
import { starte, setzeFort, type StartEingabe } from './executor';
import { getTrigger } from './registry';
import { beanspruchFaellige, meldeJobFehler, planeJob, schliesseJobAb } from './scheduler';

const logger = createLogger('automation:dispatcher');

/**
 * Der Verteiler.
 *
 * Er ist die Brücke zwischen «etwas ist geschehen» und «etwas geschieht
 * daraufhin». Drei Takte, die der Bot regelmässig anstösst:
 *
 * - `verteileEreignisse()` - offene Ereignisse an passende Automationen
 * - `verarbeiteJobs()`     - fällige Wecker: Fortsetzungen, Zeitpläne, Wiederholungen
 * - `planeZeitTrigger()`   - kommende Fälligkeiten zeitgesteuerter Automationen
 *
 * Alle drei sind darauf ausgelegt, mehrfach und gleichzeitig zu laufen: Wer
 * eine Zeile nicht beansprucht bekommt, lässt sie liegen. Ein zweiter
 * Bot-Prozess verdoppelt daher keine Wirkung (§13).
 */

export interface VerteilErgebnis {
  ereignisse: number;
  laeufe: number;
  uebersprungen: number;
}

function matchKontext(
  ereignis: EventEnvelope,
  automationId: string,
  gateway: DiscordGateway,
  jetzt: Date,
): AutomationContext {
  return {
    runId: '',
    automationId,
    guildId: ereignis.guildId,
    correlationId: ereignis.correlationId,
    depth: ereignis.depth,
    dryRun: false,
    gateway,
    event: {
      id: ereignis.eventId,
      type: ereignis.type,
      actorId: ereignis.actorId,
      subjectId: ereignis.subjectId,
      entityId: ereignis.entityId,
      occurredAt: ereignis.occurredAt,
    },
    payload: ereignis.payload as Record<string, unknown>,
    steps: {},
    now: jetzt,
    emitted: 0,
  };
}

/**
 * Welche Automationen dieses Ereignis angeht.
 *
 * Vorgefiltert wird in der Datenbank (Gilde, eingeschaltet, nicht archiviert),
 * feingefiltert vom Trigger selbst. Der Kern weiss dadurch nicht, was ein
 * Ereignis-Trigger genau vergleicht - und muss es nicht wissen.
 *
 * **Die Gilde ist Teil der Abfrage, nicht der Nachprüfung.** Eine Automation
 * darf nie auf ein Ereignis einer anderen Gilde reagieren; das ist keine
 * Feinheit des Triggers, sondern die Grundregel des ganzen Projekts.
 */
export async function findePassende(
  ereignis: EventEnvelope,
  gateway: DiscordGateway,
  jetzt = new Date(),
): Promise<Automation[]> {
  const kandidaten = await prisma.automation.findMany({
    where: { guildId: ereignis.guildId, enabled: true, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });

  const treffer: Automation[] = [];
  for (const automation of kandidaten) {
    const trigger = getTrigger(automation.triggerType);
    if (!trigger?.matches) {
      // Zeitgesteuerte Trigger haben kein `matches` - sie kommen über den
      // Zeitplaner, nicht über den Ereignisbus.
      continue;
    }
    try {
      const passt = trigger.matches(
        automation.triggerConfig,
        matchKontext(ereignis, automation.id, gateway, jetzt),
      );
      if (passt) {
        treffer.push(automation);
      }
    } catch (error) {
      // Ein Trigger, der bei der Prüfung stolpert, darf nicht die übrigen
      // Automationen mitreissen.
      logger.warn('Trigger konnte nicht geprüft werden', {
        automationId: automation.id,
        triggerType: automation.triggerType,
        error,
      });
    }
  }
  return treffer;
}

/**
 * Offene Ereignisse verteilen.
 *
 * Das Ereignis wird **nach** dem Starten beansprucht, und das ist die
 * wichtigere Reihenfolge von beiden.
 *
 * Umgekehrt gedacht: erst beanspruchen, dann starten - dann verliert ein
 * Absturz zwischen den beiden Schritten das Ereignis endgültig. Die Marke
 * stünde, die Läufe gäbe es nie, und im Verlauf stünde nichts, das darauf
 * hinwiese. Eine Willkommensnachricht bliebe schlicht aus.
 *
 * So herum kann derselbe Anlass höchstens doppelt *betrachtet* werden - und
 * genau dagegen ist der Idempotenzschlüssel da: dasselbe Ereignis erzeugt für
 * dieselbe Automation genau einen Lauf, ob es nun zweimal zugestellt wird oder
 * zwei Instanzen es gleichzeitig sehen (§14). Doppelte Arbeit statt verlorener
 * Wirkung - und die doppelte Arbeit bleibt folgenlos.
 */
export async function verteileEreignisse(
  optionen: { limit?: number; gateway?: DiscordGateway } = {},
): Promise<VerteilErgebnis> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const jetzt = new Date();
  const offene = await holeUnverarbeitete(optionen.limit ?? 50);

  let laeufe = 0;
  let uebersprungen = 0;

  for (const ereignis of offene) {
    let passende: Automation[];
    try {
      passende = await findePassende(ereignis, gateway, jetzt);
    } catch (error) {
      // Nicht beansprucht: der nächste Durchgang versucht es erneut. Ein
      // Ereignis, das wegen eines vorübergehenden Fehlers unverteilt bleibt,
      // soll nicht als erledigt gelten.
      logger.error('Passende Automationen konnten nicht ermittelt werden', {
        eventId: ereignis.eventId,
        type: ereignis.type,
        error,
      });
      continue;
    }

    if (passende.length > LIMITS.maxRunsPerDispatch) {
      // Ein Ereignis, das fünfzig Automationen auslöst, ist fast sicher ein
      // Versehen. Gekappt und protokolliert, statt den Bot zu belegen.
      logger.error('Zu viele Automationen für ein Ereignis - gekappt', {
        eventId: ereignis.eventId,
        type: ereignis.type,
        anzahl: passende.length,
      });
      passende = passende.slice(0, LIMITS.maxRunsPerDispatch);
    }

    for (const automation of passende) {
      const ergebnis = await starteSicher({
        automation,
        trigger: 'event',
        guildId: ereignis.guildId,
        gateway,
        event: {
          id: ereignis.eventId,
          type: ereignis.type,
          actorId: ereignis.actorId,
          subjectId: ereignis.subjectId,
          entityId: ereignis.entityId,
          payload: ereignis.payload as Record<string, unknown>,
          correlationId: ereignis.correlationId,
          depth: ereignis.depth,
          occurredAt: ereignis.occurredAt,
        },
      });
      if (ergebnis?.runId) {
        laeufe += 1;
      } else {
        uebersprungen += 1;
      }
    }

    // Erst jetzt: die Läufe stehen in der Datenbank.
    await beanspruche(ereignis.eventId, jetzt);
  }

  return { ereignisse: offene.length, laeufe, uebersprungen };
}

/**
 * Einen Lauf starten, ohne den Takt zu gefährden.
 *
 * Ein einzelner gescheiterter Lauf darf nicht dazu führen, dass die übrigen
 * Ereignisse liegen bleiben - dann bliebe nach einem Fehler alles stehen.
 */
async function starteSicher(eingabe: StartEingabe): Promise<{ runId: string | null } | null> {
  try {
    return await starte(eingabe);
  } catch (error) {
    logger.error('Lauf konnte nicht gestartet werden', {
      automationId: eingabe.automation.id,
      trigger: eingabe.trigger,
      error,
    });
    return null;
  }
}

// --- Jobs -------------------------------------------------------------------

export interface JobErgebnis {
  bearbeitet: number;
  gescheitert: number;
}

/**
 * Fällige Jobs abarbeiten.
 *
 * Drei Arten, ein Takt. Was scheitert, geht über `meldeJobFehler` in die
 * Wiederholung oder - nach der letzten - in den Fehler-Posteingang; nichts
 * verschwindet still (§26).
 */
export async function verarbeiteJobs(
  optionen: { limit?: number; gateway?: DiscordGateway } = {},
): Promise<JobErgebnis> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const jobs = await beanspruchFaellige(optionen.limit ?? 20);

  let bearbeitet = 0;
  let gescheitert = 0;

  for (const job of jobs) {
    try {
      await fuehreJobAus(job, gateway);
      await schliesseJobAb(job.id);
      bearbeitet += 1;
    } catch (error) {
      gescheitert += 1;
      const ausgang = await meldeJobFehler(job, beschreibe(error));
      logger.warn('Job gescheitert', { jobId: job.id, kind: job.kind, ausgang });
    }
  }

  return { bearbeitet, gescheitert };
}

async function fuehreJobAus(job: AutomationJob, gateway: DiscordGateway): Promise<void> {
  if (job.kind === 'DELETE_MESSAGE') {
    await loescheNachricht(job, gateway);
    return;
  }

  if (job.kind === 'RESUME') {
    if (!job.runId) {
      return;
    }
    await setzeFort(job.runId, { gateway });
    return;
  }

  if (job.kind === 'SCHEDULE') {
    if (!job.automationId) {
      return;
    }
    const automation = await prisma.automation.findFirst({
      where: { id: job.automationId, enabled: true, archivedAt: null },
    });
    if (!automation) {
      // Zwischenzeitlich abgeschaltet oder gelöscht: der Wecker verfällt.
      return;
    }
    await starte({ automation, trigger: 'schedule', guildId: automation.guildId, gateway });
    // Den nächsten Termin gleich mitplanen - sonst liefe eine Automation
    // genau einmal und nie wieder.
    await planeNaechsten(automation);
    return;
  }

  // RETRY: ein eingereihter Lauf, der wegen Gleichzeitigkeit warten musste.
  if (!job.automationId) {
    return;
  }
  const automation = await prisma.automation.findFirst({
    where: { id: job.automationId, enabled: true, archivedAt: null },
  });
  if (!automation) {
    return;
  }

  const payload = (job.payload ?? {}) as { eventId?: string | null; actorId?: string | null };
  if (!payload.eventId) {
    await starte({
      automation,
      trigger: 'retry',
      guildId: automation.guildId,
      gateway,
      actorId: payload.actorId ?? null,
    });
    return;
  }

  const ereignis = await prisma.automationEvent.findUnique({ where: { id: payload.eventId } });
  if (!ereignis) {
    return;
  }
  await starte({
    automation,
    trigger: 'event',
    guildId: ereignis.guildId,
    gateway,
    event: {
      id: ereignis.id,
      type: ereignis.type,
      actorId: ereignis.actorId,
      subjectId: ereignis.subjectId,
      entityId: ereignis.entityId,
      payload: (ereignis.payload ?? {}) as Record<string, unknown>,
      correlationId: ereignis.correlationId,
      depth: ereignis.depth,
      occurredAt: ereignis.occurredAt,
    },
  });
}

// --- Zeitgesteuerte Trigger -------------------------------------------------

/**
 * Den nächsten Termin einer zeitgesteuerten Automation einplanen.
 *
 * Der Zeitplaner rechnet nicht selbst - er fragt den Trigger. Ob dahinter ein
 * Wochentag, ein Datum oder eine Wiederholung steht, ist Sache des Triggers;
 * hier zählt nur der Zeitpunkt.
 *
 * Der Doppelschlüssel enthält den Zeitpunkt: derselbe Termin lässt sich
 * dadurch nicht zweimal einplanen, auch wenn zwei Instanzen gleichzeitig
 * planen.
 */
export async function planeNaechsten(automation: Automation, von = new Date()): Promise<Date | null> {
  const trigger = getTrigger(automation.triggerType);
  if (!trigger?.nextRunAt) {
    return null;
  }

  let faellig: Date | null = null;
  try {
    faellig = trigger.nextRunAt(automation.triggerConfig, von);
  } catch (error) {
    logger.warn('Nächster Termin konnte nicht berechnet werden', {
      automationId: automation.id,
      triggerType: automation.triggerType,
      error,
    });
    return null;
  }
  if (!faellig) {
    return null;
  }

  await planeJob({
    kind: 'SCHEDULE',
    guildId: automation.guildId,
    automationId: automation.id,
    runAt: faellig,
    dedupeKey: `schedule:${automation.id}:${automation.version}:${faellig.toISOString()}`,
  });
  return faellig;
}

/**
 * Für alle eingeschalteten Zeit-Automationen den nächsten Termin sichern.
 *
 * Läuft regelmässig, damit eine Automation auch dann wieder ins Rollen kommt,
 * wenn ihr Wecker einmal verloren ging - etwa weil der Prozess zwischen
 * Ausführung und Neuplanung endete. Der Doppelschlüssel sorgt dafür, dass ein
 * bereits geplanter Termin nicht ein zweites Mal entsteht.
 */
export async function planeZeitTrigger(von = new Date()): Promise<number> {
  const zeitTypen = [
    ...new Set(
      // Nur Trigger, die überhaupt einen Zeitpunkt kennen.
      (
        await prisma.automation.findMany({
          where: { enabled: true, archivedAt: null },
          select: { triggerType: true },
          distinct: ['triggerType'],
        })
      )
        .map((zeile) => zeile.triggerType)
        .filter((typ) => Boolean(getTrigger(typ)?.nextRunAt)),
    ),
  ];

  if (zeitTypen.length === 0) {
    return 0;
  }

  const automationen = await prisma.automation.findMany({
    where: { enabled: true, archivedAt: null, triggerType: { in: zeitTypen } },
    take: 500,
  });

  let geplant = 0;
  for (const automation of automationen) {
    const offen = await prisma.automationJob.count({
      where: {
        automationId: automation.id,
        kind: 'SCHEDULE',
        status: { in: ['PENDING', 'CLAIMED'] },
      },
    });
    if (offen > 0) {
      continue;
    }
    if (await planeNaechsten(automation, von)) {
      geplant += 1;
    }
  }
  return geplant;
}

/**
 * Der Text, der am gescheiterten Auftrag stehen bleibt.
 *
 * Er stand bisher nur fuer `AppError` zur Verfuegung - alles andere wurde zu
 * «Unbekannter Fehler», und damit auch jeder Discord-Fehler. Im Dashboard
 * stand dann an einem Auftrag, der wegen eines fehlenden Rechts scheiterte,
 * nichts ausser dass er gescheitert ist. Genau die behebbaren Faelle waren
 * die, ueber die man am wenigsten erfuhr.
 *
 * Reihenfolge nach Aussagekraft: die gepflegte Meldung zuerst, dann der
 * Discord-Fehler mit Status und Code, dann die gewoehnliche Fehlermeldung.
 * Gekuerzt, weil der Text in eine Spalte und auf eine Seite passt.
 */
function beschreibe(error: unknown): string {
  const userMessage = (error as { userMessage?: string })?.userMessage;
  if (typeof userMessage === 'string' && userMessage !== '') {
    return userMessage.slice(0, 300);
  }
  if (error instanceof DiscordApiError) {
    return `Discord ${error.status}${error.discordCode ? ` (${error.discordCode})` : ''}: ${error.message}`.slice(
      0,
      300,
    );
  }
  if (error instanceof Error && error.message !== '') {
    return error.message.slice(0, 300);
  }
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? `Fehler (${code})` : 'Unbekannter Fehler';
}

/**
 * Eine Nachricht loeschen, deren Frist abgelaufen ist.
 *
 * Der Auftrag steht seit dem Senden in der Job-Tabelle. Das ist der ganze
 * Grund fuer diesen Umweg: ein `setTimeout` ueber zwoelf Stunden waere nach
 * dem naechsten Deployment weg, und die Nachricht bliebe stehen - ohne dass
 * irgendwo etwas fehlte, das jemandem auffiele.
 *
 * **Eine bereits verschwundene Nachricht ist ein Erfolg, kein Fehler.**
 * Jemand kann sie von Hand geloescht haben, oder der ganze Kanal ist weg. Das
 * Ziel des Auftrags - diese Nachricht steht nicht mehr da - ist dann
 * erreicht. Es als Fehler zu werten hiesse, dreimal zu wiederholen, was schon
 * erledigt ist, und den Auftrag anschliessend als gescheitert zu fuehren.
 *
 * Ein fehlendes Recht dagegen wird geworfen: es ist eine Einstellung, die
 * jemand beheben kann, und `meldeJobFehler` haelt sie im Auftrag fest.
 */
async function loescheNachricht(job: AutomationJob, gateway: DiscordGateway): Promise<void> {
  const payload = (job.payload ?? {}) as { channelId?: unknown; messageId?: unknown };
  const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
  const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;

  if (!channelId || !messageId) {
    logger.warn('Löschauftrag ohne Nachricht', { jobId: job.id });
    return;
  }

  try {
    await gateway.channels.delete(channelId, messageId, 'Automation: Nachricht mit Frist');
    logger.debug('Nachricht nach Frist gelöscht', { channelId, messageId });
  } catch (error) {
    if (istSchonWeg(error)) {
      logger.debug('Nachricht war bereits weg', { channelId, messageId });
      return;
    }
    throw error;
  }
}

/** Nachricht oder Kanal existieren nicht mehr - das Ziel ist damit erreicht. */
function istSchonWeg(error: unknown): boolean {
  if (!(error instanceof DiscordApiError)) {
    return false;
  }
  return (
    error.status === 404 ||
    error.discordCode === DISCORD_ERROR_CODES.UNKNOWN_MESSAGE ||
    error.discordCode === DISCORD_ERROR_CODES.UNKNOWN_CHANNEL
  );
}
