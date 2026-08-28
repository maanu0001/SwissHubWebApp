import { AUDIT_ACTIONS, Prisma, prisma, recordAudit } from '@swisshub/database';
import type { Automation, AutomationConcurrency, AutomationKind } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conditionNodeSchema } from './conditions';
import { planeNaechsten } from './dispatcher';
import { verwerfeJobs } from './scheduler';
import { stepsSchema } from './steps';

const logger = createLogger('automation:store');

/**
 * Lesen und Schreiben von Automationen.
 *
 * Zwei Dinge, die diese Datei anders macht als eine gewöhnliche CRUD-Schicht:
 *
 * 1. **Jede Änderung erzeugt eine Fassung.** Ein Lauf hält die Fassung fest,
 *    mit der er begonnen hat. Änderte jemand eine Automation, während ein Lauf
 *    zwischen zwei Schritten wartet, machte der Lauf sonst nach dem Aufwachen
 *    etwas anderes, als beim Start dastand (§12).
 * 2. **Löschen ist ein Archivieren.** Der Verlauf und die Prüfspur bleiben
 *    lesbar. Wer wissen will, warum vor drei Wochen tausend Nachrichten
 *    hinausgingen, findet die Automation sonst nicht mehr.
 */

export interface AutomationEingabe {
  guildId: string;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions?: unknown;
  steps: unknown;
  concurrency?: AutomationConcurrency;
  concurrencyKey?: string | null;
  maxRunsPerMinute?: number;
  kind?: AutomationKind;
  systemKey?: string | null;
}

export interface Akteur {
  discordId: string;
  username?: string | null;
}

/** Eine Automation samt ihrer Zählwerte für die Übersicht. */
export interface AutomationMitZahlen extends Automation {
  laeufe24h: number;
  fehler24h: number;
}

export async function holeAutomation(guildId: string, id: string): Promise<Automation | null> {
  // Die Gilde steht in der Abfrage, nicht in einer Nachprüfung: eine ID aus
  // einer fremden Gilde darf nicht einmal gelesen werden.
  return prisma.automation.findFirst({ where: { id, guildId } });
}

export async function listeAutomationen(
  guildId: string,
  optionen: { nurAktive?: boolean; mitArchivierten?: boolean } = {},
): Promise<AutomationMitZahlen[]> {
  const automationen = await prisma.automation.findMany({
    where: {
      guildId,
      ...(optionen.mitArchivierten ? {} : { archivedAt: null }),
      ...(optionen.nurAktive ? { enabled: true } : {}),
    },
    orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    take: 500,
  });

  if (automationen.length === 0) {
    return [];
  }

  const seit = new Date(Date.now() - 24 * 3600_000);
  const gruppen = await prisma.automationRun.groupBy({
    by: ['automationId', 'status'],
    where: { guildId, createdAt: { gte: seit }, dryRun: false },
    _count: { _all: true },
  });

  const zahlen = new Map<string, { laeufe: number; fehler: number }>();
  for (const gruppe of gruppen) {
    const eintrag = zahlen.get(gruppe.automationId) ?? { laeufe: 0, fehler: 0 };
    eintrag.laeufe += gruppe._count._all;
    if (gruppe.status === 'FAILED' || gruppe.status === 'DEAD_LETTER') {
      eintrag.fehler += gruppe._count._all;
    }
    zahlen.set(gruppe.automationId, eintrag);
  }

  return automationen.map((automation) => ({
    ...automation,
    laeufe24h: zahlen.get(automation.id)?.laeufe ?? 0,
    fehler24h: zahlen.get(automation.id)?.fehler ?? 0,
  }));
}

/**
 * Die Bausteine einer Automation prüfen, ehe sie in die Datenbank gehen.
 *
 * Nur die Form, nicht die Umgebung - ob der Kanal noch existiert, klärt
 * `pruefeAutomation()` beim Einschalten. Beides hier zu tun hiesse, dass sich
 * ein Entwurf nicht speichern liesse, solange Discord gerade hakt.
 */
function pruefeForm(eingabe: AutomationEingabe): { steps: unknown; conditions: unknown } {
  const schritte = stepsSchema.safeParse(eingabe.steps);
  if (!schritte.success) {
    throw Object.assign(new Error('Schrittfolge ungültig'), {
      code: 'VALIDATION_FAILED',
      userMessage: schritte.error.issues[0]?.message ?? 'Die Schrittfolge ist ungültig.',
    });
  }

  if (eingabe.conditions === null || eingabe.conditions === undefined) {
    return { steps: schritte.data, conditions: null };
  }

  const bedingungen = conditionNodeSchema.safeParse(eingabe.conditions);
  if (!bedingungen.success) {
    throw Object.assign(new Error('Bedingungen ungültig'), {
      code: 'VALIDATION_FAILED',
      userMessage: bedingungen.error.issues[0]?.message ?? 'Die Bedingungen sind ungültig.',
    });
  }
  return { steps: schritte.data, conditions: bedingungen.data };
}

/**
 * Eine Fassung festhalten.
 *
 * Die Momentaufnahme enthält alles, was ein Lauf braucht - Auslöser,
 * Bedingungen, Schritte. Ein Lauf zeigt darauf und nicht auf die Automation
 * selbst; deshalb bleibt er nach einer Änderung derselbe Lauf.
 */
async function schreibeFassung(
  automation: Automation,
  akteur: Akteur | null,
  notiz?: string,
): Promise<void> {
  await prisma.automationVersion.upsert({
    where: { automationId_version: { automationId: automation.id, version: automation.version } },
    create: {
      automationId: automation.id,
      version: automation.version,
      snapshot: {
        name: automation.name,
        triggerType: automation.triggerType,
        triggerConfig: automation.triggerConfig,
        conditions: automation.conditions,
        steps: automation.steps,
      } as Prisma.InputJsonValue,
      createdBy: akteur?.discordId ?? null,
      note: notiz?.slice(0, 200) ?? null,
    },
    update: {},
  });
}

export async function legeAn(eingabe: AutomationEingabe, akteur: Akteur): Promise<Automation> {
  const { steps, conditions } = pruefeForm(eingabe);

  const automation = await prisma.automation.create({
    data: {
      guildId: eingabe.guildId,
      name: eingabe.name.trim().slice(0, 120),
      description: eingabe.description?.trim().slice(0, 500) ?? null,
      kind: eingabe.kind ?? 'USER',
      systemKey: eingabe.systemKey ?? null,
      triggerType: eingabe.triggerType,
      triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      concurrency: eingabe.concurrency ?? 'ALLOW',
      concurrencyKey: eingabe.concurrencyKey ?? null,
      maxRunsPerMinute: eingabe.maxRunsPerMinute ?? 60,
      // Neu ist immer aus. Wer sie einschaltet, hat sie gesehen - und die
      // Prüfung vor dem Einschalten hat stattgefunden (§22).
      enabled: false,
      createdBy: akteur.discordId,
      updatedBy: akteur.discordId,
    },
  });

  await schreibeFassung(automation, akteur, 'Angelegt');
  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_CREATED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: automation.name,
    metadata: { automationId: automation.id, triggerType: automation.triggerType },
  });

  return automation;
}

export async function aendere(
  guildId: string,
  id: string,
  eingabe: AutomationEingabe,
  akteur: Akteur,
): Promise<Automation> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }
  if (vorhanden.kind === 'SYSTEM') {
    // Eine Systemautomation gehört SwissHub, nicht der Gilde. Sie liesse sich
    // sonst so verändern, dass eine Kernfunktion still ausfällt.
    throw Object.assign(new Error('Systemautomation'), {
      code: 'FORBIDDEN',
      userMessage: 'Systemautomationen lassen sich nicht bearbeiten.',
    });
  }

  const { steps, conditions } = pruefeForm(eingabe);

  const geaendert = await prisma.automation.update({
    where: { id },
    data: {
      name: eingabe.name.trim().slice(0, 120),
      description: eingabe.description?.trim().slice(0, 500) ?? null,
      triggerType: eingabe.triggerType,
      triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      concurrency: eingabe.concurrency ?? 'ALLOW',
      concurrencyKey: eingabe.concurrencyKey ?? null,
      maxRunsPerMinute: eingabe.maxRunsPerMinute ?? 60,
      version: { increment: 1 },
      updatedBy: akteur.discordId,
    },
  });

  await schreibeFassung(geaendert, akteur, 'Bearbeitet');

  // Geplante Termine gehören zur alten Fassung; sie werden verworfen und -
  // falls die Automation eingeschaltet ist - neu gesetzt.
  await verwerfeJobs(geaendert.id);
  if (geaendert.enabled) {
    await planeNaechsten(geaendert);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_UPDATED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: geaendert.name,
    metadata: { automationId: geaendert.id, version: geaendert.version },
  });

  return geaendert;
}

/**
 * Ein- oder ausschalten.
 *
 * Die Prüfung vor dem Einschalten liegt bewusst **nicht** hier, sondern beim
 * Aufrufer: sie braucht einen Discord-Zugang, und diese Datei soll auch dort
 * benutzbar bleiben, wo keiner zur Verfügung steht.
 */
export async function schalte(
  guildId: string,
  id: string,
  eingeschaltet: boolean,
  akteur: Akteur,
): Promise<Automation> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }

  const geaendert = await prisma.automation.update({
    where: { id },
    data: { enabled: eingeschaltet, updatedBy: akteur.discordId },
  });

  if (eingeschaltet) {
    await planeNaechsten(geaendert);
  } else {
    // Offene Wecker verwerfen: eine ausgeschaltete Automation soll auch dann
    // nicht laufen, wenn ihr Termin bereits eingeplant war.
    const verworfen = await verwerfeJobs(id);
    if (verworfen > 0) {
      logger.info('Geplante Läufe verworfen', { automationId: id, anzahl: verworfen });
    }
  }

  await recordAudit({
    action: eingeschaltet ? AUDIT_ACTIONS.AUTOMATION_ENABLED : AUDIT_ACTIONS.AUTOMATION_DISABLED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: geaendert.name,
    metadata: { automationId: id },
  });

  return geaendert;
}

/**
 * Archivieren statt löschen.
 *
 * Die Zeile bleibt, damit der Verlauf lesbar bleibt; sie verschwindet aus
 * allen Listen und wird von keinem Verteiler mehr berücksichtigt, weil jede
 * Abfrage `archivedAt: null` verlangt.
 */
export async function archiviere(guildId: string, id: string, akteur: Akteur): Promise<void> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }
  if (vorhanden.kind === 'SYSTEM') {
    throw Object.assign(new Error('Systemautomation'), {
      code: 'FORBIDDEN',
      userMessage: 'Systemautomationen lassen sich nicht löschen.',
    });
  }

  await prisma.automation.update({
    where: { id },
    data: { enabled: false, archivedAt: new Date(), updatedBy: akteur.discordId },
  });
  await verwerfeJobs(id);

  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_DELETED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: vorhanden.name,
    metadata: { automationId: id },
  });
}

/**
 * Eine Systemautomation anlegen oder auffrischen.
 *
 * Systemautomationen gehören SwissHub: sie werden beim Start abgeglichen und
 * nicht von Hand gepflegt. Das Ein- und Ausschalten bleibt der Gilde
 * überlassen - deshalb wird `enabled` beim Auffrischen **nicht** überschrieben.
 */
export async function stelleSystemautomationSicher(
  eingabe: AutomationEingabe & { systemKey: string },
): Promise<Automation> {
  const { steps, conditions } = pruefeForm(eingabe);
  const vorhanden = await prisma.automation.findUnique({ where: { systemKey: eingabe.systemKey } });

  if (!vorhanden) {
    const automation = await prisma.automation.create({
      data: {
        guildId: eingabe.guildId,
        name: eingabe.name,
        description: eingabe.description ?? null,
        kind: 'SYSTEM',
        systemKey: eingabe.systemKey,
        triggerType: eingabe.triggerType,
        triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
        conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        steps: steps as Prisma.InputJsonValue,
        concurrency: eingabe.concurrency ?? 'ALLOW',
        maxRunsPerMinute: eingabe.maxRunsPerMinute ?? 60,
        enabled: false,
      },
    });
    await schreibeFassung(automation, null, 'Systemautomation angelegt');
    return automation;
  }

  const unveraendert =
    JSON.stringify(vorhanden.steps) === JSON.stringify(steps) &&
    JSON.stringify(vorhanden.triggerConfig) === JSON.stringify(eingabe.triggerConfig);
  if (unveraendert) {
    return vorhanden;
  }

  const geaendert = await prisma.automation.update({
    where: { id: vorhanden.id },
    data: {
      name: eingabe.name,
      description: eingabe.description ?? null,
      triggerType: eingabe.triggerType,
      triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  await schreibeFassung(geaendert, null, 'Systemautomation aufgefrischt');
  return geaendert;
}
