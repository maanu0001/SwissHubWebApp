import { createHash } from 'node:crypto';
import { Prisma, prisma } from '@swisshub/database';
import type { Automation, AutomationRun } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { LIMITS } from './contract';
import type { AutomationContext } from './context';
import { renderConfig } from './context';
import { werteBaumAus, type ConditionNode } from './conditions';
import { getAction } from './registry';
import { flache, einstieg, stepsSchema, type FlacherSchritt, type StepNode } from './steps';
import { planeJob } from './scheduler';
import { loeseSchluesselAuf, pruefeGleichzeitigkeit, pruefeKette, pruefeRate } from './limits';

const logger = createLogger('automation:executor');

/**
 * Der Ausführer.
 *
 * Er arbeitet eine flache Schrittliste ab und merkt sich seine Stellung in
 * der Datenbank. Das ist der Grund, weshalb ein Lauf einen Neustart, eine
 * Wartezeit von sieben Tagen und eine menschliche Freigabe übersteht: sein
 * ganzer Zustand sind eine Zahl (`cursor`) und ein Kontext (`context`) in
 * einer Zeile - nichts davon liegt im Arbeitsspeicher.
 *
 * ## Was hier nicht passiert
 *
 * Keine Auswertung von Zeichenketten als Code, keine Shell, keine freie
 * Datenbankabfrage. Ein Schritt ruft eine angemeldete Aktion auf, und die
 * prüft ihre Eingabe selbst (§44).
 */

export interface StartEingabe {
  automation: Automation;
  /** Woher der Lauf kommt. */
  trigger: 'event' | 'schedule' | 'manual' | 'retry';
  guildId: string;
  event?: {
    id: string;
    type: string;
    actorId: string | null;
    subjectId: string | null;
    entityId: string | null;
    payload: Record<string, unknown>;
    correlationId: string;
    depth: number;
    occurredAt: Date;
  };
  /** Probelauf: Bedingungen echt prüfen, Aktionen nur beschreiben. */
  dryRun?: boolean;
  /** Wer ihn von Hand ausgelöst hat. */
  actorId?: string | null;
  gateway?: DiscordGateway;
}

export interface LaufErgebnis {
  runId: string | null;
  status: AutomationRun['status'];
  /** `false`, wenn derselbe Anlass bereits einen Lauf erzeugt hat. */
  neu: boolean;
  /** Die Bedingungsauswertung - für den Probelauf. */
  bedingungen?: Array<{ label: string; erfuellt: boolean; fehler?: string }>;
  schritte?: Array<{ index: number; label: string; status: string; detail?: string }>;
  fehler?: string;
}

/**
 * Der Schlüssel, unter dem ein Anlass genau einen Lauf erzeugt (§14).
 *
 * Discord liefert Ereignisse gelegentlich doppelt, ein Verteiler kann nach
 * einem Absturz dasselbe Ereignis erneut sehen, und ein Wiederholungslauf
 * greift dasselbe auf. Der Schlüssel ist eindeutig indiziert - der zweite
 * Versuch stösst auf die Sperre und weiss damit, dass er zu spät ist.
 *
 * Ein Probelauf bekommt einen eigenen, immer neuen Schlüssel: er soll sich
 * beliebig oft wiederholen lassen.
 */
export function idempotenzSchluessel(eingabe: StartEingabe, version: number): string {
  if (eingabe.dryRun) {
    return `dry:${eingabe.automation.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }
  const roh =
    eingabe.trigger === 'event' && eingabe.event
      ? `event:${eingabe.automation.id}:${version}:${eingabe.event.id}`
      : `${eingabe.trigger}:${eingabe.automation.id}:${version}:${Date.now()}`;
  return createHash('sha256').update(roh).digest('hex').slice(0, 48);
}

function baueKontext(
  eingabe: StartEingabe,
  runId: string,
  gateway: DiscordGateway,
  jetzt: Date,
): AutomationContext {
  return {
    runId,
    automationId: eingabe.automation.id,
    guildId: eingabe.guildId,
    correlationId: eingabe.event?.correlationId ?? runId,
    depth: eingabe.event?.depth ?? 0,
    dryRun: eingabe.dryRun ?? false,
    gateway,
    event: {
      id: eingabe.event?.id ?? null,
      type: eingabe.event?.type ?? null,
      actorId: eingabe.event?.actorId ?? eingabe.actorId ?? null,
      subjectId: eingabe.event?.subjectId ?? null,
      entityId: eingabe.event?.entityId ?? null,
      occurredAt: eingabe.event?.occurredAt ?? jetzt,
    },
    payload: eingabe.event?.payload ?? {},
    steps: {},
    now: jetzt,
    emitted: 0,
  };
}

/**
 * Einen Lauf beginnen.
 *
 * Reihenfolge mit Bedacht: erst die Grenzen (Tiefe, Rate, Gleichzeitigkeit),
 * dann die Zeile, dann die Bedingungen, dann die Schritte. Wer erst handelt
 * und danach prüft, hat im Fehlerfall bereits gehandelt.
 */
export async function starte(eingabe: StartEingabe): Promise<LaufErgebnis> {
  const jetzt = new Date();
  const gateway = eingabe.gateway ?? defaultDiscord;
  const automation = eingabe.automation;
  const tiefe = eingabe.event?.depth ?? 0;

  // --- Schleifenschutz (§17) ---------------------------------------------
  if (!eingabe.dryRun) {
    const kette = await pruefeKette(automation.id, eingabe.event?.correlationId, tiefe);
    if (!kette.erlaubt) {
      return {
        runId: null,
        status: 'SKIPPED',
        neu: false,
        ...(kette.grund ? { fehler: kette.grund } : {}),
      };
    }
  } else if (tiefe > LIMITS.maxDepth) {
    return { runId: null, status: 'SKIPPED', neu: false, fehler: 'Die Ereigniskette ist zu tief.' };
  }

  // --- Rate (§16) ---------------------------------------------------------
  if (!eingabe.dryRun) {
    const erlaubt = await pruefeRate(automation.id, automation.maxRunsPerMinute, jetzt);
    if (!erlaubt) {
      return {
        runId: null,
        status: 'SKIPPED',
        neu: false,
        fehler: 'Zu viele Läufe in kurzer Zeit - dieser wurde übersprungen.',
      };
    }
  }

  // --- Gleichzeitigkeit (§18) --------------------------------------------
  //
  // Der Schlüssel wird vor der Zeile aufgelöst: er entscheidet mit, ob es
  // überhaupt eine gibt. Dafür genügt ein vorläufiger Kontext - `render`
  // greift nur auf Nutzdaten, Ereignis und Zeit zu, nicht auf den Lauf.
  const vorlaeufig = baueKontext(eingabe, '', gateway, jetzt);
  const schluessel = loeseSchluesselAuf(automation.concurrencyKey, vorlaeufig);
  const entscheid = await pruefeGleichzeitigkeit(automation, schluessel, {
    dryRun: eingabe.dryRun ?? false,
  });

  if (entscheid === 'SKIP') {
    return {
      runId: null,
      status: 'SKIPPED',
      neu: false,
      fehler: 'Es läuft bereits ein Durchgang dieser Automation.',
    };
  }

  if (entscheid === 'QUEUE') {
    // Nicht verwerfen, sondern verschieben: der Zeitplaner nimmt ihn später
    // wieder auf, wenn der Vorgänger fertig ist (§18).
    await planeJob({
      kind: 'RETRY',
      guildId: eingabe.guildId,
      automationId: automation.id,
      runAt: new Date(jetzt.getTime() + 30_000),
      payload: {
        trigger: eingabe.trigger,
        eventId: eingabe.event?.id ?? null,
        actorId: eingabe.actorId ?? null,
      },
      dedupeKey: eingabe.event?.id
        ? `queue:${automation.id}:${eingabe.event.id}`
        : `queue:${automation.id}:${jetzt.getTime()}`,
    });
    return {
      runId: null,
      status: 'SKIPPED',
      neu: false,
      fehler: 'Ein Durchgang läuft noch - dieser wurde eingereiht.',
    };
  }

  const version = automation.version;
  const idempotenz = idempotenzSchluessel(eingabe, version);
  const versionsZeile = await prisma.automationVersion.findUnique({
    where: { automationId_version: { automationId: automation.id, version } },
    select: { id: true, snapshot: true },
  });

  const schritteRoh = (versionsZeile?.snapshot as { steps?: unknown })?.steps ?? automation.steps;
  const bedingungenRoh =
    (versionsZeile?.snapshot as { conditions?: unknown })?.conditions ?? automation.conditions;

  const geprueft = stepsSchema.safeParse(schritteRoh);
  if (!geprueft.success) {
    logger.error('Schrittfolge ist ungültig', { automationId: automation.id });
    return { runId: null, status: 'FAILED', neu: true, fehler: 'Die Schrittfolge ist ungültig.' };
  }
  const schritte = geprueft.data;

  // --- Die Zeile: hier entscheidet sich die Doppelausführung -------------
  let lauf: AutomationRun;
  try {
    lauf = await prisma.automationRun.create({
      data: {
        automationId: automation.id,
        versionId: versionsZeile?.id ?? null,
        version,
        guildId: eingabe.guildId,
        status: 'RUNNING',
        trigger: eingabe.trigger,
        eventId: eingabe.event?.id ?? null,
        eventType: eingabe.event?.type ?? null,
        correlationId: eingabe.event?.correlationId ?? idempotenz,
        depth: tiefe,
        idempotencyKey: idempotenz,
        concurrencyKey: schluessel,
        dryRun: eingabe.dryRun ?? false,
        context: (eingabe.event?.payload ?? {}) as Prisma.InputJsonValue,
        startedAt: jetzt,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Genau der Fall, für den der Schlüssel da ist: derselbe Anlass, ein
      // zweites Mal. Kein Fehler - es ist bereits erledigt.
      return { runId: null, status: 'SKIPPED', neu: false, fehler: 'Bereits ausgeführt.' };
    }
    throw error;
  }

  const context = baueKontext(eingabe, lauf.id, gateway, jetzt);

  // --- Bedingungen --------------------------------------------------------
  const auswertung = await werteBaumAus((bedingungenRoh ?? null) as ConditionNode | null, context);
  const bedingungen = auswertung.schritte.map((schritt) => ({
    label: schritt.label,
    erfuellt: schritt.erfuellt,
    ...(schritt.fehler ? { fehler: schritt.fehler } : {}),
  }));

  if (!auswertung.erfuellt) {
    await beendeLauf(lauf.id, 'SKIPPED', jetzt, null);
    return { runId: lauf.id, status: 'SKIPPED', neu: true, bedingungen };
  }

  const ergebnis = await arbeiteAb(lauf, schritte, context, jetzt, einstieg(flache(schritte), schritte));
  return { ...ergebnis, bedingungen };
}

/**
 * Die Schritte ab der gemerkten Stellung abarbeiten.
 *
 * Wird beim Start aufgerufen und erneut, wenn ein wartender Lauf fortgesetzt
 * wird. Beide Male dieselbe Schleife - ein Lauf nach sieben Tagen Wartezeit
 * ist kein Sonderfall, sondern derselbe Fall an einer anderen Stellung.
 */
async function arbeiteAb(
  lauf: AutomationRun,
  schritte: StepNode[],
  context: AutomationContext,
  jetzt: Date,
  /**
   * Wo begonnen wird.
   *
   * Ausdrücklich übergeben und nicht aus `cursor` erraten: die Stellung `0`
   * ist eine gültige Stellung. Wer sie als «noch nicht begonnen» deutet,
   * schickt einen fortgesetzten Lauf zurück an den Anfang - und ein Lauf, der
   * mit einer Wartezeit beginnt, wartet dann für immer.
   */
  start: number | null,
): Promise<LaufErgebnis> {
  const flach = flache(schritte);
  const nachIndex = new Map(flach.map((eintrag) => [eintrag.index, eintrag]));
  const bericht: Array<{ index: number; label: string; status: string; detail?: string }> = [];

  let zeiger: number | null = start;

  // Harte Obergrenze gegen eine Folge, die sich selbst nicht beendet.
  let besuchte = 0;

  while (zeiger !== null) {
    besuchte += 1;
    if (besuchte > LIMITS.maxSteps * 2) {
      await beendeLauf(lauf.id, 'FAILED', jetzt, 'Zu viele Schritte in einem Durchgang.');
      return { runId: lauf.id, status: 'FAILED', neu: true, schritte: bericht };
    }

    const schritt: FlacherSchritt | undefined = nachIndex.get(zeiger);
    if (!schritt) {
      break;
    }

    // --- Warten ----------------------------------------------------------
    if (schritt.knoten.art === 'warten') {
      const label = schritt.knoten.label ?? `Warten (${schritt.knoten.sekunden} s)`;
      if (context.dryRun) {
        bericht.push({
          index: schritt.index,
          label,
          status: 'SKIPPED',
          detail: 'Im Probelauf übersprungen.',
        });
        zeiger = schritt.weiter;
        continue;
      }

      const weiterBei = schritt.weiter;
      await schreibeSchritt(lauf.id, schritt.index, 'warten', label, 'SUCCESS', {
        detail: `Wartet ${schritt.knoten.sekunden} Sekunden.`,
      });
      await prisma.automationRun.update({
        where: { id: lauf.id },
        data: {
          status: 'WAITING',
          cursor: weiterBei ?? -1,
          context: kontextFuerFortsetzung(context) as Prisma.InputJsonValue,
        },
      });
      // Der Wecker steht in der Datenbank, nicht im Arbeitsspeicher (§9).
      await planeJob({
        kind: 'RESUME',
        guildId: lauf.guildId,
        runId: lauf.id,
        automationId: lauf.automationId,
        runAt: new Date(jetzt.getTime() + schritt.knoten.sekunden * 1000),
        dedupeKey: `resume:${lauf.id}:${schritt.index}`,
      });
      bericht.push({ index: schritt.index, label, status: 'WAITING' });
      return { runId: lauf.id, status: 'WAITING', neu: true, schritte: bericht };
    }

    // --- Verzweigung ------------------------------------------------------
    if (schritt.knoten.art === 'wenn') {
      const label = schritt.knoten.label ?? 'Wenn';
      const teil = await werteBaumAus(schritt.knoten.bedingung, context, `schritt.${schritt.index}`);
      const zweig = teil.erfuellt ? schritt.dann : schritt.sonst;
      await schreibeSchritt(lauf.id, schritt.index, 'wenn', label, 'SUCCESS', {
        detail: teil.erfuellt ? 'Bedingung erfüllt - Dann-Zweig.' : 'Bedingung nicht erfüllt - Sonst-Zweig.',
      });
      bericht.push({
        index: schritt.index,
        label,
        status: 'SUCCESS',
        detail: teil.erfuellt ? 'Dann' : 'Sonst',
      });
      zeiger = zweig && zweig.length > 0 ? zweig[0]! : schritt.weiter;
      continue;
    }

    // --- Aktion -----------------------------------------------------------
    const knoten = schritt.knoten;
    const definition = getAction(knoten.typ);
    const label = knoten.label ?? definition?.label ?? knoten.typ;

    if (!definition) {
      const meldung = `Die Aktion «${knoten.typ}» ist nicht mehr verfügbar.`;
      await schreibeSchritt(lauf.id, schritt.index, knoten.typ, label, 'FAILED', { error: meldung });
      bericht.push({ index: schritt.index, label, status: 'FAILED', detail: meldung });
      if (knoten.beiFehler === 'WEITER') {
        zeiger = schritt.weiter;
        continue;
      }
      await beendeLauf(lauf.id, 'FAILED', jetzt, meldung);
      return { runId: lauf.id, status: 'FAILED', neu: true, schritte: bericht, fehler: meldung };
    }

    // Erst hier werden die Platzhalter aufgelöst - mit dem Kontext, den die
    // vorangegangenen Schritte hinterlassen haben.
    const aufgeloest = renderConfig(knoten.config, context);
    const geprueft = definition.configSchema.safeParse(aufgeloest);
    if (!geprueft.success) {
      const meldung = `Die Konfiguration von «${label}» ist ungültig.`;
      await schreibeSchritt(lauf.id, schritt.index, knoten.typ, label, 'FAILED', { error: meldung });
      bericht.push({ index: schritt.index, label, status: 'FAILED', detail: meldung });
      if (knoten.beiFehler === 'WEITER') {
        zeiger = schritt.weiter;
        continue;
      }
      await beendeLauf(lauf.id, 'FAILED', jetzt, meldung);
      return { runId: lauf.id, status: 'FAILED', neu: true, schritte: bericht, fehler: meldung };
    }

    // --- Probelauf: beschreiben statt handeln (§23) ------------------------
    if (context.dryRun) {
      const beschreibung = definition.preview
        ? await definition.preview(geprueft.data, context).catch(() => label)
        : label;
      bericht.push({ index: schritt.index, label, status: 'DRY_RUN', detail: beschreibung });
      zeiger = schritt.weiter;
      continue;
    }

    // --- Freigabe nötig? (§32) --------------------------------------------
    //
    // Beim zweiten Durchgang - nach dem «Genehmigen» - liegt die Entscheidung
    // bereits vor. Ohne diese Abfrage hielte der Lauf erneut an und wartete
    // auf eine Freigabe, die es längst gibt.
    if (definition.requiresApproval && !(await istFreigegeben(lauf.id, schritt.index))) {
      const beschreibung = definition.preview
        ? await definition.preview(geprueft.data, context).catch(() => label)
        : label;
      await legeFreigabeAn(lauf, schritt.index, label, beschreibung);
      await prisma.automationRun.update({
        where: { id: lauf.id },
        data: {
          status: 'AWAITING_APPROVAL',
          cursor: schritt.index,
          context: kontextFuerFortsetzung(context) as Prisma.InputJsonValue,
        },
      });
      bericht.push({ index: schritt.index, label, status: 'AWAITING_APPROVAL', detail: beschreibung });
      return { runId: lauf.id, status: 'AWAITING_APPROVAL', neu: true, schritte: bericht };
    }

    const ausgang = await fuehreAus(lauf, schritt, definition.id, label, geprueft.data, context, jetzt);
    bericht.push({
      index: schritt.index,
      label,
      status: ausgang.status,
      ...(ausgang.detail ? { detail: ausgang.detail } : {}),
    });

    if (ausgang.status === 'FAILED') {
      if (knoten.beiFehler === 'WEITER') {
        zeiger = schritt.weiter;
        continue;
      }
      await beendeLauf(lauf.id, 'FAILED', jetzt, ausgang.detail ?? 'Schritt gescheitert.');
      return {
        runId: lauf.id,
        status: 'FAILED',
        neu: true,
        schritte: bericht,
        ...(ausgang.detail ? { fehler: ausgang.detail } : {}),
      };
    }

    context.steps[String(schritt.index)] = ausgang.output ?? {};
    zeiger = schritt.weiter;
  }

  const status = context.dryRun ? 'SUCCESS' : 'SUCCESS';
  await beendeLauf(lauf.id, status, jetzt, null);
  return { runId: lauf.id, status, neu: true, schritte: bericht };
}

/**
 * Eine Aktion ausführen, mit Wiederholung.
 *
 * Die Wiederholung geschieht hier und nicht über einen Job: ein Discord-Fehler
 * ist meist nach Sekunden vorbei, und ein Job dafür wäre eine Zeile in der
 * Datenbank für ein Problem, das sich im selben Atemzug lösen lässt. Erst
 * wenn auch der letzte Versuch scheitert, gilt der Schritt als gescheitert.
 */
async function fuehreAus(
  lauf: AutomationRun,
  schritt: FlacherSchritt,
  typ: string,
  label: string,
  config: unknown,
  context: AutomationContext,
  jetzt: Date,
): Promise<{ status: 'SUCCESS' | 'NO_OP' | 'FAILED'; detail?: string; output?: Record<string, unknown> }> {
  const knoten = schritt.knoten as Extract<StepNode, { art: 'aktion' }>;
  const versuche = knoten.retry?.versuche ?? 1;
  const definition = getAction(typ)!;
  const begonnen = Date.now();
  let letzterFehler = 'Unbekannter Fehler.';

  for (let versuch = 1; versuch <= versuche; versuch += 1) {
    try {
      const ergebnis = await definition.execute(config, context);
      await schreibeSchritt(lauf.id, schritt.index, typ, label, ergebnis.status, {
        attempts: versuch,
        ...(ergebnis.detail ? { detail: ergebnis.detail } : {}),
        durationMs: Date.now() - begonnen,
      });
      return {
        status: ergebnis.status,
        ...(ergebnis.detail ? { detail: ergebnis.detail } : {}),
        ...(ergebnis.output ? { output: ergebnis.output } : {}),
      };
    } catch (error) {
      letzterFehler = bereinige(error);
      const nochmal = versuch < versuche && istWiederholbar(error);
      logger.warn('Aktion gescheitert', {
        runId: lauf.id,
        automationId: lauf.automationId,
        schritt: schritt.index,
        typ,
        versuch,
        nochmal,
        grund: letzterFehler,
      });
      if (!nochmal) {
        break;
      }
      const wartenMs = Math.min((knoten.retry?.basisSekunden ?? 30) * 2 ** (versuch - 1), 300) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wartenMs, 10_000)));
    }
  }

  await schreibeSchritt(lauf.id, schritt.index, typ, label, 'FAILED', {
    attempts: versuche,
    error: letzterFehler,
    durationMs: Date.now() - begonnen,
  });
  void jetzt;
  return { status: 'FAILED', detail: letzterFehler };
}

/**
 * Lohnt sich ein zweiter Versuch?
 *
 * Bei einer Ratengrenze oder einem Ausfall der Gegenstelle: ja. Bei einer
 * fehlenden Berechtigung oder einem gelöschten Kanal: nein - das wird beim
 * dritten Mal nicht anders, und jeder Versuch kostet nur (§15).
 */
export function istWiederholbar(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'RATE_LIMITED' || code === 'DISCORD_RATE_LIMITED' || code === 'DISCORD_UNAVAILABLE') {
    return true;
  }
  if (
    code === 'FORBIDDEN' ||
    code === 'VALIDATION_FAILED' ||
    code === 'NOT_FOUND' ||
    code === 'DISCORD_MISSING_PERMISSIONS' ||
    code === 'DISCORD_UNKNOWN_MEMBER' ||
    code === 'DISCORD_UNKNOWN_ROLE' ||
    code === 'POLICY_VIOLATION'
  ) {
    return false;
  }
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  // Unbekannt: einmal wiederholen ist billiger als eine verlorene Wirkung.
  return true;
}

/** Was von einem Fehler in den Verlauf darf. Nie eine Rohantwort, nie ein Geheimnis. */
function bereinige(error: unknown): string {
  const userMessage = (error as { userMessage?: string })?.userMessage;
  if (typeof userMessage === 'string' && userMessage.length > 0) {
    return userMessage.slice(0, 300);
  }
  const code = (error as { code?: string })?.code;
  if (typeof code === 'string') {
    return `Die Aktion ist gescheitert (${code}).`;
  }
  return 'Die Aktion ist gescheitert.';
}

async function schreibeSchritt(
  runId: string,
  index: number,
  stepType: string,
  label: string,
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'NO_OP' | 'SKIPPED' | 'FAILED',
  extra: { attempts?: number; detail?: string; error?: string; durationMs?: number } = {},
): Promise<void> {
  const daten = {
    stepType,
    label,
    status,
    attempts: extra.attempts ?? 1,
    detail: extra.detail?.slice(0, 500) ?? null,
    error: extra.error?.slice(0, 500) ?? null,
    finishedAt: new Date(),
    durationMs: extra.durationMs ?? null,
  };
  await prisma.automationStepRun.upsert({
    where: { runId_index: { runId, index } },
    create: { runId, index, startedAt: new Date(), ...daten },
    update: daten,
  });
}

async function beendeLauf(
  runId: string,
  status: AutomationRun['status'],
  jetzt: Date,
  fehler: string | null,
): Promise<void> {
  const lauf = await prisma.automationRun.findUnique({
    where: { id: runId },
    select: { startedAt: true, automationId: true },
  });
  const dauer = lauf?.startedAt ? Date.now() - lauf.startedAt.getTime() : null;

  await prisma.automationRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: jetzt,
      durationMs: dauer,
      error: fehler?.slice(0, 500) ?? null,
    },
  });

  if (lauf?.automationId) {
    await prisma.automation
      .update({
        where: { id: lauf.automationId },
        data: { lastRunAt: jetzt, lastStatus: status },
      })
      .catch(() => undefined);
  }
}

/**
 * Was von einem Kontext gespeichert wird, damit ein Lauf fortsetzen kann.
 *
 * Nur die Nutzdaten, die Ereigniskopfdaten und die Schrittergebnisse - nicht
 * der Discord-Zugang und nichts, was sich nicht in JSON abbilden lässt.
 */
function kontextFuerFortsetzung(context: AutomationContext): Record<string, unknown> {
  return {
    payload: context.payload,
    event: {
      ...context.event,
      occurredAt: context.event.occurredAt.toISOString(),
    },
    steps: context.steps,
    correlationId: context.correlationId,
    depth: context.depth,
  };
}

/** Liegt für diesen Schritt bereits eine Genehmigung vor? */
async function istFreigegeben(runId: string, stepIndex: number): Promise<boolean> {
  const freigabe = await prisma.automationApproval.findUnique({
    where: { runId_stepIndex: { runId, stepIndex } },
    select: { status: true },
  });
  return freigabe?.status === 'APPROVED';
}

async function legeFreigabeAn(
  lauf: AutomationRun,
  stepIndex: number,
  title: string,
  summary: string,
): Promise<void> {
  await prisma.automationApproval.upsert({
    where: { runId_stepIndex: { runId: lauf.id, stepIndex } },
    create: {
      runId: lauf.id,
      stepIndex,
      guildId: lauf.guildId,
      title: title.slice(0, 200),
      summary: summary.slice(0, 1000),
    },
    update: {},
  });
}

/**
 * Einen wartenden Lauf fortsetzen.
 *
 * Wird vom Zeitplaner aufgerufen (nach einem Wait) und von der Freigabe
 * (nach einem «Genehmigen»). Der Kontext wird aus der Zeile
 * wiederhergestellt - deshalb überlebt ein Lauf jeden Neustart (§46).
 */
export async function setzeFort(
  runId: string,
  options: { gateway?: DiscordGateway; jetzt?: Date } = {},
): Promise<LaufErgebnis> {
  const jetzt = options.jetzt ?? new Date();
  const lauf = await prisma.automationRun.findUnique({
    where: { id: runId },
    include: { automation: true },
  });

  if (!lauf) {
    return { runId, status: 'FAILED', neu: false, fehler: 'Diesen Lauf gibt es nicht.' };
  }
  if (lauf.status !== 'WAITING' && lauf.status !== 'AWAITING_APPROVAL') {
    // Schon fortgesetzt - etwa, weil zwei Instanzen denselben Wecker sahen.
    return { runId, status: lauf.status, neu: false };
  }

  // Den Zuschlag holen: nur eine Instanz setzt fort.
  const zugeteilt = await prisma.automationRun.updateMany({
    where: { id: runId, status: lauf.status },
    data: { status: 'RUNNING' },
  });
  if (zugeteilt.count === 0) {
    return { runId, status: lauf.status, neu: false };
  }

  const versionsZeile = lauf.versionId
    ? await prisma.automationVersion.findUnique({
        where: { id: lauf.versionId },
        select: { snapshot: true },
      })
    : null;
  const schritteRoh = (versionsZeile?.snapshot as { steps?: unknown })?.steps ?? lauf.automation.steps;
  const geprueft = stepsSchema.safeParse(schritteRoh);
  if (!geprueft.success) {
    await beendeLauf(runId, 'FAILED', jetzt, 'Die gespeicherte Schrittfolge ist ungültig.');
    return { runId, status: 'FAILED', neu: false, fehler: 'Die Schrittfolge ist ungültig.' };
  }

  const gespeichert = (lauf.context ?? {}) as {
    payload?: Record<string, unknown>;
    event?: Record<string, unknown>;
    steps?: Record<string, unknown>;
  };

  const context: AutomationContext = {
    runId: lauf.id,
    automationId: lauf.automationId,
    guildId: lauf.guildId,
    correlationId: lauf.correlationId,
    depth: lauf.depth,
    dryRun: false,
    gateway: options.gateway ?? defaultDiscord,
    event: {
      id: lauf.eventId,
      type: lauf.eventType,
      actorId: (gespeichert.event?.actorId as string | null) ?? null,
      subjectId: (gespeichert.event?.subjectId as string | null) ?? null,
      entityId: (gespeichert.event?.entityId as string | null) ?? null,
      occurredAt: gespeichert.event?.occurredAt
        ? new Date(String(gespeichert.event.occurredAt))
        : lauf.createdAt,
    },
    payload: gespeichert.payload ?? {},
    steps: gespeichert.steps ?? {},
    now: jetzt,
    emitted: 0,
  };

  // `cursor` trägt die Stellung, an der der Lauf angehalten hat. `-1` heisst
  // «hinter dem letzten Schritt» - dann bleibt nur noch der Abschluss.
  return arbeiteAb(
    { ...lauf, status: 'RUNNING' },
    geprueft.data,
    context,
    jetzt,
    lauf.cursor >= 0 ? lauf.cursor : null,
  );
}

/** Einen gescheiterten Lauf in den Fehler-Posteingang verschieben. */
export async function markiereTot(runId: string): Promise<void> {
  await prisma.automationRun.updateMany({
    where: { id: runId, status: 'FAILED' },
    data: { status: 'DEAD_LETTER' },
  });
}
