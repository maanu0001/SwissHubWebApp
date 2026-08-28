import { prisma } from '@swisshub/database';
import type { Automation, AutomationJob } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
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
 * Das Ereignis wird **vor** dem Starten beansprucht. Andersherum liefe es bei
 * zwei Instanzen doppelt an; so kommt genau eine durch, und die andere sieht
 * eine bereits gesetzte Marke. Dass ein Absturz zwischen Anspruch und Start
 * ein Ereignis verlieren könnte, fangen die Läufe selbst über ihren
 * Idempotenzschlüssel ab - ein erneut zugestelltes Ereignis erzeugt keinen
 * zweiten Lauf (§14).
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
    const meins = await beanspruche(ereignis.eventId, jetzt);
    if (!meins) {
      continue;
    }

    let passende: Automation[];
    try {
      passende = await findePassende(ereignis, gateway, jetzt);
    } catch (error) {
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
export async function planeNaechsten(
  automation: Automation,
  von = new Date(),
): Promise<Date | null> {
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
  const zeitTypen = [...new Set(
    // Nur Trigger, die überhaupt einen Zeitpunkt kennen.
    (await prisma.automation.findMany({
      where: { enabled: true, archivedAt: null },
      select: { triggerType: true },
      distinct: ['triggerType'],
    }))
      .map((zeile) => zeile.triggerType)
      .filter((typ) => Boolean(getTrigger(typ)?.nextRunAt)),
  )];

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

function beschreibe(error: unknown): string {
  const userMessage = (error as { userMessage?: string })?.userMessage;
  if (typeof userMessage === 'string' && userMessage !== '') {
    return userMessage;
  }
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? `Fehler (${code})` : 'Unbekannter Fehler';
}
